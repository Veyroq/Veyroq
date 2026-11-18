import test from 'node:test';
import assert from 'node:assert/strict';
import { VeyroqExporter } from '../../console/exporter.js';

const mockTransactions = [
  {
    id: 'tx-01',
    date: '2026-08-04 14:22:10 UTC',
    block: 418042,
    type: 'CONFIDENTIAL_PAYROLL',
    category: 'Officer Compensation (W-2)',
    plainCounterparty: 'Dr. Elena Rostova',
    grossAmount: 35000.00,
    asset: 'USDC',
    leafHash: '0x97f4f49fabcde123'
  },
  {
    id: 'tx-02',
    date: '2026-08-11 09:15:33 UTC',
    block: 418491,
    type: 'SUPPLIER_SETTLEMENT',
    category: 'Cloud GPU Compute Cluster',
    plainCounterparty: 'Lambda Compute Corp',
    grossAmount: 48500.00,
    asset: 'USDC',
    leafHash: '0x82e19110abcde456'
  }
];

test('Unit: generateQuickBooksCSV produces balanced debit/credit rows', () => {
  const csv = VeyroqExporter.generateQuickBooksCSV(mockTransactions, '0x71C8...', '2026-Q3');
  const lines = csv.trim().split('\n');

  assert.equal(lines[0].startsWith('Transaction No,Date,Account,Debit (USDC),Credit (USDC)'), true);
  // Header + (2 rows per transaction * 2 transactions) = 5 lines
  assert.equal(lines.length, 5);

  // Check debit line
  assert.equal(lines[1].includes('Payroll Expenses:Officer Compensation'), true);
  assert.equal(lines[1].includes('35000.00'), true);

  // Check credit line
  assert.equal(lines[2].includes('Digital Assets:USDC Operating'), true);
  assert.equal(lines[2].includes('35000.00'), true);
});

test('Unit: generateXeroCSV outputs compliant manual journal entries', () => {
  const csv = VeyroqExporter.generateXeroCSV(mockTransactions, '0x71C8...', '2026-Q3');
  const lines = csv.trim().split('\n');

  assert.equal(lines[0].startsWith('*Date,*Description,*AccountCode,*TaxType,Debit,Credit'), true);
  assert.equal(lines.length, 5);
  assert.equal(lines[1].includes('NO GST'), true);
  assert.equal(lines[1].includes('477'), true); // mapped payroll code
});

test('Unit: generateNetSuiteCSV generates valid subsidiary rows', () => {
  const csv = VeyroqExporter.generateNetSuiteCSV(mockTransactions, '0x71C8...', '2026-Q3');
  const lines = csv.trim().split('\n');

  assert.equal(lines[0].startsWith('External ID,Date,Subsidiary,Account'), true);
  assert.equal(lines.length, 5);
  assert.equal(lines[1].includes('VQ-NS-tx-01'), true);
});

test('Unit: buildAuditCertificate returns compliant cryptographic payload', () => {
  const cert = VeyroqExporter.buildAuditCertificate(
    mockTransactions,
    '0xdd5bbd937c60b17c9fab8384b38b1ccfc3db2ba89719b9c14f43e8e3f03860b2',
    '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec',
    '2026-Q3',
    'Circle Arc L1'
  );

  assert.equal(cert.protocol, 'Veyroq Institutional Audit Protocol');
  assert.equal(cert.version, '1.0.0');
  assert.equal(cert.certificate.zeroCustodyGuarantee, true);
  assert.equal(cert.organization.address, '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec');
  assert.equal(cert.organization.network, 'Circle Arc L1');
  assert.equal(cert.verification.totalTransactions, 2);
  assert.equal(cert.verification.grossVolumeUSDC, 83500);
  assert.equal(cert.verification.reconciliationStatus, 'COMPLETE_MATCH');
  assert.equal(cert.leafCommitments.length, 2);
  assert.equal(cert.leafCommitments[0].inclusionStatus, 'MERKLE_VERIFIED');
});

test('Unit: CSV exporters neutralize formula injection (CWE-1236) and escape quotes', () => {
  const maliciousTxs = [{
    id: 'tx-evil',
    date: '2026-08-04 14:22:10 UTC',
    block: 100,
    type: 'OUTGOING',
    category: 'General',
    plainCounterparty: '=cmd|"/C calc"!A0',
    grossAmount: 10,
    leafHash: '0xabc'
  }];
  const qb = VeyroqExporter.generateQuickBooksCSV(maliciousTxs, '0x71C8...', '=1+1');
  const xero = VeyroqExporter.generateXeroCSV(maliciousTxs, '0x71C8...', '+SUM(1,2)');
  assert.equal(qb.includes('"\'=cmd|""/C calc""!A0'), true);
  assert.equal(qb.includes('"\'=1+1"'), false);
  assert.equal(xero.includes('"\'=cmd|""/C calc""!A0'), true);
  assert.equal(xero.includes('"\'+SUM(1,2)"'), true);
});

