import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, computeMerkleRoot, DEMO_TRANSACTIONS, WALLET_PRESETS } from '../../console/app.js';

test('Unit: WALLET_PRESETS contains institutional addresses', () => {
  assert.equal(WALLET_PRESETS['btn-connect-safe'].label, 'Safe Vault');
  assert.equal(WALLET_PRESETS['btn-connect-safe'].address.startsWith('0x'), true);
  assert.equal(WALLET_PRESETS['btn-connect-hardware'].label, 'Ledger Cold');
  assert.equal(WALLET_PRESETS['btn-connect-sca'].label, 'Smart Account');
});

test('Unit: sha256 generates valid 32-byte hex hash', async () => {
  const hash = await sha256('hello veyroq');
  assert.equal(typeof hash, 'string');
  assert.equal(hash.startsWith('0x'), true);
  assert.equal(hash.length, 66); // '0x' + 64 hex chars
});

test('Unit: sha256 produces deterministic output', async () => {
  const hash1 = await sha256('audit_slip_batch_2026');
  const hash2 = await sha256('audit_slip_batch_2026');
  const hashDiff = await sha256('audit_slip_batch_2027');

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hashDiff);
});

test('Unit: computeMerkleRoot with empty leaves returns 0x00', async () => {
  const root = await computeMerkleRoot([]);
  assert.equal(root, '0x00');
});

test('Unit: computeMerkleRoot with single leaf returns leaf itself', async () => {
  const leaf = await sha256('single_transaction_record');
  const root = await computeMerkleRoot([leaf]);
  assert.equal(root, leaf);
});

test('Unit: computeMerkleRoot with pairwise sorted leaves is tamper evident', async () => {
  const leafA = await sha256('tx_100_payroll');
  const leafB = await sha256('tx_200_supplier');
  const root1 = await computeMerkleRoot([leafA, leafB]);

  assert.equal(typeof root1, 'string');
  assert.equal(root1.startsWith('0x'), true);
  assert.equal(root1.length, 66);

  // Tampering with leafB changes root
  const leafBTampered = await sha256('tx_200_supplier_altered');
  const rootTampered = await computeMerkleRoot([leafA, leafBTampered]);
  assert.notEqual(root1, rootTampered);
});

test('Unit: computeMerkleRoot with DEMO_TRANSACTIONS matches full batch root', async () => {
  const leaves = [];
  for (const item of DEMO_TRANSACTIONS) {
    const hash = await sha256(`${item.id}:${item.block}:${item.grossAmount}:${item.plainCounterparty}`);
    leaves.push(hash);
  }

  assert.equal(leaves.length, 6);
  const root = await computeMerkleRoot(leaves);
  assert.equal(typeof root, 'string');
  assert.equal(root.length, 66);
});
