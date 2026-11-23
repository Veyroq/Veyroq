import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { VeyroqExporter } from '../../console/exporter.js';
import {
  sha256,
  keccak256Utf8,
  computeTransactionLeaf,
  buildMerkleTree,
  computeMerkleRoot,
  getMerkleProof,
  verifyMerkleProofLocal,
  verifyCertificatePayload,
  DEMO_TRANSACTIONS,
  WALLET_PRESETS
} from '../../console/app.js';
import {
  hexToBytes,
  bytesToHex,
  keccak256Hex,
  hashPairSorted,
  normalizeBytes32
} from '../../console/merkle.js';

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

test('Unit: keccak256Utf8, keccak256Hex, and hashPairSorted match ethers and OpenZeppelin vectors', () => {
  for (const s of ['', 'abc', 'hello veyroq', 'x'.repeat(300)]) {
    assert.equal(keccak256Utf8(s), ethers.keccak256(ethers.toUtf8Bytes(s)));
  }

  assert.equal(bytesToHex(hexToBytes('0x0a1b')), '0x0a1b');
  assert.equal(keccak256Hex('0x1234'), ethers.keccak256('0x1234'));
  assert.throws(() => hexToBytes('0xzz'), /Invalid hex input/);

  const l1 = keccak256Utf8('Tx1: $50,000 to Vendor B');
  const l2 = keccak256Utf8('Tx2: $12,500 to Employee C');
  const ozRoot = l1 <= l2
    ? ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [l1, l2])
    : ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [l2, l1]);
  assert.equal(hashPairSorted(l1, l2), ozRoot);
  assert.equal(hashPairSorted(l2, l1), ozRoot);
  assert.equal(normalizeBytes32('0xabcd').length, 66);
});

test('Unit: buildMerkleTree, getMerkleProof, and verifyMerkleProofLocal verify leaves across sizes 0..7', () => {
  assert.deepEqual(buildMerkleTree([]), { root: '0x00', leaves: [], levels: [], proofs: [] });

  for (const n of [1, 2, 3, 5, 6, 7]) {
    const leaves = Array.from({ length: n }, (_, i) => keccak256Utf8(`leaf-${i}`));
    const tree = buildMerkleTree(leaves);
    assert.equal(tree.root.length, 66);
    for (let i = 0; i < n; i++) {
      const proof = getMerkleProof(leaves, i);
      assert.deepEqual(proof, tree.proofs[i]);
      assert.equal(verifyMerkleProofLocal(leaves[i], proof, tree.root), true);
      assert.equal(verifyMerkleProofLocal(keccak256Utf8(`forged-${i}`), proof, tree.root), false);
    }
  }
  assert.equal(verifyMerkleProofLocal('not-hex', [], '0x00'), false);
});

