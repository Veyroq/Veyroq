import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  generateSiweNonce,
  parseSiweMessage,
  verifySiweSignature,
  verifyVaultOwnershipSiwe,
  activeNonces
} from '../../server.js';

test('Unit: generateSiweNonce generates 32-hex nonce with 15-min TTL', () => {
  const { nonce, expiresAt } = generateSiweNonce('0x1111111111111111111111111111111111111111', 'localhost');
  assert.equal(typeof nonce, 'string');
  assert.equal(nonce.length, 32);
  assert.ok(activeNonces.has(nonce));

  const stored = activeNonces.get(nonce);
  assert.ok(stored.expiresAt > Date.now());
  assert.ok(new Date(expiresAt).getTime() > Date.now());
});

test('Unit: parseSiweMessage correctly parses standard EIP-4361 fields', () => {
  const raw = `veyroq.xyz wants you to sign in with your Ethereum account:
0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec

Verify treasury ownership for Veyroq Institutional Cockpit. This action is zero-gas and NEVER approves token transfers.

URI: https://veyroq.xyz
Version: 1
Chain ID: 5042002
Nonce: a1b2c3d4e5f67890
Issued At: 2026-11-08T00:00:00Z
Expiration Time: 2026-11-08T00:15:00Z`;

  const parsed = parseSiweMessage(raw);
  assert.equal(parsed.domain, 'veyroq.xyz');
  assert.equal(parsed.address, '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec');
  assert.equal(parsed.nonce, 'a1b2c3d4e5f67890');
  assert.equal(parsed.chainId, 5042002);
  assert.equal(parsed.issuedAt, '2026-11-08T00:00:00Z');
  assert.equal(parsed.expirationTime, '2026-11-08T00:15:00Z');
});

test('Unit: verifySiweSignature verifies valid EIP-4361 signature and burns nonce', async () => {
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;
  const domain = 'localhost';

  const { nonce, expiresAt } = generateSiweNonce(address, domain);

  const message = `${domain} wants you to sign in with your Ethereum account:
${address}

Verify treasury ownership for Veyroq Cockpit. No token approvals or transfers.

URI: http://${domain}:3000
Version: 1
Chain ID: 5042002
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}
Expiration Time: ${expiresAt}`;

  const signature = await wallet.signMessage(message);

  // 1. First verification: must succeed
  const result = verifySiweSignature({
    message,
    signature,
    expectedAddress: address,
    expectedDomain: 'localhost:3000'
  });

  assert.equal(result.valid, true);
  assert.equal(result.address.toLowerCase(), address.toLowerCase());
  assert.equal(result.chainId, 5042002);

  // 2. Replay attack: second verification with the same burned nonce must FAIL
  const replayResult = verifySiweSignature({
    message,
    signature,
    expectedAddress: address,
    expectedDomain: 'localhost:3000'
  });

  assert.equal(replayResult.valid, false);
  assert.ok(replayResult.error.includes('Replay protection'));
});

test('Unit: verifySiweSignature rejects expired nonce', async () => {
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;
  const domain = 'localhost';

  const { nonce } = generateSiweNonce(address, domain);

  // Force expire in stored nonces
  const stored = activeNonces.get(nonce);
  stored.expiresAt = Date.now() - 1000;

  const message = `${domain} wants you to sign in with your Ethereum account:
${address}

Verify treasury ownership.

URI: http://${domain}:3000
Version: 1
Chain ID: 5042002
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`;

  const signature = await wallet.signMessage(message);

  const result = verifySiweSignature({
    message,
    signature,
    expectedAddress: address,
    expectedDomain: 'localhost:3000'
  });

  assert.equal(result.valid, false);
  assert.ok(result.error.includes('expired'));
});

