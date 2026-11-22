import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
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
  encodeVerifyTransactionInclusion,
  encodeVerifyBatchInclusion,
  decodeAuditCommitments,
  decodeBoolArray,
  waitForTxReceipt,
  ensureArcNetwork,
  fetchOnChainSubscription,
  fetchProtocolFee,
  fetchCommitmentCount,
  fetchAuditCommitments,
  resolveLatestProofId,
  verifyTransactionInclusionOnChain,
  verifyBatchInclusionOnChain,
  executeSubscribeOnChain,
  executeCommitProofOnChain,
  executeAuthorizeAuditorOnChain,
  executeRevokeAuditorOnChain
} from '../../console/contract-client.js';

test('Unit: Contract constants are configured correctly for Circle Arc Testnet', () => {
  assert.equal(REGISTRY_ADDRESS, '0x8A1D55E8E07fa49edF4c0a420b8B033ad03B37B3');
  assert.equal(USDC_ADDRESS, '0x3600000000000000000000000000000000000000');
  assert.equal(ARC_CHAIN_ID_DEC, 5042002);
  assert.equal(ARC_CHAIN_ID_HEX, '0x4cef52');
  assert.equal(ARC_RPC_URL, 'https://rpc.testnet.arc.io');
  assert.equal(ARC_EXPLORER_TX, 'https://explorer.testnet.arc.io/tx/');
  assert.equal(TIER_FEES.single_org, 5_000_000n);
  assert.equal(TIER_FEES.enterprise, 50_000_000n);
  assert.equal(TIER_FEES.partner, 150_000_000n);
  assert.equal(PROTOCOL_FEE, 0n);
});

test('Unit: Function selectors match Solidity interfaces', () => {
  assert.equal(SELECTORS.getSubscription, '0x0cbebc24');
  assert.equal(SELECTORS.subscribe, '0x3a04bc0c');
  assert.equal(SELECTORS.commitAuditProof, '0x6cdc2c15');
  assert.equal(SELECTORS.authorizeAuditor, '0x6f5ca4d2');
  assert.equal(SELECTORS.approve, '0x095ea7b3');
  assert.equal(SELECTORS.allowance, '0xdd62ed3e');
  assert.equal(SELECTORS.protocolFee, '0xb0e21e8a');
  assert.equal(SELECTORS.getCommitmentCount, '0xb536148f');
  assert.equal(SELECTORS.getAuditCommitments, '0x583a5fa3');
  assert.equal(SELECTORS.verifyTransactionInclusion, '0xe5ee75a7');
  assert.equal(SELECTORS.verifyBatchInclusion, '0x30c6a97f');
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

  // Test 4902 add chain branch
  let added = false;
  const mockAddProvider = {
    request: async ({ method }) => {
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain') {
        const err = new Error('Unrecognized chain');
        err.code = 4902;
        throw err;
      }
      if (method === 'wallet_addEthereumChain') {
        added = true;
        return null;
      }
    }
  };
  assert.equal(await ensureArcNetwork(mockAddProvider), true);
  assert.equal(added, true);

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

test('Unit: fetchOnChainSubscription parses on-chain response properly', async () => {
  const originalFetch = globalThis.fetch;
  const hexResult = '0x' + padUint256(2) + padUint256(1000) + padUint256(1);
  globalThis.fetch = async () => ({
    json: async () => ({ jsonrpc: '2.0', id: 1, result: hexResult })
  });
  try {
    const sub = await fetchOnChainSubscription('0x1234567890123456789012345678901234567890');
    assert.equal(sub.tier, 'Enterprise Treasury');
    assert.equal(sub.tierCode, 2);
    assert.equal(sub.isActive, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x' + 'f'.repeat(64) })
  });

  try {
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unit: waitForTxReceipt resolves on confirmed receipt and throws on reverted tx', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      json: async () => ({ result: { status: '0x1', transactionHash: '0x123' } })
    });
    const okReceipt = await waitForTxReceipt('0x123', 2000);
    assert.equal(okReceipt.status, '0x1');

    globalThis.fetch = async () => ({
      json: async () => ({ result: { status: '0x0', transactionHash: '0xdead' } })
    });
    await assert.rejects(
      async () => waitForTxReceipt('0xdead', 2000),
      { message: /reverted on-chain/ }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unit: ABI encoders/decoders match ethers.Interface for verification and commitments', () => {
  const iface = new ethers.Interface([
    'function verifyTransactionInclusion(address,uint256,bytes32,bytes32[]) view returns (bool)',
    'function verifyBatchInclusion(address,uint256,bytes32[],bytes32[][]) view returns (bool[])',
    'function getAuditCommitments(address,uint256,uint256) view returns (tuple(bytes32 auditRootHash,uint256 periodStart,uint256 periodEnd,uint256 transactionCount,bytes32 metadataHash,uint256 timestamp,address submitter)[])'
  ]);
  const org = '0xDe45Ec28834C609307BEf5651688A6c41d5e6994';
  const l1 = '0x' + '11'.repeat(32);
  const l2 = '0x' + '22'.repeat(32);
  const p1 = ['0x' + 'aa'.repeat(32)];
  const p2 = ['0x' + 'bb'.repeat(32), '0x' + 'cc'.repeat(32)];

  assert.equal(
    encodeVerifyTransactionInclusion(org, 4, l1, p1),
    iface.encodeFunctionData('verifyTransactionInclusion', [org, 4, l1, p1])
  );
  assert.equal(
    encodeVerifyBatchInclusion(org, 4, [l1, l2], [p1, p2]),
    iface.encodeFunctionData('verifyBatchInclusion', [org, 4, [l1, l2], [p1, p2]])
  );

  const encodedBools = iface.encodeFunctionResult('verifyBatchInclusion', [[true, false, true]]);
  assert.deepEqual(decodeBoolArray(encodedBools), [true, false, true]);
  assert.deepEqual(decodeBoolArray('0x'), []);

  const encodedCommits = iface.encodeFunctionResult('getAuditCommitments', [[
    { auditRootHash: l1, periodStart: 100, periodEnd: 200, transactionCount: 6, metadataHash: ethers.ZeroHash, timestamp: 300, submitter: org }
  ]]);
  const decoded = decodeAuditCommitments(encodedCommits, 7);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].proofId, 7);
  assert.equal(decoded[0].auditRootHash, l1);
  assert.equal(decoded[0].transactionCount, 6);
  assert.equal(decoded[0].submitter, org.toLowerCase());
  assert.deepEqual(decodeAuditCommitments('0x'), []);
});

