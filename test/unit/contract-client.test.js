import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGISTRY_ADDRESS,
  USDC_ADDRESS,
  ARC_CHAIN_ID_DEC,
  ARC_CHAIN_ID_HEX,
  ARC_RPC_URL,
  ARC_EXPLORER_TX,
  TIER_FEES,
  PROTOCOL_FEE,
  SELECTORS,
  padAddress,
  padUint256,
  padBytes32,
  ensureArcNetwork,
  fetchOnChainSubscription,
  executeSubscribeOnChain,
  executeCommitProofOnChain,
  executeAuthorizeAuditorOnChain
} from '../../console/contract-client.js';

test('Unit: Contract constants are configured correctly for Circle Arc Testnet', () => {
  assert.equal(REGISTRY_ADDRESS, '0x56204E81959cE4015507d8d20434d28DBC166fE2');
  assert.equal(USDC_ADDRESS, '0x3600000000000000000000000000000000000000');
  assert.equal(ARC_CHAIN_ID_DEC, 5042002);
  assert.equal(ARC_CHAIN_ID_HEX, '0x4cef52');
  assert.equal(ARC_RPC_URL, 'https://rpc.testnet.arc.io');
  assert.equal(ARC_EXPLORER_TX, 'https://explorer.testnet.arc.io/tx/');
  assert.equal(TIER_FEES.enterprise, 50_000_000n);
  assert.equal(TIER_FEES.partner, 150_000_000n);
  assert.equal(PROTOCOL_FEE, 5_000_000n);
});

test('Unit: Function selectors match Solidity interfaces', () => {
  assert.equal(SELECTORS.getSubscription, '0x0cbebc24');
  assert.equal(SELECTORS.subscribe, '0x3a04bc0c');
  assert.equal(SELECTORS.commitAuditProof, '0x6cdc2c15');
  assert.equal(SELECTORS.authorizeAuditor, '0x6f5ca4d2');
  assert.equal(SELECTORS.approve, '0x095ea7b3');
  assert.equal(SELECTORS.allowance, '0xdd62ed3e');
});

test('Unit: ABI encoding helpers format 32-byte words properly', () => {
  const addr = '0xDe45Ec28834C609307BEf5651688A6c41d5e6994';
  const paddedAddr = padAddress(addr);
  assert.equal(paddedAddr.length, 64);
  assert.equal(paddedAddr.endsWith('de45ec28834c609307bef5651688a6c41d5e6994'), true);
  assert.equal(padAddress(null), '0'.repeat(64));

  const paddedNum = padUint256(50_000_000n);
  assert.equal(paddedNum.length, 64);
  assert.equal(paddedNum.endsWith('2faf080'), true);
  assert.equal(padUint256(0), '0'.repeat(64));

  const paddedHash = padBytes32('0x1234');
  assert.equal(paddedHash.length, 64);
  assert.equal(paddedHash.startsWith('1234'), true);
  assert.equal(padBytes32(null), '0'.repeat(64));
});

test('Unit: ensureArcNetwork switches or adds chain via provider', async () => {
  let switched = false;
  const mockProvider = {
    request: async ({ method, params }) => {
      if (method === 'eth_chainId') return '0x1'; // Ethereum Mainnet
      if (method === 'wallet_switchEthereumChain') {
        switched = true;
        return null;
      }
    }
  };

  const res = await ensureArcNetwork(mockProvider);
  assert.equal(res, true);
  assert.equal(switched, true);

  // Already on Arc
  const arcProvider = {
    request: async ({ method }) => {
      if (method === 'eth_chainId') return ARC_CHAIN_ID_HEX;
    }
  };
  assert.equal(await ensureArcNetwork(arcProvider), true);
  assert.equal(await ensureArcNetwork(null), false);
});

test('Unit: fetchOnChainSubscription returns default Free tier on empty address', async () => {
  const sub = await fetchOnChainSubscription(null);
  assert.equal(sub.tier, 'Free');
  assert.equal(sub.tierCode, 0);
  assert.equal(sub.isActive, false);
});

test('Unit: executeSubscribeOnChain, executeCommitProofOnChain, executeAuthorizeAuditorOnChain handle mock provider', async () => {
  const mockTxHash = '0xabc123def456';
  const mockProvider = {
    request: async ({ method, params }) => {
      if (method === 'eth_chainId') return ARC_CHAIN_ID_HEX;
      if (method === 'eth_accounts') return ['0xDe45Ec28834C609307BEf5651688A6c41d5e6994'];
      if (method === 'eth_sendTransaction') return mockTxHash;
      return null;
    }
  };

  // Subscribe mock
  const subTx = await executeSubscribeOnChain(mockProvider, 1, 1);
  assert.equal(subTx, mockTxHash);

  // Commit proof mock
  const commitTx = await executeCommitProofOnChain(
    mockProvider,
    '0xDe45Ec28834C609307BEf5651688A6c41d5e6994',
    '0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000',
    1000,
    2000,
    10
  );
  assert.equal(commitTx, mockTxHash);

  // Authorize auditor mock
  const authTx = await executeAuthorizeAuditorOnChain(
    mockProvider,
    '0x1234567890123456789012345678901234567890',
    Math.floor(Date.now() / 1000) + 86400,
    '0xscope'
  );
  assert.equal(authTx, mockTxHash);
});