test('Unit: verifySiweSignature rejects address spoofing', async () => {
  const victimWallet = ethers.Wallet.createRandom();
  const attackerWallet = ethers.Wallet.createRandom();
  const domain = 'localhost';

  const { nonce } = generateSiweNonce(victimWallet.address, domain);

  // Attacker puts victim's address in message but signs with their own attacker key
  const message = `${domain} wants you to sign in with your Ethereum account:
${victimWallet.address}

Verify treasury ownership.

URI: http://${domain}:3000
Version: 1
Chain ID: 5042002
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`;

  const attackerSignature = await attackerWallet.signMessage(message);

  const result = verifySiweSignature({
    message,
    signature: attackerSignature,
    expectedAddress: victimWallet.address,
    expectedDomain: 'localhost:3000'
  });

  assert.equal(result.valid, false);
  assert.ok(result.error.includes('Cryptographic signature mismatch'));
});

test('Unit: verifySiweSignature rejects malformed and mismatched parameters', () => {
  // Empty message / signature
  assert.equal(verifySiweSignature({}).valid, false);
  assert.equal(verifySiweSignature({ message: 'hi' }).valid, false);

  // Malformed format
  assert.equal(verifySiweSignature({ message: 'not a valid siwe message', signature: '0x123' }).valid, false);

  // Empty string parse
  assert.deepEqual(parseSiweMessage(''), {});
  assert.deepEqual(parseSiweMessage(null), {});

  // Claimed address mismatch
  const wallet = ethers.Wallet.createRandom();
  const { nonce } = generateSiweNonce(wallet.address, 'localhost');
  const message = `localhost wants you to sign in with your Ethereum account:
${wallet.address}

Notice.

URI: http://localhost:3000
Version: 1
Chain ID: 5042002
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`;

  const res = verifySiweSignature({
    message,
    signature: '0x1234',
    expectedAddress: '0x0000000000000000000000000000000000000000',
    expectedDomain: 'localhost:3000'
  });
  assert.equal(res.valid, false);
  assert.ok(res.error.includes('Claimed address does not match'));

  // Domain mismatch
  const { nonce: nonce2 } = generateSiweNonce(wallet.address, 'other-domain.xyz');
  const message2 = `other-domain.xyz wants you to sign in with your Ethereum account:
${wallet.address}

Notice.

URI: https://other-domain.xyz
Version: 1
Chain ID: 5042002
Nonce: ${nonce2}
Issued At: ${new Date().toISOString()}`;

  const resDomain = verifySiweSignature({
    message: message2,
    signature: '0x1234',
    expectedAddress: wallet.address,
    expectedDomain: 'real-domain.com'
  });
  assert.equal(resDomain.valid, false);
  assert.ok(resDomain.error.includes('Domain mismatch'));

  // Localhost SIWE message MUST be rejected against production expectedDomain
  const { nonce: nonceLocal } = generateSiweNonce(wallet.address, 'app.veyroq.xyz');
  const localSpoofMsg = `localhost wants you to sign in with your Ethereum account:
${wallet.address}

Notice.

URI: http://localhost:3000
Version: 1
Chain ID: 5042002
Nonce: ${nonceLocal}
Issued At: ${new Date().toISOString()}`;
  const resProdSpoof = verifySiweSignature({
    message: localSpoofMsg,
    signature: '0x1234',
    expectedAddress: wallet.address,
    expectedDomain: 'app.veyroq.xyz'
  });
  assert.equal(resProdSpoof.valid, false);
  assert.ok(resProdSpoof.error.includes('Domain mismatch'));
});

test('Unit: generateSiweNonce prunes expired nonces when map grows', () => {
  // Insert expired nonce
  activeNonces.set('expired-dummy', {
    address: '0x123',
    domain: 'localhost',
    issuedAt: Date.now() - 100000,
    expiresAt: Date.now() - 1000
  });

  // Temporarily insert dummy nonces to exceed 1000 threshold
  for (let i = 0; i < 1002; i++) {
    activeNonces.set(`dummy-${i}`, {
      address: '0x123',
      domain: 'localhost',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000
    });
  }

  generateSiweNonce('0x123', 'localhost');
  assert.equal(activeNonces.has('expired-dummy'), false);

  // Clean up test dummies
  for (let i = 0; i < 1002; i++) {
    activeNonces.delete(`dummy-${i}`);
  }
});

