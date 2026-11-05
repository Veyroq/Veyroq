// Veyroq Privy & Web3 Authentication Controller
// Interfaces with @privy-io/js-sdk-core and standard EIP-1193 injected providers.

let privyClient = null;
let authState = {
  isAuthenticated: false,
  address: null,
  method: null,
  user: null
};

export function getAuthState() {
  return { ...authState };
}

export function setAuthState(address, method, user = null) {
  authState = {
    isAuthenticated: Boolean(address),
    address: address ? address.toLowerCase() : null,
    method: method || null,
    user
  };
  return authState;
}

export function clearAuthState() {
  authState = {
    isAuthenticated: false,
    address: null,
    method: null,
    user: null
  };
  return authState;
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

// Send Email OTP Code via Privy Core
export async function sendEmailOtp(email) {
  if (!privyClient) {
    throw new Error('Privy client not initialized. Enter your Privy App ID.');
  }
  if (!email || !email.includes('@')) {
    throw new Error('Invalid email address');
  }

  return await privyClient.auth.email.sendCode(email);
}

// Verify Email OTP Code via Privy Core
export async function verifyEmailOtp(email, code) {
  if (!privyClient) {
    throw new Error('Privy client not initialized');
  }
  if (!code || code.trim().length === 0) {
    throw new Error('Verification code is required');
  }

  const result = await privyClient.auth.email.loginWithCode(email, code.trim());
  const user = result?.user;
  const embeddedWallet = user?.linkedAccounts?.find(a => a.type === 'wallet');
  const address = embeddedWallet?.address || user?.id || `privy-${email}`;

  setAuthState(address, 'privy_email', user);
  return { user, address };
}
