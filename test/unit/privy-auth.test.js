import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAuthState,
  setAuthState,
  clearAuthState,
  connectInjectedWallet,
  initPrivy,
  getPrivyProvider,
  sendEmailOtp,
  verifyEmailOtp,
  saveAuthSession,
  getAuthSession,
  clearAuthSession,
  disconnectWallet,
  deriveDeterministicEvmAddress,
  copyToClipboard,
  SESSION_STORAGE_KEY,
  SESSION_TTL_MS
} from '../../console/privy-auth.js';
import { resolveEvmAddress } from '../../server.js';

test('Unit: authState management transitions correctly', () => {
  clearAuthState();
  assert.equal(getAuthState().isAuthenticated, false);
  assert.equal(getAuthState().address, null);

  setAuthState('0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec', 'injected');
  const state = getAuthState();
  assert.equal(state.isAuthenticated, true);
  assert.equal(state.address, '0x71c8b46b08639f70efa4c34db895c989c7fa22ec');
  assert.equal(state.method, 'injected');

  clearAuthState();
  assert.equal(getAuthState().isAuthenticated, false);
});

test('Unit: connectInjectedWallet authenticates with valid EIP-1193 provider', async () => {
  const mockProvider = {
    request: async ({ method }) => {
      if (method === 'eth_requestAccounts') {
        return ['0x89C4e2B04D657b98721Fa123b098194412eA9812'];
      }
      return [];
    }
  };

  const address = await connectInjectedWallet(mockProvider);
  assert.equal(address, '0x89C4e2B04D657b98721Fa123b098194412eA9812');
  assert.equal(getAuthState().isAuthenticated, true);
  assert.equal(getAuthState().method, 'injected');
});

test('Unit: connectInjectedWallet throws when provider is missing', async () => {
  await assert.rejects(
    async () => connectInjectedWallet(null),
    { message: /No Web3 browser extension found/ }
  );
});

test('Unit: initPrivy rejects empty App ID', async () => {
  await assert.rejects(
    async () => initPrivy(''),
    { message: 'Privy App ID is required' }
  );
});

test('Unit: sendEmailOtp validates email format', async () => {
  // Mock Privy SDK Class
  class MockPrivy {
    constructor() {
      this.auth = {
        email: {
          sendCode: async (e) => ({ success: true, email: e }),
          loginWithCode: async (e, code) => ({
            user: {
              id: 'usr_123',
              linkedAccounts: [{ type: 'wallet', address: '0x1234567890abcdef1234567890abcdef12345678' }]
            }
          })
        }
      };
    }
  }

  await initPrivy('test-app-id', MockPrivy);

  await assert.rejects(
    async () => sendEmailOtp('invalid_email'),
    { message: 'Invalid email address' }
  );

  const res = await sendEmailOtp('cfo@treasury.xyz');
  assert.equal(res.success, true);
});

test('Unit: verifyEmailOtp sets auth state with embedded wallet address', async () => {
  const { address, user } = await verifyEmailOtp('cfo@treasury.xyz', '654321');
  assert.equal(address, '0x1234567890abcdef1234567890abcdef12345678');
  assert.equal(user.id, 'usr_123');
  assert.equal(getAuthState().isAuthenticated, true);
  assert.equal(getAuthState().method, 'privy_email');
});

test('Unit: Session management stores, retrieves, and expires sessions properly', () => {
  clearAuthSession();
  assert.equal(getAuthSession(), null);

  const testAddr = '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec';
  const session = saveAuthSession(testAddr, 'Privy', 'treasury@fund.xyz');
  assert.equal(session.address, testAddr);
  assert.equal(session.method, 'Privy');
  assert.equal(session.email, 'treasury@fund.xyz');
  assert.equal(session.expiresAt > Date.now(), true);

  const active = getAuthSession();
  assert.equal(active.address, testAddr);

  clearAuthSession();
  assert.equal(getAuthSession(), null);
});

