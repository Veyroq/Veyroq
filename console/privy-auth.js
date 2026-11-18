// Veyroq Privy & Web3 Authentication Controller
// Interfaces with @privy-io/js-sdk-core (browser embedded wallets) and EIP-1193 providers.

export const SESSION_STORAGE_KEY = 'veyroq_auth_session_v1';
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const ARC_PRIVY_CHAIN = {
  id: 5042002,
  network: 'arc-testnet',
  name: 'Circle Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.io'] },
    public: { http: ['https://rpc.testnet.arc.io'] }
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' }
  },
  testnet: true
};

let privyClient = null;
let privySdkModule = null;
let privyInitPromise = null;
let privyEthereumProvider = null;
let privyMessageListenerBound = false;
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
  privyEthereumProvider = null;
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
  privyEthereumProvider = null;
  if (privyClient?.auth?.logout) {
    Promise.resolve(privyClient.auth.logout()).catch(() => {});
  }
  clearAuthState();
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
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

function extractEmbeddedEthereumWallet(user) {
  if (!user) return null;
  if (privySdkModule?.getUserEmbeddedEthereumWallet) {
    const found = privySdkModule.getUserEmbeddedEthereumWallet(user);
    if (found?.address) return found;
  }
  const accounts = user.linked_accounts || user.linkedAccounts || [];
  return accounts.find(a =>
    a.type === 'wallet' &&
    (a.chain_type === 'ethereum' || a.chainType === 'ethereum') &&
    (a.wallet_client_type === 'privy' || a.walletClientType === 'privy' || !a.wallet_client_type) &&
    a.address?.startsWith('0x')
  ) || accounts.find(a =>
    (a.type === 'wallet' || a.chainType === 'ethereum' || a.chain_type === 'ethereum') &&
    a.address?.startsWith('0x')
  ) || null;
}

function mountPrivyIframe(privy) {
  if (typeof document === 'undefined' || !privy?.embeddedWallet?.getURL || !privy.setMessagePoster) {
    return;
  }
  const iframeUrl = privy.embeddedWallet.getURL();
  const iframeOrigin = new URL(iframeUrl).origin;

  if (!privyMessageListenerBound) {
    window.addEventListener('message', (event) => {
      if (event.origin !== iframeOrigin) return;
      let payload = event.data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (payload && typeof payload.event === 'string' && payload.event.startsWith('privy:')) {
        privyClient?.embeddedWallet?.onMessage(payload);
      }
    });
    privyMessageListenerBound = true;
  }

  let iframe = document.getElementById('veyroq-privy-iframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'veyroq-privy-iframe';
    iframe.src = iframeUrl;
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);
  }

  privy.setMessagePoster({
    postMessage: (msg, targetOrigin) => {
      iframe.contentWindow?.postMessage(msg, targetOrigin || iframeOrigin);
    },
    reload: () => {
      iframe.src = iframeUrl;
    }
  });
}

async function resolvePrivyWalletAndProvider(user) {
  let activeUser = user;
  let wallet = extractEmbeddedEthereumWallet(activeUser);

  if (!wallet && privyClient?.embeddedWallet?.create) {
    const idempotencyKey = (privySdkModule?.generateWalletIdempotencyKey && activeUser?.id)
      ? await privySdkModule.generateWalletIdempotencyKey(activeUser.id, 'ethereum')
      : undefined;
    const created = await privyClient.embeddedWallet.create(idempotencyKey ? { idempotencyKey } : {});
    activeUser = created?.user || created || activeUser;
    wallet = extractEmbeddedEthereumWallet(activeUser);
  }

  let provider = null;
  if (wallet && privyClient?.embeddedWallet) {
    const entropy = privySdkModule?.getEntropyDetailsFromUser?.(activeUser);
    if (privyClient.embeddedWallet.getEthereumProvider) {
      provider = await privyClient.embeddedWallet.getEthereumProvider({
        wallet,
        ...(entropy || { entropyId: wallet.address, entropyIdVerifier: 'ethereum-address-verifier' })
      });
    } else if (privyClient.embeddedWallet.getProvider) {
      provider = await privyClient.embeddedWallet.getProvider(wallet);
    }
  }

  return { user: activeUser, wallet, provider };
}