test('Unit: verifyCertificatePayload detects valid, tampered, redacted, and on-chain states', () => {
  const txs = DEMO_TRANSACTIONS.slice(0, 3).map(tx => ({ ...tx }));
  const leaves = txs.map(tx => {
    const h = computeTransactionLeaf(tx);
    tx.leafHash = h;
    return h;
  });
  const tree = buildMerkleTree(leaves);
  txs.forEach((tx, i) => { tx.merkleProof = tree.proofs[i]; });

  const cert = VeyroqExporter.buildAuditCertificate(txs, tree.root, '0xDe45Ec28834C609307BEf5651688A6c41d5e6994', '2026-Q3', 'Arc Testnet', {
    disclosureScope: 'full',
    commitment: { proofId: 0, txHash: '0x' + 'a'.repeat(64) }
  });

  const validRes = verifyCertificatePayload(cert, {
    onChainRoot: tree.root,
    onChainBatchResults: [true, true, true]
  });
  assert.equal(validRes.valid, true);
  assert.equal(validRes.fieldsIntact, true);
  assert.equal(validRes.rootMatchesOnChain, true);
  assert.equal(validRes.onChainInclusionValid, true);

  // Tamper 1 dollar amount on full certificate
  const tamperedCert = structuredClone(cert);
  tamperedCert.leafCommitments[0].amountUSDC += 1;
  const tamperedRes = verifyCertificatePayload(tamperedCert);
  assert.equal(tamperedRes.valid, false);
  assert.equal(tamperedRes.fieldsIntact, false);
  assert.deepEqual(tamperedRes.tamperedFieldIndices, [0]);

  // Mismatched on-chain root
  const wrongRootRes = verifyCertificatePayload(cert, { onChainRoot: '0x' + 'f'.repeat(64) });
  assert.equal(wrongRootRes.valid, false);
  assert.equal(wrongRootRes.rootMatchesOnChain, false);

  // Failed on-chain batch verification
  const failedBatchRes = verifyCertificatePayload(cert, {
    onChainRoot: tree.root,
    onChainBatchResults: [true, false, true]
  });
  assert.equal(failedBatchRes.valid, false);
  assert.deepEqual(failedBatchRes.failedOnChainIndices, [1]);

  // Redacted certificate passes Merkle verification without recomputing plaintext leaf fields
  const redactedCert = structuredClone(cert);
  redactedCert.verification.disclosureScope = 'redacted';
  redactedCert.leafCommitments = redactedCert.leafCommitments.map(c => ({
    ...c,
    counterparty: '[REDACTED] PAYROLL'
  }));
  const redactedRes = verifyCertificatePayload(redactedCert, {
    onChainRoot: tree.root,
    onChainBatchResults: [true, true, true]
  });
  assert.equal(redactedRes.scope, 'redacted');
  assert.equal(redactedRes.fieldsIntact, null);
  assert.equal(redactedRes.valid, true);

  // Malformed payload
  assert.equal(verifyCertificatePayload(null).valid, false);
  assert.equal(verifyCertificatePayload({ verification: { merkleRootHash: 'zz' }, leafCommitments: [{}] }).valid, false);

  // Deleting a row (omission attack) fails completeness even if remaining rows pass Merkle inclusion
  const deletedRowCert = structuredClone(cert);
  deletedRowCert.leafCommitments.pop();
  const deletedRes = verifyCertificatePayload(deletedRowCert, {
    onChainRoot: tree.root,
    onChainTxCount: 3,
    onChainBatchResults: [true, true]
  });
  assert.equal(deletedRes.valid, false);
  assert.equal(deletedRes.treeComplete, false);
  assert.equal(deletedRes.onChainCountMatch, false);
  assert.equal(deletedRes.declaredCountMatch, false);
  assert.equal(deletedRes.completenessValid, false);

  // Even if attacker also forges totalTransactions & grossVolumeUSDC after deleting a row, Merkle root reconstruction catches it
  const forgedCountCert = structuredClone(deletedRowCert);
  forgedCountCert.verification.totalTransactions = 2;
  forgedCountCert.verification.grossVolumeUSDC = forgedCountCert.leafCommitments.reduce((s, r) => s + r.amountUSDC, 0);
  const forgedCountRes = verifyCertificatePayload(forgedCountCert, {
    onChainRoot: tree.root,
    onChainTxCount: 3,
    onChainBatchResults: [true, true]
  });
  assert.equal(forgedCountRes.valid, false);
  assert.equal(forgedCountRes.treeComplete, false);
  assert.equal(forgedCountRes.onChainCountMatch, false);

  // Editing declared grossVolumeUSDC without touching rows fails completeness
  const tamperedGrossCert = structuredClone(cert);
  tamperedGrossCert.verification.grossVolumeUSDC = 1;
  const tamperedGrossRes = verifyCertificatePayload(tamperedGrossCert);
  assert.equal(tamperedGrossRes.valid, false);
  assert.equal(tamperedGrossRes.grossVolumeMatch, false);

  // Flipping a hex char in verification.merkleRootHash fails root, tree, and row proofs
  const tamperedRootCert = structuredClone(cert);
  const lastHex = tree.root.endsWith('0') ? '1' : '0';
  tamperedRootCert.verification.merkleRootHash = tree.root.slice(0, -1) + lastHex;
  const tamperedRootRes = verifyCertificatePayload(tamperedRootCert, { onChainRoot: tree.root, onChainTxCount: 3 });
  assert.equal(tamperedRootRes.valid, false);
  assert.equal(tamperedRootRes.rootMatchesOnChain, false);
  assert.equal(tamperedRootRes.treeComplete, false);
  assert.equal(tamperedRootRes.verifiedCount, 0);
});