test('Unit: disconnectWallet clears authentication state and active session', () => {
  setAuthState('0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec', 'Privy', null, 'cfo@fund.xyz');
  assert.equal(getAuthState().isAuthenticated, true);

  const res = disconnectWallet();
  assert.equal(res, true);
  assert.equal(getAuthState().isAuthenticated, false);
  assert.equal(getAuthState().address, null);
  assert.equal(getAuthSession(), null);
});

test('Unit: deriveDeterministicEvmAddress generates valid 42-character 0x EVM address', () => {
  const addr1 = deriveDeterministicEvmAddress('did:privy:cmw56hor701f90hjsi03jo7ds');
  assert.equal(addr1.startsWith('0x'), true);
  assert.equal(addr1.length, 42);

  // Deterministic check
  const addr2 = deriveDeterministicEvmAddress('did:privy:cmw56hor701f90hjsi03jo7ds');
  assert.equal(addr1, addr2);
});

test('Unit: copyToClipboard handles text gracefully in test environment', async () => {
  const ok = await copyToClipboard('0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec');
  // In node.js headless test environment where navigator.clipboard & document are undefined, returns false
  assert.equal(typeof ok, 'boolean');

  const empty = await copyToClipboard('');
  assert.equal(empty, false);
});

test('Unit: resolveEvmAddress in server resolves linked wallet and deterministically derives EVM address', () => {
  // Case 1: user has an embedded 0x wallet
  const userWithWallet = {
    id: 'did:privy:cmw1',
    linkedAccounts: [{ type: 'wallet', chainType: 'ethereum', address: '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec' }]
  };
  const resolved1 = resolveEvmAddress(userWithWallet, 'test@veyroq.xyz');
  assert.equal(resolved1, '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec');

  // Case 2: user has NO embedded wallet (new email user) -> MUST NOT return did:privy:...
  const userWithoutWallet = {
    id: 'did:privy:cmw56hor701f90hjsi03jo7ds',
    linkedAccounts: [{ type: 'email', address: 'treasury@fund.xyz' }]
  };
  const resolved2 = resolveEvmAddress(userWithoutWallet, 'treasury@fund.xyz');
  assert.equal(resolved2.startsWith('0x'), true);
  assert.equal(resolved2.length, 42);
  assert.equal(resolved2.includes('did:privy:'), false);

  // Deterministic output
  const resolvedAgain = resolveEvmAddress(userWithoutWallet, 'treasury@fund.xyz');
  assert.equal(resolved2, resolvedAgain);
});

test('Unit: verifyEmailOtp auto-provisions embedded wallet when missing and binds getPrivyProvider', async () => {
  clearAuthState();
  const provisionedAddress = '0x9999000011112222333344445555666677778888';
  let createCalled = false;
  const mockEip1193 = {
    request: async ({ method }) => {
      if (method === 'eth_accounts') return [provisionedAddress];
      if (method === 'eth_sendTransaction') return '0xprivytx';
      return null;
    }
  };

  class MockEmbeddedPrivy {
    constructor() {
      this.auth = {
        email: {
          sendCode: async () => ({ success: true }),
          loginWithCode: async () => ({
            user: { id: 'did:privy:newuser', linked_accounts: [{ type: 'email', address: 'founder@veyroq.xyz' }] }
          })
        }
      };
      this.embeddedWallet = {
        create: async () => {
          createCalled = true;
          return {
            user: {
              id: 'did:privy:newuser',
              linked_accounts: [
                { type: 'wallet', chain_type: 'ethereum', wallet_client_type: 'privy', address: provisionedAddress, id: 'w1', recovery_method: 'privy-v2' }
              ]
            }
          };
        },
        getEthereumProvider: async () => mockEip1193
      };
    }
  }

  await initPrivy('test-app-id', MockEmbeddedPrivy);
  const res = await verifyEmailOtp('founder@veyroq.xyz', '123456');
  assert.equal(createCalled, true);
  assert.equal(res.address, provisionedAddress);

  const signer = await getPrivyProvider();
  assert.ok(signer);
  const accts = await signer.request({ method: 'eth_accounts' });
  assert.deepEqual(accts, [provisionedAddress]);
});

