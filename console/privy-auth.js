// Veyroq Privy & Web3 Authentication Controller
// Interfaces with @privy-io/js-sdk-core and standard EIP-1193 injected providers.

export const SESSION_STORAGE_KEY = 'veyroq_auth_session_v1';
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let privyClient = null;
let memorySession = null;
let authState = {
  isAuthenticated: false,
  address: null,
  rawAddress: null,
  method: null,
  email: null,
  user: null
};

// Deterministic EVM address derivation for browser fallback
export function deriveDeterministicEvmAddress(seed) {
  const str = String(seed || 'privy-user').toLowerCase();
  let hash1 = 0x811c9dc5;
  let hash2 = 0xcbf29ce4;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    hash1 ^= code;
    hash1 = Math.imul(hash1, 0x01000193);
    hash2 ^= code;
    hash2 = Math.imul(hash2, 0x100000001b3);
  }
  const part1 = (hash1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  const part3 = ((hash1 ^ hash2) >>> 0).toString(16).padStart(8, '0');
  const part4 = ((hash1 + hash2) >>> 0).toString(16).padStart(8, '0');
  const part5 = ((hash1 * 31) >>> 0).toString(16).padStart(8, '0');
  return `0x${part1}${part2}${part3}${part4}${part5}`.slice(0, 42);
}

// Session persistence management with TTL expiration
export function saveAuthSession(address, method, email = null) {
  if (!address) return null;
  const session = {
    address,
    method: method || 'wallet',
    email: email || null,
    connectedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  memorySession = session;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
      console.warn('Veyroq session write warning:', e);
    }
  }
  return session;
}

export function getAuthSession() {
  let session = memorySession;
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) session = JSON.parse(stored);
    } catch {
      session = memorySession;
    }
  }
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    clearAuthSession();
    return null;
  }
  return session;
}

export function clearAuthSession() {
  memorySession = null;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) {
      console.warn('Veyroq session clear warning:', e);
    }
  }
}

export function getAuthState() {
  return { ...authState };
}

export function setAuthState(address, method, user = null, email = null) {
  authState = {
    isAuthenticated: Boolean(address),
    address: address ? address.toLowerCase() : null,
    rawAddress: address || null,
    method: method || null,
    email: email || null,
    user
  };
  if (address) {
    saveAuthSession(address, method, email);
  }
  return authState;
}

export function clearAuthState() {
  authState = {
    isAuthenticated: false,
    address: null,
    rawAddress: null,
    method: null,
    email: null,
    user: null
  };
  clearAuthSession();
  return authState;
}

export function disconnectWallet() {
  clearAuthState();
  return true;
}

// Connect via standard EIP-1193 Web3 provider (MetaMask, Rabby, Coinbase, etc.)
export async function connectInjectedWallet(ethereumProvider = null) {
  const provider = ethereumProvider || (typeof window !== 'undefined' ? window.ethereum : null);
  if (!provider) {
    throw new Error('No Web3 browser extension found (MetaMask, Rabby, or Coinbase Wallet)');
  }

  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts authorized');
  }

  const primaryAddress = accounts[0];
  setAuthState(primaryAddress, 'injected');
  return primaryAddress;
}

// Initialize Privy SDK Client
export async function initPrivy(appId, PrivyClass = null) {
  if (!appId) {
    throw new Error('Privy App ID is required');
  }

  try {
    const SDK = PrivyClass || (await import('@privy-io/js-sdk-core')).default;
    privyClient = new SDK({ appId });
    return privyClient;
  } catch (err) {
    console.warn('Privy initialization warning:', err.message);
    throw err;
  }
}

// Send Email OTP Code (Backend zero-custody proxy using .env or mock SDK client)
export async function sendEmailOtp(email) {
  if (!email || !email.includes('@')) {
    throw new Error('Invalid email address');
  }

  if (privyClient) {
    return await privyClient.auth.email.sendCode(email);
  }

  // Zero-custody backend proxy call (Privy App ID resides strictly in .env)
  const res = await fetch('/api/auth/privy/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to send verification code');
  }
  return data;
}

// Verify Email OTP Code
export async function verifyEmailOtp(email, code) {
  if (!code || code.trim().length === 0) {
    throw new Error('Verification code is required');
  }

  if (privyClient) {
    const result = await privyClient.auth.email.loginWithCode(email, code.trim());
    const user = result?.user;
    const embeddedWallet = user?.linkedAccounts?.find(a => 
      (a.type === 'wallet' || a.chainType === 'ethereum') && a.address?.startsWith('0x')
    );
    const address = embeddedWallet?.address || deriveDeterministicEvmAddress(user?.id || email);
    setAuthState(address, 'privy_email', user, email);
    return { user, address, email };
  }

  // Zero-custody backend proxy verification
  const res = await fetch('/api/auth/privy/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: code.trim() })
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Verification code failed');
  }

  const address = data.address;
  const user = data.user;
  setAuthState(address, 'privy_email', user, data.email || email);
  return { user, address, email: data.email || email };
}

// Universal clipboard copy helper with legacy textarea fallback
export async function copyToClipboard(text) {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return Boolean(success);
    } catch {
      return false;
    }
  }
  return false;
}