test('Unit: verifyVaultOwnershipSiwe verifies Safe Multisig via on-chain Safe.isOwner(signer) and EIP-1271', async () => {
  const safeAddr = '0x2793309a81D4111b8a5FEDb9A16a1DdE49D3bfeA';
  const safeOwnerWallet = ethers.Wallet.createRandom();
  const attackerWallet = ethers.Wallet.createRandom();
  const domain = 'localhost';

  const makeMsg = (nonce, exp) => `${domain} wants you to sign in with your Ethereum account:
${safeAddr}

Verify treasury ownership for Veyroq Institutional Cockpit.

URI: http://localhost:3000
Version: 1
Chain ID: 5042002
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}
Expiration Time: ${exp}`;

  const mockSafeProvider = {
    getCode: async () => '0x60806040',
    call: async ({ data }) => {
      const selector = String(data || '').slice(0, 10).toLowerCase();
      if (selector === '0x2f54bf6e') {
        const argAddr = '0x' + String(data).slice(-40).toLowerCase();
        const isOwner = argAddr === safeOwnerWallet.address.toLowerCase();
        return '0x' + (isOwner ? '1' : '0').padStart(64, '0');
      }
      if (selector === '0x1626ba7e') {
        return '0x00000000' + '0'.repeat(56);
      }
      return '0x';
    }
  };

  // 1. Authorized Safe Owner signs -> PASS (role: safe_owner)
  const { nonce: n1, expiresAt: e1 } = generateSiweNonce(safeAddr, domain);
  const msg1 = makeMsg(n1, e1);
  const sigOwner = await safeOwnerWallet.signMessage(msg1);
  const okRes = await verifyVaultOwnershipSiwe({
    message: msg1,
    signature: sigOwner,
    expectedAddress: safeAddr,
    expectedDomain: 'localhost:3000',
    provider: mockSafeProvider
  });
  assert.equal(okRes.valid, true);
  assert.equal(okRes.role, 'safe_owner');
  assert.equal(okRes.address, ethers.getAddress(safeAddr));
  assert.equal(okRes.signer, ethers.getAddress(safeOwnerWallet.address));

  // 2. Non-owner attacker signs -> REJECT
  const { nonce: n2, expiresAt: e2 } = generateSiweNonce(safeAddr, domain);
  const msg2 = makeMsg(n2, e2);
  const sigAttacker = await attackerWallet.signMessage(msg2);
  const badRes = await verifyVaultOwnershipSiwe({
    message: msg2,
    signature: sigAttacker,
    expectedAddress: safeAddr,
    expectedDomain: 'localhost:3000',
    provider: mockSafeProvider
  });
  assert.equal(badRes.valid, false);
  assert.ok(badRes.error.includes('not an active on-chain owner'));

  // 3. EIP-1271 smart contract signature returning 0x1626ba7e -> PASS (role: eip1271)
  const eip1271Provider = {
    getCode: async () => '0x60806040',
    call: async ({ data }) => {
      if (String(data).startsWith('0x1626ba7e')) return '0x1626ba7e' + '0'.repeat(56);
      return '0x' + '0'.repeat(64);
    }
  };
  const { nonce: n3, expiresAt: e3 } = generateSiweNonce(safeAddr, domain);
  const msg3 = makeMsg(n3, e3);
  const contractRes = await verifyVaultOwnershipSiwe({
    message: msg3,
    signature: '0x' + 'aa'.repeat(65),
    expectedAddress: safeAddr,
    expectedDomain: 'localhost:3000',
    provider: eip1271Provider
  });
  assert.equal(contractRes.valid, true);
  assert.equal(contractRes.role, 'eip1271');
});
