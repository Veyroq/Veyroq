import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAuthState,
  setAuthState,
  clearAuthState,
  connectInjectedWallet,
  initPrivy,
  sendEmailOtp,
  verifyEmailOtp
} from '../../console/privy-auth.js';

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
