import test from 'node:test';
import assert from 'node:assert/strict';
import { connectInjectedWallet, getAuthState } from '../../console/privy-auth.js';
import { saveTransactionTag, getTransactionTag } from '../../console/chain-scanner.js';
import { prepareExportTransactions, DEMO_TRANSACTIONS } from '../../console/app.js';
import { VeyroqExporter } from '../../console/exporter.js';

test('Integration: Privy / Web3 Wallet connection -> Tagging -> Export pipeline', async () => {
  // 1. Connect wallet
  const mockAddress = '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec';
  const mockProvider = {
    request: async ({ method }) => {
      if (method === 'eth_requestAccounts') return [mockAddress];
      return [];
    }
  };

  const connected = await connectInjectedWallet(mockProvider);
  assert.equal(connected, mockAddress);
  assert.equal(getAuthState().isAuthenticated, true);

  // 2. Take a transaction and assign custom tag
  const targetTx = DEMO_TRANSACTIONS[0];
  const customTag = 'Sarah - Senior Rust Engineer Salary';
  const customCategory = 'Payroll';
  const customNotes = 'Sprint 42 completion payout';

  saveTransactionTag(targetTx.hash, customTag, customCategory, customNotes);

  const retrievedTag = getTransactionTag(targetTx.hash);
  assert.equal(retrievedTag.tag, customTag);
  assert.equal(retrievedTag.category, customCategory);

  // 3. Prepare tagged transactions for QuickBooks export
  const taggedBatch = DEMO_TRANSACTIONS.map(tx => {
    const tagInfo = getTransactionTag(tx.hash);
    return {
      ...tx,
      plainCounterparty: tagInfo?.tag || tx.plainCounterparty,
      category: tagInfo?.category || tx.category
    };
  });

  const qbCSV = VeyroqExporter.generateQuickBooksCSV(taggedBatch, mockAddress, '2026-Q3');
  assert.equal(qbCSV.includes(customTag), true);
  assert.equal(qbCSV.includes('35000.00'), true);
  assert.equal(qbCSV.includes('Payroll Expenses:Officer Compensation'), true);

  // 4. Verify Selective Disclosure zero-leak on tagged item
  const redactedBatch = prepareExportTransactions(taggedBatch, 'redacted');
  const redactedCSV = VeyroqExporter.generateQuickBooksCSV(redactedBatch, mockAddress, '2026-Q3');

  // Must NOT leak Sarah's name
  assert.equal(redactedCSV.includes('Sarah'), false);
  // Must preserve category and amount
  assert.equal(redactedCSV.includes('35000.00'), true);
  assert.equal(redactedCSV.includes('[REDACTED]'), true);
});