test('Unit: fetchProtocolFee and executeCommitProofOnChain respect dynamic fee (0 USDC skips approve, >0 approves)', async () => {
  const originalFetch = globalThis.fetch;
  const org = '0xDe45Ec28834C609307BEf5651688A6c41d5e6994';
  const rootHash = '0x' + 'ab'.repeat(32);

  try {
    // 1. Dynamic protocolFee = 0n -> only 1 tx (commitAuditProof), zero USDC.approve
    let feeHex = '0x' + padUint256(0);
    let allowanceHex = '0x' + padUint256(0);
    const sentTxs = [];
    const provider = {
      request: async ({ method, params }) => {
        if (method === 'eth_chainId') return ARC_CHAIN_ID_HEX;
        if (method === 'eth_accounts') return [org];
        if (method === 'eth_sendTransaction') {
          sentTxs.push(params[0]);
          return '0xcommit1';
        }
        return null;
      }
    };

    globalThis.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'eth_getTransactionReceipt') {
        return { json: async () => ({ result: { status: '0x1' } }) };
      }
      const callData = body.params?.[0]?.data || '';
      if (callData.startsWith(SELECTORS.protocolFee)) return { json: async () => ({ result: feeHex }) };
      if (callData.startsWith(SELECTORS.allowance)) return { json: async () => ({ result: allowanceHex }) };
      return { json: async () => ({ result: '0x0' }) };
    };

    assert.equal(await fetchProtocolFee(), 0n);
    const tx0 = await executeCommitProofOnChain(provider, org, rootHash, 100, 200, 3);
    assert.equal(tx0, '0xcommit1');
    assert.equal(sentTxs.length, 1);
    assert.equal(sentTxs[0].data.startsWith(SELECTORS.commitAuditProof), true);

    // 2. Dynamic protocolFee = 5 USDC & allowance = 0 -> sends approve then commitAuditProof
    sentTxs.length = 0;
    feeHex = '0x' + padUint256(5_000_000n);
    assert.equal(await fetchProtocolFee(), 5_000_000n);
    await executeCommitProofOnChain(provider, org, rootHash, 100, 200, 3);
    assert.equal(sentTxs.length, 2);
    assert.equal(sentTxs[0].data.startsWith(SELECTORS.approve), true);
    assert.equal(sentTxs[1].data.startsWith(SELECTORS.commitAuditProof), true);

    // 3. Error fallback returns PROTOCOL_FEE (0n)
    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.equal(await fetchProtocolFee(), 0n);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unit: On-chain proof readers (fetchCommitmentCount, resolveLatestProofId, verify*) work against RPC', async () => {
  const originalFetch = globalThis.fetch;
  const iface = new ethers.Interface([
    'function verifyBatchInclusion(address,uint256,bytes32[],bytes32[][]) view returns (bool[])',
    'function getAuditCommitments(address,uint256,uint256) view returns (tuple(bytes32 auditRootHash,uint256 periodStart,uint256 periodEnd,uint256 transactionCount,bytes32 metadataHash,uint256 timestamp,address submitter)[])'
  ]);
  const org = '0xDe45Ec28834C609307BEf5651688A6c41d5e6994';
  const root = '0x' + '77'.repeat(32);

  globalThis.fetch = async (_url, opts) => {
    const data = JSON.parse(opts.body).params?.[0]?.data || '';
    if (data.startsWith(SELECTORS.getCommitmentCount)) {
      return { json: async () => ({ result: '0x' + padUint256(2) }) };
    }
    if (data.startsWith(SELECTORS.getAuditCommitments)) {
      const encoded = iface.encodeFunctionResult('getAuditCommitments', [[
        { auditRootHash: '0x' + '11'.repeat(32), periodStart: 1, periodEnd: 2, transactionCount: 1, metadataHash: ethers.ZeroHash, timestamp: 10, submitter: org },
        { auditRootHash: root, periodStart: 3, periodEnd: 4, transactionCount: 2, metadataHash: ethers.ZeroHash, timestamp: 20, submitter: org }
      ]]);
      return { json: async () => ({ result: encoded }) };
    }
    if (data.startsWith(SELECTORS.verifyTransactionInclusion)) {
      return { json: async () => ({ result: '0x' + padUint256(1) }) };
    }
    if (data.startsWith(SELECTORS.verifyBatchInclusion)) {
      return { json: async () => ({ result: iface.encodeFunctionResult('verifyBatchInclusion', [[true, true]]) }) };
    }
    return { json: async () => ({ result: '0x' }) };
  };

  try {
    assert.equal(await fetchCommitmentCount(org), 2);
    assert.equal((await fetchAuditCommitments(org, 0, 2)).length, 2);
    const resolved = await resolveLatestProofId(org, root);
    assert.equal(resolved.proofId, 1);
    assert.equal(await verifyTransactionInclusionOnChain(org, 1, root, []), true);
    assert.deepEqual(await verifyBatchInclusionOnChain(org, 1, [root, root], [[], []]), [true, true]);
    assert.deepEqual(await verifyBatchInclusionOnChain(org, 1, [], []), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unit: executeRevokeAuditorOnChain sends exact revokeAuditor(address) selector', async () => {
  assert.equal(SELECTORS.revokeAuditor, ethers.id('revokeAuditor(address)').slice(0, 10));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => ({ result: { status: '0x1' } }) });
  let sentTx = null;
  const mockProvider = {
    request: async ({ method, params }) => {
      if (method === 'eth_chainId') return ARC_CHAIN_ID_HEX;
      if (method === 'eth_accounts') return ['0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec'];
      if (method === 'eth_sendTransaction') {
        sentTx = params[0];
        return '0x' + 'ab'.repeat(32);
      }
      return null;
    }
  };
  try {
    const txHash = await executeRevokeAuditorOnChain(mockProvider, '0x2793309a81D4111b8a5FEDb9A16a1DdE49D3bfeA');
    assert.equal(txHash, '0x' + 'ab'.repeat(32));
    assert.equal(sentTx.to, REGISTRY_ADDRESS);
    assert.equal(sentTx.data.startsWith(SELECTORS.revokeAuditor), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

