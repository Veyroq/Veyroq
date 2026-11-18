import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORKS,
  addressToTopic,
  formatUnitsUSDC,
  saveTransactionTag,
  getTransactionTag,
  getStoredTags,
  getExplorerAddressUrl,
  rpcCall,
  fetchLiveTransactions,
  fetchUsdcBalance
} from '../../console/chain-scanner.js';

test('Unit: NETWORKS configuration contains valid Arc and EVM endpoints', () => {
  assert.equal(NETWORKS['Arc'].chainId, 5042002);
  assert.equal(NETWORKS['Arc'].rpcUrl, 'https://rpc.testnet.arc.io');
  assert.equal(NETWORKS['Base'].chainId, 8453);
  assert.equal(NETWORKS['Ethereum'].chainId, 1);
});

test('Unit: addressToTopic formats 20-byte address to 32-byte topic', () => {
  const addr = '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec';
  const topic = addressToTopic(addr);

  assert.equal(topic.length, 66); // '0x' + 64 hex chars
  assert.equal(topic.toLowerCase().endsWith('71c8b46b08639f70efa4c34db895c989c7fa22ec'), true);
  assert.equal(topic.startsWith('0x000000000000000000000000'), true);
});

test('Unit: addressToTopic returns null for invalid input', () => {
  assert.equal(addressToTopic(null), null);
  assert.equal(addressToTopic('invalid'), null);
});

test('Unit: formatUnitsUSDC correctly formats 6-decimal amounts', () => {
  // 5,000 USDC = 5,000,000,000 units (0x12a05f200)
  assert.equal(formatUnitsUSDC('0x12a05f200'), 5000);

  // 12.50 USDC = 12,500,000 units
  assert.equal(formatUnitsUSDC(12500000n), 12.5);

  // 0 USDC
  assert.equal(formatUnitsUSDC('0x0'), 0);
  assert.equal(formatUnitsUSDC(null), 0);
});

test('Unit: saveTransactionTag and getTransactionTag persist and retrieve tags', () => {
  const hash = '0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b';
  saveTransactionTag(hash, 'Alex - Senior Dev Salary', 'Payroll', 'Milestone 3 payout');

  // Retrieve with matching hash
  const tagInfo = getTransactionTag(hash);
  assert.notEqual(tagInfo, null);
  assert.equal(tagInfo.tag, 'Alex - Senior Dev Salary');
  assert.equal(tagInfo.category, 'Payroll');
  assert.equal(tagInfo.notes, 'Milestone 3 payout');

  // Case-insensitive lookup
  const tagInfoUpper = getTransactionTag(hash.toUpperCase());
  assert.notEqual(tagInfoUpper, null);
  assert.equal(tagInfoUpper.tag, 'Alex - Senior Dev Salary');
});

test('Unit: fetchLiveTransactions gracefully handles invalid address', async () => {
  await assert.rejects(
    async () => fetchLiveTransactions('not_an_address', 'Arc'),
    { message: 'Invalid EVM address' }
  );
});

test('Unit: getExplorerAddressUrl formats address links', () => {
  const url = getExplorerAddressUrl('Arc', '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec');
  assert.equal(url.includes('/address/0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec'), true);
});

test('Unit: getStoredTags returns tag map and handles empty key lookups', () => {
  assert.equal(typeof getStoredTags(), 'object');
  assert.equal(getTransactionTag(null), null);
  assert.equal(saveTransactionTag(null, 'test'), undefined);
});

