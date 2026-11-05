import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORKS,
  addressToTopic,
  formatUnitsUSDC,
  saveTransactionTag,
  getTransactionTag,
  fetchLiveTransactions
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