// Initialize Privy SDK Client
export async function initPrivy(appId, PrivyClass = null) {
  if (!appId) {
    throw new Error('Privy App ID is required');
  }

  try {
    if (PrivyClass) {
      privySdkModule = typeof PrivyClass === 'object' ? PrivyClass : null;
      const Ctor = typeof PrivyClass === 'function' ? PrivyClass : PrivyClass.default;
      privyClient = new Ctor({ appId, supportedChains: [ARC_PRIVY_CHAIN] });
    } else {
      const mod = typeof window !== 'undefined'
        ? await import('./privy-sdk.bundle.js')
        : await import('@privy-io/js-sdk-core');
      privySdkModule = mod;
      const PrivyCtor = mod.default;
      const storage = (typeof window !== 'undefined' && mod.LocalStorage) ? new mod.LocalStorage() : undefined;
      privyClient = new PrivyCtor({
        appId,
        ...(storage ? { storage } : {}),
        supportedChains: [ARC_PRIVY_CHAIN]
      });
      mountPrivyIframe(privyClient);
      if (typeof privyClient.initialize === 'function') {
        await privyClient.initialize();
      }
    }
    return privyClient;
  } catch (err) {
    privyClient = null;
    console.warn('Privy initialization warning:', err.message);
    throw err;
  }
}

export async function initPrivyFromServer() {
  if (privyClient) return privyClient;
  if (privyInitPromise) return privyInitPromise;

  privyInitPromise = (async () => {
    const res = await fetch('/api/auth/privy/config', { credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok || !data.appId) {
      throw new Error(data.error || 'Privy App ID is not configured on the server.');
    }
    return await initPrivy(data.appId);
  })();

  try {
    return await privyInitPromise;
  } finally {
    privyInitPromise = null;
  }
}

export async function getPrivyProvider() {
  if (privyEthereumProvider) return privyEthereumProvider;
  if (!privyClient) {
    try { await initPrivyFromServer(); } catch { return null; }
  }
  if (!privyClient?.embeddedWallet) return null;

  let user = authState.user;
  if (!user && privyClient.user?.get) {
    try {
      const res = await privyClient.user.get();
      user = res?.user || res || null;
    } catch {
      return null;
    }
  }
  if (!user) return null;

  const { user: activeUser, provider } = await resolvePrivyWalletAndProvider(user);
  if (activeUser && authState.address) {
    authState.user = activeUser;
  }
  privyEthereumProvider = provider;
  return privyEthereumProvider;
}

export async function restorePrivySession() {
  try {
    await initPrivyFromServer();
    if (!privyClient?.user?.get) return null;
    const res = await privyClient.user.get();
    const user = res?.user || res;
    if (!user) return null;

    const { user: activeUser, wallet, provider } = await resolvePrivyWalletAndProvider(user);
    if (!wallet?.address) return null;

    privyEthereumProvider = provider;
    const accounts = activeUser?.linked_accounts || activeUser?.linkedAccounts || [];
    const emailAcc = accounts.find(a => a.type === 'email');
    const email = emailAcc?.address || getAuthSession()?.email || null;
    setAuthState(wallet.address, 'privy_email', activeUser, email);
    return { address: wallet.address, email, user: activeUser, provider };
  } catch {
    return null;
  }
}

// Send Email OTP Code directly through browser Privy SDK (so embedded wallet signs in-browser)
export async function sendEmailOtp(email) {
  if (!email || !email.includes('@')) {
    throw new Error('Invalid email address');
  }

  if (!privyClient && typeof window !== 'undefined') {
    await initPrivyFromServer();
  }

  if (privyClient) {
    return await privyClient.auth.email.sendCode(email);
  }

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

// Verify Email OTP Code, provision embedded wallet if missing, and bind EIP-1193 signer
export async function verifyEmailOtp(email, code) {
  if (!code || code.trim().length === 0) {
    throw new Error('Verification code is required');
  }

  if (!privyClient && typeof window !== 'undefined') {
    await initPrivyFromServer();
  }

  if (privyClient) {
    const result = await privyClient.auth.email.loginWithCode(email, code.trim());
    const resolved = await resolvePrivyWalletAndProvider(result?.user);
    const activeUser = resolved.user;
    const wallet = resolved.wallet;

    // Only allow hash fallback in headless MockPrivy tests where embeddedWallet SDK is absent
    const address = wallet?.address || (!privyClient.embeddedWallet ? deriveDeterministicEvmAddress(activeUser?.id || email) : null);
    if (!address) {
      throw new Error('Could not provision Privy embedded wallet for this account.');
    }

    privyEthereumProvider = resolved.provider || null;
    setAuthState(address, 'privy_email', activeUser, email);
    return { user: activeUser, address, email, provider: privyEthereumProvider };
  }

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
  return { user, address, email: data.email || email, provider: null };
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