test('Unit: rpcCall parses valid RPC responses and catches errors', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      json: async () => ({ result: '0x123' })
    });
    const res = await rpcCall('http://mock-rpc', 'eth_blockNumber');
    assert.equal(res, '0x123');

    globalThis.fetch = async () => ({
      json: async () => ({ error: { message: 'Method not supported' } })
    });
    await assert.rejects(
      async () => rpcCall('http://mock-rpc', 'unknown_method'),
      { message: 'Method not supported' }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unit: fetchLiveTransactions parses transfer logs into transactions', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'eth_blockNumber') return { json: async () => ({ result: '0x1000' }) };
      if (body.method === 'eth_getLogs') {
        return {
          json: async () => ({
            result: [{
              blockNumber: '0x1000',
              data: '0x0000000000000000000000000000000000000000000000000000000002faf080',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x00000000000000000000000071c8b46b08639f70efa4c34db895c989c7fa22ec',
                '0x0000000000000000000000001234567890123456789012345678901234567890'
              ],
              transactionHash: '0xabc123'
            }]
          })
        };
      }
      return { json: async () => ({ result: null }) };
    };

    const txs = await fetchLiveTransactions('0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec', 'Arc');
    assert.equal(txs.length, 2);
    assert.equal(txs[0].grossAmount, 50);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unit: fetchUsdcBalance queries ERC-20 balance on configured chains and handles unsupported/invalid inputs', async () => {
  const badRes = await fetchUsdcBalance('invalid', 'Arc');
  assert.equal(badRes.supported, false);

  const unconfiguredRes = await fetchUsdcBalance('0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec', 'Monad');
  assert.equal(unconfiguredRes.supported, false);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      json: async () => ({ result: '0x0000000000000000000000000000000000000000000000000000000002faf080' }) // 50_000_000 = 50 USDC
    });
    const arcBal = await fetchUsdcBalance('0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec', 'Arc');
    assert.equal(arcBal.supported, true);
    assert.equal(arcBal.balance, 50);
    assert.equal(arcBal.raw, 50_000_000n);
    assert.equal(arcBal.symbol, 'USDC');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unit: fetchLiveTransactions filters eth_getLogs by USDC contract and drops 18-decimal Arc native duplicate logs', async () => {
  const originalFetch = globalThis.fetch;
  const capturedLogFilters = [];
  try {
    globalThis.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'eth_blockNumber') return { json: async () => ({ result: '0x4564656' }) };
      if (body.method === 'eth_getLogs') {
        capturedLogFilters.push(body.params[0]);
        const isSentFilter = Boolean(body.params[0].topics[1]);
        return {
          json: async () => ({
            result: isSentFilter ? [
              {
                address: '0xfffffffffffffffffffffffffffffffffffffffe', // Arc 18-dec native duplicate
                blockNumber: '0x4564656',
                blockTimestamp: '0x6afced9f',
                data: '0x000000000000000000000000000000000000000000000002b5e3af16b1880000',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x00000000000000000000000071c8b46b08639f70efa4c34db895c989c7fa22ec',
                  '0x0000000000000000000000002793309a81d4111b8a5fedb9a16a1dde49d3bfea'
                ],
                transactionHash: '0xdup123',
                logIndex: '0x3'
              },
              {
                address: '0x3600000000000000000000000000000000000000', // Canonical 6-dec USDC
                blockNumber: '0x4564656',
                blockTimestamp: '0x6afced9f',
                data: '0x0000000000000000000000000000000000000000000000000000000002faf080',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x00000000000000000000000071c8b46b08639f70efa4c34db895c989c7fa22ec',
                  '0x0000000000000000000000002793309a81d4111b8a5fedb9a16a1dde49d3bfea'
                ],
                transactionHash: '0xdup123',
                logIndex: '0x4'
              }
            ] : []
          })
        };
      }
      return { json: async () => ({ result: null }) };
    };

    const txs = await fetchLiveTransactions('0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec', 'Arc');
    assert.equal(capturedLogFilters.length, 2);
    assert.equal(capturedLogFilters[0].address, NETWORKS['Arc'].usdcAddress);
    assert.equal(capturedLogFilters[1].address, NETWORKS['Arc'].usdcAddress);
    assert.equal(txs.length, 1);
    assert.equal(txs[0].grossAmount, 50);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

