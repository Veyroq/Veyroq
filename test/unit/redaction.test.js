import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareExportTransactions, DEMO_TRANSACTIONS } from '../../console/app.js';

test('Unit: prepareExportTransactions preserves plain counterparties in full scope', () => {
  const fullTxs = prepareExportTransactions(DEMO_TRANSACTIONS, 'full');
  assert.equal(fullTxs.length, DEMO_TRANSACTIONS.length);
  assert.equal(fullTxs[0].plainCounterparty, 'Dr. Elena Rostova (Chief AI Scientist)');
  assert.equal(fullTxs[1].plainCounterparty, 'Lambda Compute Corp (A100 Cluster)');
});

test('Unit: prepareExportTransactions masks counterparties in redacted scope', () => {
  const sample = [
    {
      id: 'tx-01',
      type: 'CONFIDENTIAL_PAYROLL',
      category: 'Officer Compensation (W-2)',
      plainCounterparty: 'Dr. Elena Rostova (Chief AI Scientist)',
      grossAmount: 35000,
      leafHash: '0x97f4f49fabcde123456789'
    }
  ];

  const redacted = prepareExportTransactions(sample, 'redacted');
  assert.equal(redacted.length, 1);
  assert.equal(redacted[0].grossAmount, 35000);
  assert.equal(redacted[0].plainCounterparty, '[REDACTED] CONFIDENTIAL PAYROLL [0x97f4f49f...]');
  assert.equal(redacted[0].plainCounterparty.includes('Elena Rostova'), false);
});

test('Unit: prepareExportTransactions zero-leak guarantee on entire batch', () => {
  const withLeaves = DEMO_TRANSACTIONS.map((tx, idx) => ({
    ...tx,
    leafHash: `0xabcd${idx}1234567890abcdef`
  }));

  const redacted = prepareExportTransactions(withLeaves, 'redacted');

  // Verify no plaintext names exist in any plainCounterparty field
  const forbiddenNames = ['Elena Rostova', 'Lambda Compute', 'BlackRock', 'OpenZeppelin'];
  for (const item of redacted) {
    for (const name of forbiddenNames) {
      assert.equal(item.plainCounterparty.includes(name), false, `Leak detected: ${name} in ${item.plainCounterparty}`);
    }
    assert.equal(item.plainCounterparty.startsWith('[REDACTED]'), true);
  }
});
