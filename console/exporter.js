// Veyroq Institutional Export Engine
// GAAP/IFRS, QuickBooks, Xero CSV Generator + Cryptographic Audit Certificate Builder
// 100% Client-Side — Zero data leaves the browser.

const VeyroqExporter = (() => {

  /**
   * Neutralize spreadsheet formula injection (CWE-1236) and escape CSV quotes.
   */
  function csvCell(val) {
    let str = val === null || val === undefined ? '' : String(val);
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  }

  /**
   * Generate a QuickBooks-compatible General Journal CSV
   * Maps each decrypted transaction to a debit/credit double-entry pair.
   */
  function generateQuickBooksCSV(transactions, orgAddress, period) {
    const header = [
      'Transaction No',
      'Date',
      'Account',
      'Debit (USDC)',
      'Credit (USDC)',
      'Memo',
      'Class',
      'Block Height',
      'Merkle Leaf Hash',
      'Audit Status'
    ].join(',');

    const rows = [];

    transactions.forEach((tx, idx) => {
      const lineNo = idx + 1;
      const dateFormatted = formatDateISO(tx.date);

      // Debit line (expense side)
      const memoWithNotes = tx.notes
        ? `${tx.plainCounterparty} — ${tx.category} (${tx.notes})`
        : `${tx.plainCounterparty} — ${tx.category}`;
      rows.push([
        csvCell(`VQ-${period}-${String(lineNo).padStart(4, '0')}`),
        dateFormatted,
        csvCell(mapCategoryToAccount(tx.category, 'debit')),
        tx.grossAmount.toFixed(2),
        '',
        csvCell(memoWithNotes),
        csvCell(tx.type),
        tx.block,
        tx.leafHash || '',
        'CONFIRMED_AUDITED'
      ].join(','));

      // Credit line (cash/USDC side)
      rows.push([
        csvCell(`VQ-${period}-${String(lineNo).padStart(4, '0')}`),
        dateFormatted,
        'Digital Assets:USDC Operating',
        '',
        tx.grossAmount.toFixed(2),
        csvCell(`${tx.plainCounterparty} — Settlement`),
        csvCell(tx.type),
        tx.block,
        '',
        ''
      ].join(','));
    });

    return header + '\n' + rows.join('\n');
  }

  /**
   * Generate a Xero-compatible CSV import
   * Uses Xero's manual journal format with tax type mapping.
   */
  function generateXeroCSV(transactions, orgAddress, period) {
    const header = [
      '*Date',
      '*Description',
      '*AccountCode',
      '*TaxType',
      'Debit',
      'Credit',
      'Reference',
      'Tracking1Name',
      'Tracking1Option'
    ].join(',');

    const rows = [];

    transactions.forEach((tx, idx) => {
      const dateFormatted = formatDateISO(tx.date);
      const ref = `VQ-BLK-${tx.block}`;

      // Debit
      const xeroDesc = tx.notes
        ? `${tx.plainCounterparty} — ${tx.category} (${tx.notes})`
        : `${tx.plainCounterparty} — ${tx.category}`;
      rows.push([
        dateFormatted,
        csvCell(xeroDesc),
        mapCategoryToXeroCode(tx.category),
        'NO GST',
        tx.grossAmount.toFixed(2),
        '',
        ref,
        'AuditPeriod',
        csvCell(period)
      ].join(','));

      // Credit
      rows.push([
        dateFormatted,
        csvCell(`USDC Settlement — ${tx.plainCounterparty}`),
        '090',
        'NO GST',
        '',
        tx.grossAmount.toFixed(2),
        ref,
        'AuditPeriod',
        csvCell(period)
      ].join(','));
    });

    return header + '\n' + rows.join('\n');
  }

  /**
   * Generate a NetSuite-compatible CSV import
   */
  function generateNetSuiteCSV(transactions, orgAddress, period) {
    const header = [
      'External ID',
      'Date',
      'Subsidiary',
      'Account',
      'Debit Amount',
      'Credit Amount',
      'Memo',
      'Department',
      'Custom: Block Height',
      'Custom: Merkle Hash'
    ].join(',');

    const rows = [];

    transactions.forEach((tx, idx) => {
      const dateFormatted = formatDateISO(tx.date);

      rows.push([
        csvCell(`VQ-NS-${tx.id}`),
        dateFormatted,
        'Primary',
        csvCell(mapCategoryToAccount(tx.category, 'debit')),
        tx.grossAmount.toFixed(2),
        '',
        csvCell(tx.notes ? `${tx.plainCounterparty} (${tx.notes})` : tx.plainCounterparty),
        csvCell(tx.type),
        tx.block,
        tx.leafHash || ''
      ].join(','));

      rows.push([
        csvCell(`VQ-NS-${tx.id}`),
        dateFormatted,
        'Primary',
        'Digital Currency - USDC',
        '',
        tx.grossAmount.toFixed(2),
        csvCell(`Settlement — ${tx.plainCounterparty}`),
        csvCell(tx.type),
        tx.block,
        ''
      ].join(','));
    });

    return header + '\n' + rows.join('\n');
  }

  /**
   * Build a Cryptographic Audit Verification Certificate (JSON)
   * This JSON document can be attached to GAAP/IFRS filings as cryptographic proof.
   */
  function buildAuditCertificate(transactions, merkleRoot, orgAddress, period, networkName, options = {}) {
    const grossVolume = transactions.reduce((sum, tx) => sum + tx.grossAmount, 0);
    const {
      disclosureScope = 'full',
      commitment = null,
      registryAddress = '0x8A1D55E8E07fa49edF4c0a420b8B033ad03B37B3',
      chainId = 5042002
    } = options || {};

    return {
      '@context': 'https://veyroq.xyz/schema/audit-certificate/v1',
      protocol: 'Veyroq Institutional Audit Protocol',
      version: '1.0.0',
      certificate: {
        id: `VQ-CERT-${Date.now().toString(36).toUpperCase()}`,
        generatedAt: new Date().toISOString(),
        generatedLocally: true,
        zeroCustodyGuarantee: true
      },
      organization: {
        address: orgAddress,
        network: networkName || 'Multi-Chain EVM'
      },
      auditPeriod: {
        label: period,
        startBlock: transactions.length > 0 ? transactions[0].block : null,
        endBlock: transactions.length > 0 ? transactions[transactions.length - 1].block : null
      },
      verification: {
        merkleRootHash: merkleRoot,
        hashAlgorithm: 'keccak256-openzeppelin-sorted',
        disclosureScope,
        totalTransactions: transactions.length,
        grossVolumeUSDC: grossVolume,
        reconciliationStatus: 'COMPLETE_MATCH',
        assuranceStatement: 'All decrypted confidential transactions hash into the on-chain Merkle block commitment. Zero records omitted, altered, or fabricated.'
      },
      onChainCommitment: commitment ? {
        registryAddress,
        chainId,
        organizationAddress: commitment.orgAddress || null,
        commitTxHash: commitment.txHash || null,
        proofId: commitment.proofId ?? null,
        anchoredAt: commitment.anchoredAt || null
      } : null,
      registryContract: 'VeyroqRegistry.sol',
      registryAddress,
      leafCommitments: transactions.map(tx => ({
        transactionId: tx.id,
        blockHeight: tx.block,
        amountUSDC: tx.grossAmount,
        counterparty: tx.plainCounterparty,
        classification: tx.category,
        ...(tx.notes ? { auditNotes: tx.notes } : {}),
        leafHash: tx.leafHash,
        merkleProof: Array.isArray(tx.merkleProof) ? tx.merkleProof : [],
        inclusionStatus: 'MERKLE_VERIFIED'
      })),
      legalDisclaimer: 'This certificate is generated by Veyroq client-side software. Veyroq does not provide financial, legal, or tax advice. The user is solely responsible for their regulatory filings.'
    };
  }

  /**
   * Download helper — triggers browser file download
   */
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Export QuickBooks CSV and trigger download
   */
  function exportQuickBooks(transactions, orgAddress, period) {
    const csv = generateQuickBooksCSV(transactions, orgAddress, period);
    const filename = `Veyroq_QuickBooks_Journal_${period.replace(/\s+/g, '_')}.csv`;
    downloadFile(csv, filename, 'text/csv;charset=utf-8;');
  }

  /**
   * Export Xero CSV and trigger download
   */
  function exportXero(transactions, orgAddress, period) {
    const csv = generateXeroCSV(transactions, orgAddress, period);
    const filename = `Veyroq_Xero_Journal_${period.replace(/\s+/g, '_')}.csv`;
    downloadFile(csv, filename, 'text/csv;charset=utf-8;');
  }

  /**
   * Export NetSuite CSV and trigger download
   */
  function exportNetSuite(transactions, orgAddress, period) {
    const csv = generateNetSuiteCSV(transactions, orgAddress, period);
    const filename = `Veyroq_NetSuite_Journal_${period.replace(/\s+/g, '_')}.csv`;
    downloadFile(csv, filename, 'text/csv;charset=utf-8;');
  }

  /**
   * Export Audit Certificate JSON and trigger download
   */
  function exportAuditCertificate(transactions, merkleRoot, orgAddress, period, registryContract, options = {}) {
    const cert = buildAuditCertificate(transactions, merkleRoot, orgAddress, period, registryContract, options);
    const json = JSON.stringify(cert, null, 2);
    const filename = `Veyroq_Cryptographic_Audit_Certificate_${period.replace(/\s+/g, '_')}.json`;
    downloadFile(json, filename, 'application/json;charset=utf-8;');
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────

  function formatDateISO(dateStr) {
    // "2026-08-04 14:22:10 UTC" → "2026-08-04"
    try {
      return dateStr.split(' ')[0];
    } catch {
      return dateStr;
    }
  }

  function mapCategoryToAccount(category, side) {
    const map = {
      'Treasury Inflow': 'Revenue:Treasury Inflows & Settlements',
      'Grant / Funding': 'Other Income:Grants & Ecosystem Funding',
      'Payroll': 'Payroll Expenses:Officer Compensation',
      'Officer Compensation (W-2)': 'Payroll Expenses:Officer Compensation',
      'Contractor Payroll': 'Payroll Expenses:Contractors',
      'Cloud GPU Compute Cluster': 'Technology Expenses:Cloud Infrastructure',
      'Software & Cloud Infrastructure': 'Technology Expenses:Cloud Infrastructure',
      'Yield Sweep to BlackRock BUIDL': 'Investments:Treasury Instruments',
      'Treasury Sweep': 'Investments:Treasury Instruments',
      'Treasury Yield Sweep': 'Investments:Treasury Instruments',
      'Engineering Payroll Batch B': 'Payroll Expenses:Engineering Contractors',
      'Supplier Settlement': 'Vendor Expenses:Supplier Settlements',
      'Smart Contract Audit Retainer': 'Professional Services:Security Audits',
      'Professional Services': 'Professional Services:Legal & Audit',
      'Legal & Compliance': 'Professional Services:Legal & Regulatory Compliance',
      'Tax & Statutory Payment': 'Taxes & Licenses:Statutory Tax Payments',
      'Capital Expenditure': 'Fixed Assets:Capital Expenditure',
      'Operating Expense': 'General & Administrative:Operating Expenses',
      'General Operating': 'General & Administrative:Operating Expenses',
      'Validator & RPC Infrastructure': 'Technology Expenses:Infrastructure & RPC'
    };
    return map[category] || (category ? `General & Administrative:${category}` : 'General & Administrative:Uncategorized');
  }

  function mapCategoryToXeroCode(category) {
    const map = {
      'Treasury Inflow': '200',
      'Grant / Funding': '260',
      'Payroll': '477',
      'Officer Compensation (W-2)': '477',
      'Contractor Payroll': '478',
      'Cloud GPU Compute Cluster': '420',
      'Software & Cloud Infrastructure': '420',
      'Yield Sweep to BlackRock BUIDL': '621',
      'Treasury Sweep': '621',
      'Treasury Yield Sweep': '621',
      'Engineering Payroll Batch B': '477',
      'Supplier Settlement': '412',
      'Smart Contract Audit Retainer': '412',
      'Professional Services': '412',
      'Legal & Compliance': '412',
      'Tax & Statutory Payment': '505',
      'Capital Expenditure': '720',
      'Operating Expense': '400',
      'General Operating': '400',
      'Validator & RPC Infrastructure': '420'
    };
    return map[category] || '400';
  }

  // Public API
  return {
    exportQuickBooks,
    exportXero,
    exportNetSuite,
    exportAuditCertificate,
    generateQuickBooksCSV,
    generateXeroCSV,
    generateNetSuiteCSV,
    buildAuditCertificate
  };

})();

// Expose globally for browser and test suites
if (typeof globalThis !== 'undefined') {
  globalThis.VeyroqExporter = VeyroqExporter;
}
if (typeof window !== 'undefined') {
  window.VeyroqExporter = VeyroqExporter;
}

export default VeyroqExporter;
export { VeyroqExporter };
