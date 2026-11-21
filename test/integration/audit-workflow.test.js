import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTransactionLeaf,
  buildMerkleTree,
  computeMerkleRoot,
  verifyCertificatePayload,
  prepareExportTransactions,
  DEMO_TRANSACTIONS
} from '../../console/app.js';
import { VeyroqExporter } from '../../console/exporter.js';

test('Integration: End-to-end institutional audit cycle execution', async () => {
  // 1. Simulate on-chain transaction intake from treasury
  const rawBatch = DEMO_TRANSACTIONS.map(tx => ({ ...tx }));
  assert.equal(rawBatch.length, 6);

  // 2. Client-side local Keccak-256 Merkle leaf + sibling proof calculation
  const leafHashes = rawBatch.map(item => {
    const leaf = computeTransactionLeaf(item);
    item.leafHash = leaf;
    return leaf;
  });
  const tree = buildMerkleTree(leafHashes);
  rawBatch.forEach((item, idx) => { item.merkleProof = tree.proofs[idx]; });

  // 3. Anchored Merkle Root generation
  const onChainRoot = await computeMerkleRoot(leafHashes);
  assert.equal(onChainRoot, tree.root);
  assert.equal(onChainRoot.length, 66);

  // 4. Generate Audit Certificate for external regulator
  const period = '2026-Q3';
  const orgAddress = '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec';
  const network = 'Circle Arc L1';
  const certificate = VeyroqExporter.buildAuditCertificate(rawBatch, onChainRoot, orgAddress, period, network, {
    disclosureScope: 'full',
    commitment: { proofId: 0, txHash: '0x' + 'ab'.repeat(32) }
  });

  // Assert zero-custody, completeness, and certificate self-verification
  assert.equal(certificate.certificate.zeroCustodyGuarantee, true);
  assert.equal(certificate.verification.merkleRootHash, onChainRoot);
  assert.equal(certificate.verification.reconciliationStatus, 'COMPLETE_MATCH');
  assert.equal(certificate.verification.totalTransactions, 6);
  assert.equal(certificate.verification.grossVolumeUSDC, 148250);
  const verifyResult = verifyCertificatePayload(certificate, { onChainRoot });
  assert.equal(verifyResult.valid, true);

  // Mutating $1 breaks verification immediately
  const altered = structuredClone(certificate);
  altered.leafCommitments[0].amountUSDC += 1;
  assert.equal(verifyCertificatePayload(altered, { onChainRoot }).valid, false);

  // 5. Selective Disclosure: Generate Redacted counterparty export
  const redactedTxs = prepareExportTransactions(rawBatch, 'redacted');
  const qbCSV = VeyroqExporter.generateQuickBooksCSV(redactedTxs, orgAddress, period);

  // Verify that redacted export contains zero plaintext employee or contractor names
  assert.equal(qbCSV.includes('Dr. Elena Rostova'), false);
  assert.equal(qbCSV.includes('Lambda Compute Corp'), false);
  assert.equal(qbCSV.includes('OpenZeppelin'), false);
  // Verify that financial amounts and Merkle leaves are preserved for tax accounting
  assert.equal(qbCSV.includes('35000.00'), true);
  assert.equal(qbCSV.includes('48500.00'), true);
  assert.equal(qbCSV.includes(leafHashes[0]), true);
});

