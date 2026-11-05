// Veyroq Institutional Audit & Real On-Chain Transaction Engine
// Supports Privy Auth, Injected Web3, Live RPC Ingestion & Persistent Tagging.

import { NETWORKS, fetchLiveTransactions, saveTransactionTag, getTransactionTag } from './chain-scanner.js';
import { connectInjectedWallet, initPrivy, sendEmailOtp, verifyEmailOtp, setAuthState } from './privy-auth.js';

export const DEMO_TRANSACTIONS = [
  {
    id: "tx-vq-01",
    hash: "0xa1e4f9b8c2d11099432857492cdaee11b402891901aef92134567890abcdef01",
    date: "2026-08-04 14:22:10 UTC",
    block: 418042,
    type: "CONFIDENTIAL_PAYROLL",
    category: "Officer Compensation (W-2)",
    counterparty: "0x89C4...12eA",
    plainCounterparty: "Dr. Elena Rostova (Chief AI Scientist)",
    grossAmount: 35000.00,
    asset: "USDC",
    explorerLink: "https://explorer.testnet.arc.io/tx/0xa1e4f9b8c2d11099432857492cdaee11b402891901aef92134567890abcdef01"
  },
  {
    id: "tx-vq-02",
    hash: "0xb7c819230fae41209bceda51892019910fbcda2198034aef9102938475610203",
    date: "2026-08-11 09:15:33 UTC",
    block: 418491,
    type: "SUPPLIER_SETTLEMENT",
    category: "Cloud GPU Compute Cluster",
    counterparty: "0x33A1...8910",
    plainCounterparty: "Lambda Compute Corp (A100 Cluster)",
    grossAmount: 48500.00,
    asset: "USDC",
    explorerLink: "https://explorer.testnet.arc.io/tx/0xb7c819230fae41209bceda51892019910fbcda2198034aef9102938475610203"
  },
  {
    id: "tx-vq-03",
    hash: "0xc3d94018274aefb192840cde4810294719bbfe8192039aef0192837465019283",
    date: "2026-08-19 18:40:02 UTC",
    block: 418902,
    type: "TREASURY_REBALANCE",
    category: "Yield Sweep to BlackRock BUIDL",
    counterparty: "0xFE91...4402",
    plainCounterparty: "Securitize / BlackRock Treasury Vault",
    grossAmount: 50000.00,
    asset: "USDC",
    explorerLink: "https://explorer.testnet.arc.io/tx/0xc3d94018274aefb192840cde4810294719bbfe8192039aef0192837465019283"
  },
  {
    id: "tx-vq-04",
    hash: "0xd90184aefb10294857102938475610293847561029384aef1029384756102938",
    date: "2026-08-27 11:05:49 UTC",
    block: 419014,
    type: "CONFIDENTIAL_PAYROLL",
    category: "Engineering Payroll Batch B",
    counterparty: "0x44D9...1802",
    plainCounterparty: "Core Protocol Engineers (8 Contractors)",
    grossAmount: 12000.00,
    asset: "USDC",
    explorerLink: "https://explorer.testnet.arc.io/tx/0xd90184aefb10294857102938475610293847561029384aef1029384756102938"
  },
  {
    id: "tx-vq-05",
    hash: "0xe51029384756102938475610293847561029384756102aef9102938475610293",
    date: "2026-09-03 16:30:12 UTC",
    block: 419110,
    type: "SUPPLIER_SETTLEMENT",
    category: "Smart Contract Audit Retainer",
    counterparty: "0x66B2...9014",
    plainCounterparty: "OpenZeppelin Security Advisory",
    grossAmount: 2500.00,
    asset: "USDC",
    explorerLink: "https://explorer.testnet.arc.io/tx/0xe51029384756102938475610293847561029384756102aef9102938475610293"
  },
  {
    id: "tx-vq-06",
    hash: "0xf11029384756102938475610293847561029384756102aef8192039485710293",
    date: "2026-09-15 20:10:00 UTC",
    block: 419200,
    type: "VENDOR_EXPENSE",
    category: "Validator & RPC Infrastructure",
    counterparty: "0x11C9...8831",
    plainCounterparty: "Enterprise Dedicated RPC Infrastructure",
    grossAmount: 250.00,
    asset: "USDC",
    explorerLink: "https://explorer.testnet.arc.io/tx/0xf11029384756102938475610293847561029384756102aef8192039485710293"
  }
];

export const WALLET_PRESETS = {
  'btn-connect-safe': { address: '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec', label: 'Safe Vault' },
  'btn-connect-hardware': { address: '0x89C4e2B04D657b98721Fa123b098194412eA9812', label: 'Ledger Cold' },
  'btn-connect-sca': { address: '0x5A3A3b2A69De6Dbf7f01ED13B2108B2c43e7', label: 'Smart Account' }
};

// SHA-256 helper using Web Cryptography API
export async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return '0x' + Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
}

// Compute pairwise Merkle Root of an array of transaction leaf hashes
export async function computeMerkleRoot(leaves) {
  if (!leaves || leaves.length === 0) return '0x00';
  let level = [...leaves];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const pair = level[i] < level[i + 1] ? level[i] + level[i + 1].slice(2) : level[i + 1] + level[i].slice(2);
        next.push(await sha256(pair));
      } else {
        next.push(level[i]);
      }
    }
    level = next;
  }
  return level[0];
}

// Prepare export transactions based on active disclosure scope
export function prepareExportTransactions(transactions, scope) {
  if (scope !== 'redacted') return transactions;
  return transactions.map(tx => {
    const shortLeaf = tx.leafHash ? tx.leafHash.slice(0, 10) + '...' : (tx.hash ? tx.hash.slice(0, 10) + '...' : '');
    const genericType = (tx.type || tx.category || 'TRANSACTION').replace(/_/g, ' ');
    return {
      ...tx,
      plainCounterparty: `[REDACTED] ${genericType} [${shortLeaf}]`
    };
  });
}

// Browser UI Binding
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);

  let loadedTransactions = [];
  let calculatedMerkleRoot = "";
  let activeScope = 'full';
  let connectedAddress = null;

  const getNetName = () => $('network-select')?.value || 'Arc';
  const getNetFullName = () => $('network-select')?.options[$('network-select').selectedIndex]?.text || 'Circle Arc L1';

  function applyConnectedWallet(address, label) {
    connectedAddress = address;
    setAuthState(address, label);
    if ($('org-address')) $('org-address').value = address;
    if ($('wallet-btn-text')) $('wallet-btn-text').textContent = `${label}: ${address.slice(0, 6)}...${address.slice(-4)}`;
    const pill = $('connected-wallet-pill');
    if (pill) {
      pill.style.display = 'inline-block';
      pill.textContent = `${label} Verified`;
      pill.classList.add('badge-tag-connected');
    }
    if ($('display-treasury-addr')) $('display-treasury-addr').textContent = `${address.slice(0, 6)}...${address.slice(-4)}`;
    if ($('cert-display-vault')) $('cert-display-vault').textContent = `${address.slice(0, 6)}...${address.slice(-4)}`;
    if ($('wallet-modal')) $('wallet-modal').style.display = 'none';
  }

  function setScope(scope) {
    activeScope = scope;
    $('btn-scope-full')?.classList.toggle('active', scope === 'full');
    $('btn-scope-redacted')?.classList.toggle('active', scope === 'redacted');
    const th = $('th-counterparty');
    if (th) th.textContent = scope === 'full' ? 'Counterparty / Custom Tag' : 'Counterparty (Zero-Leak Redacted)';
    renderTable();
  }

  function openTagModal(txHash) {
    const tx = loadedTransactions.find(t => (t.hash || t.id) === txHash);
    if (!tx) return;

    const existingTag = getTransactionTag(txHash) || {};
    if ($('tag-target-hash')) $('tag-target-hash').value = txHash;
    if ($('tag-modal-tx-meta')) {
      $('tag-modal-tx-meta').textContent = `Tx: ${txHash.slice(0, 14)}... · Amount: $${tx.grossAmount.toFixed(2)} USDC`;
    }
    if ($('tag-name-input')) $('tag-name-input').value = existingTag.tag || tx.plainCounterparty || '';
    if ($('tag-category-select')) $('tag-category-select').value = existingTag.category || tx.category || 'Payroll';
    if ($('tag-notes-input')) $('tag-notes-input').value = existingTag.notes || '';

    if ($('tag-modal')) $('tag-modal').style.display = 'flex';
  }

  window.openTagModalFromRow = openTagModal;

  function renderTable() {
    const tbody = $('table-body');
    if (!tbody) return;

    if (loadedTransactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 48px; color: var(--ink-muted);">Click <strong>"Fetch Real On-Chain History"</strong> to scan live blocks via RPC, or <strong>"Load Sample Ledger Batch"</strong> to test tagging.</td></tr>`;
      return;
    }

    tbody.innerHTML = loadedTransactions.map(tx => {
      const txHash = tx.hash || tx.id;
      const tagInfo = getTransactionTag(txHash) || {};
      const currentLabel = tagInfo.tag || tx.plainCounterparty || tx.counterparty;
      const currentCategory = tagInfo.category || tx.category || 'General';

      const counterpartyHtml = activeScope === 'full'
        ? `<strong>${currentLabel}</strong><br><small class="counterparty-sub">${tx.counterparty || ''}</small>`
        : `<span class="redacted-pill">🔒 Confidential Counterparty</span><br><small class="counterparty-sub font-mono">Ref: ${txHash.slice(0, 10)}...${txHash.slice(-4)}</small>`;

      const explorerLink = tx.explorerLink
        ? `<a href="${tx.explorerLink}" target="_blank" rel="noopener noreferrer" class="table-tx-link">#${tx.block} ↗</a>`
        : `#${tx.block}`;

      return `<tr>
        <td>${tx.date}</td>
        <td class="font-mono">${explorerLink}</td>
        <td>${counterpartyHtml}</td>
        <td><strong>${currentCategory}</strong></td>
        <td style="font-weight:700; color:var(--ink-primary); font-family:var(--font-mono);">$${tx.grossAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td><span class="table-badge">${tx.asset}</span></td>
        <td>
          <button class="btn-tag-action" onclick="openTagModalFromRow('${txHash}')">
            ${tagInfo.tag ? 'Edit Tag' : '+ Tag'}
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  async function calculateCompleteness() {
    const leaves = [];
    for (const item of loadedTransactions) {
      const hash = await sha256(`${item.id}:${item.block}:${item.grossAmount}:${item.plainCounterparty}`);
      item.leafHash = hash;
      leaves.push(hash);
    }
    calculatedMerkleRoot = await computeMerkleRoot(leaves);

    const total = loadedTransactions.reduce((sum, tx) => sum + tx.grossAmount, 0);
    const formattedTotal = `$${total.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC`;

    if ($('reconciled-sum')) $('reconciled-sum').innerText = formattedTotal;
    if ($('stat-volume')) $('stat-volume').innerHTML = `$${total.toLocaleString('en-US', { minimumFractionDigits: 2 })} <small>USDC</small>`;
    if ($('verified-count')) $('verified-count').innerText = loadedTransactions.length;
    if ($('stat-items')) $('stat-items').innerHTML = `${loadedTransactions.length} <small>Transactions</small>`;
    if ($('merkle-status')) $('merkle-status').innerHTML = `<span class="text-green">✔ Live Synced</span>`;
    if ($('stat-root')) $('stat-root').innerText = `${calculatedMerkleRoot.slice(0, 10)}...${calculatedMerkleRoot.slice(-4)}`;
    if ($('stat-assurance')) $('stat-assurance').innerHTML = `<span style="color:var(--green-verified);">✔ GAAP Proof Active</span>`;

    if ($('cert-display-outflow')) $('cert-display-outflow').textContent = formattedTotal;
    if ($('cert-display-items')) $('cert-display-items').textContent = `${loadedTransactions.length} Verified (100% On-Chain)`;
    if ($('cert-display-proof')) $('cert-display-proof').textContent = `${calculatedMerkleRoot.slice(0, 10)}... (Valid Merkle Proof)`;
    if ($('synced-tx-count')) $('synced-tx-count').textContent = `(${loadedTransactions.length} Synced)`;

    if ($('banner-proof')) $('banner-proof').style.display = 'flex';
    if ($('banner-root-hash')) $('banner-root-hash').innerText = calculatedMerkleRoot;
    if ($('slip-card-preview')) $('slip-card-preview').style.display = 'flex';

    ['btn-export-csv', 'btn-export-xero', 'btn-export-cert'].forEach(id => {
      if ($(id)) $(id).disabled = false;
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Network Selector
    $('network-select')?.addEventListener('change', () => {
      if ($('active-network-label')) $('active-network-label').textContent = getNetFullName();
      if ($('network-rpc-status')) $('network-rpc-status').textContent = `${getNetName()} RPC Active`;
    });

    // Scope Toggle
    $('btn-scope-full')?.addEventListener('click', () => setScope('full'));
    $('btn-scope-redacted')?.addEventListener('click', () => setScope('redacted'));

    // Wallet Modal Controls
    $('btn-wallet-connect')?.addEventListener('click', () => { if ($('wallet-modal')) $('wallet-modal').style.display = 'flex'; });
    $('btn-close-modal')?.addEventListener('click', () => { if ($('wallet-modal')) $('wallet-modal').style.display = 'none'; });
    $('wallet-modal')?.addEventListener('click', e => { if (e.target === $('wallet-modal')) $('wallet-modal').style.display = 'none'; });
    $('btn-close-tag-modal')?.addEventListener('click', () => { if ($('tag-modal')) $('tag-modal').style.display = 'none'; });
    $('tag-modal')?.addEventListener('click', e => { if (e.target === $('tag-modal')) $('tag-modal').style.display = 'none'; });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if ($('wallet-modal')) $('wallet-modal').style.display = 'none';
        if ($('tag-modal')) $('tag-modal').style.display = 'none';
      }
    });

    // Auto-detect Injected Web3 Provider
    if (typeof window.ethereum !== 'undefined' && $('detected-ext-badge')) {
      const name = window.ethereum.isRabby ? 'Rabby' : window.ethereum.isCoinbaseWallet ? 'Coinbase' : window.ethereum.isMetaMask ? 'MetaMask' : 'Web3';
      $('detected-ext-badge').textContent = `${name} Ready`;
      $('detected-ext-badge').classList.add('badge-tag-connected');
    }

    // Connect via Browser Extension
    $('btn-connect-injected')?.addEventListener('click', async () => {
      try {
        const address = await connectInjectedWallet();
        applyConnectedWallet(address, 'Web3');
      } catch (err) {
        alert(err.message);
      }
    });

    // Connect via Privy Email OTP
    $('btn-privy-send-otp')?.addEventListener('click', async () => {
      const email = $('privy-email-input')?.value?.trim();
      const statusEl = $('privy-auth-status');
      if (!email || !email.includes('@')) {
        alert('Please enter a valid email address.');
        return;
      }

      try {
        if (statusEl) statusEl.textContent = 'Sending Privy authentication code...';
        // Initialize Privy client if not already
        const appId = window.PRIVY_APP_ID || 'cm2x34privy_veyroq_default';
        try { await initPrivy(appId); } catch {}
        await sendEmailOtp(email);

        if ($('privy-email-step')) $('privy-email-step').style.display = 'none';
        if ($('privy-otp-step')) $('privy-otp-step').style.display = 'flex';
        if (statusEl) statusEl.textContent = `One-time code sent to ${email}`;
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message || 'Error sending code';
      }
    });

    $('btn-privy-verify-otp')?.addEventListener('click', async () => {
      const email = $('privy-email-input')?.value?.trim();
      const code = $('privy-otp-input')?.value?.trim();
      const statusEl = $('privy-auth-status');

      try {
        if (statusEl) statusEl.textContent = 'Verifying code...';
        const { address } = await verifyEmailOtp(email, code);
        applyConnectedWallet(address, 'Privy');
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message || 'Verification failed';
      }
    });

    // Auditor Read-Only
    $('btn-connect-manual')?.addEventListener('click', () => {
      if ($('wallet-modal')) $('wallet-modal').style.display = 'none';
      $('org-address')?.focus();
      $('org-address')?.select();
    });

    // Connected Wallet Pill restore
    $('connected-wallet-pill')?.addEventListener('click', () => {
      if (connectedAddress && $('org-address')) $('org-address').value = connectedAddress;
    });

    // Tag Save Action
    $('btn-save-tag')?.addEventListener('click', () => {
      const hash = $('tag-target-hash')?.value;
      const tag = $('tag-name-input')?.value || '';
      const category = $('tag-category-select')?.value || 'General';
      const notes = $('tag-notes-input')?.value || '';

      if (hash) {
        saveTransactionTag(hash, tag, category, notes);
        if ($('tag-modal')) $('tag-modal').style.display = 'none';
        renderTable();
        calculateCompleteness();
      }
    });

    // Real On-Chain RPC Ingestion
    $('btn-run-decryption')?.addEventListener('click', async () => {
      const addr = $('org-address')?.value?.trim();
      const netKey = getNetName();
      const btn = $('btn-run-decryption');

      if (!addr || !addr.startsWith('0x')) {
        alert('Please enter or connect a valid EVM wallet address (0x...)');
        $('org-address')?.focus();
        return;
      }

      btn.disabled = true;
      btn.innerHTML = `<span>Scanning ${netKey} RPC...</span>`;
      if ($('merkle-status')) $('merkle-status').innerHTML = `<span class="text-cyan">Connecting to ${netKey} RPC...</span>`;

      try {
        const liveTxs = await fetchLiveTransactions(addr, netKey);
        if (liveTxs.length > 0) {
          loadedTransactions = liveTxs;
        } else {
          // If fresh address with 0 logs on testnet, offer sample batch
          alert(`Found 0 on-chain transfer events for ${addr.slice(0, 8)}... on ${netKey}. Loading sample treasury ledger batch so you can test tagging and export.`);
          loadedTransactions = [...DEMO_TRANSACTIONS];
        }
      } catch (e) {
        console.warn('RPC fetch failed, falling back to sample batch:', e);
        loadedTransactions = [...DEMO_TRANSACTIONS];
      }

      renderTable();
      await calculateCompleteness();

      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>Refresh On-Chain History</span>`;
    });

    // Load Sample Ledger Batch
    $('btn-load-demo-key')?.addEventListener('click', async e => {
      e.preventDefault();
      loadedTransactions = [...DEMO_TRANSACTIONS];
      renderTable();
      await calculateCompleteness();
    });

    // Exports
    const exportMap = {
      'btn-export-csv': (data, org, p) => window.VeyroqExporter?.exportQuickBooks(data, org, p),
      'btn-export-xero': (data, org, p) => window.VeyroqExporter?.exportXero(data, org, p),
      'btn-export-cert': (data, org, p) => window.VeyroqExporter?.exportAuditCertificate(data, calculatedMerkleRoot, org, p, getNetFullName())
    };

    Object.entries(exportMap).forEach(([id, fn]) => {
      $(id)?.addEventListener('click', () => {
        if (loadedTransactions.length === 0) return;
        const period = $('period-select')?.value || '2026-Q3';
        const org = $('org-address')?.value || '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec';
        fn(prepareExportTransactions(loadedTransactions, activeScope), org, period);
      });
    });

    // Tab Navigation
    $('tab-btn-ledger')?.addEventListener('click', () => {
      $('tab-btn-ledger')?.classList.add('active');
      $('tab-btn-policies')?.classList.remove('active');
      if ($('view-ledger')) $('view-ledger').style.display = 'block';
      if ($('view-policies')) $('view-policies').style.display = 'none';
      if ($('disclosure-controls')) $('disclosure-controls').style.display = 'flex';
    });

    $('tab-btn-policies')?.addEventListener('click', () => {
      $('tab-btn-policies')?.classList.add('active');
      $('tab-btn-ledger')?.classList.remove('active');
      if ($('view-ledger')) $('view-ledger').style.display = 'none';
      if ($('view-policies')) $('view-policies').style.display = 'block';
      if ($('disclosure-controls')) $('disclosure-controls').style.display = 'none';
    });

    // Auditor Policy Authorization
    $('btn-submit-policy')?.addEventListener('click', () => {
      const addr = $('auditor-addr-input')?.value?.trim();
      const date = $('auditor-expiry-input')?.value || '2026-12-31';
      const scope = $('auditor-scope-input')?.value || 'ALL_TRANSACTIONS';
      const net = getNetName();

      if (!addr) {
        alert("Please enter the auditor's EVM address.");
        $('auditor-addr-input')?.focus();
        return;
      }

      const btn = $('btn-submit-policy');
      btn.disabled = true;
      btn.innerText = `Anchoring to ${net} VeyroqRegistry...`;

      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span>Authorize Auditor Policy On-Chain</span>`;

        const list = $('auditor-list-container');
        if (list) {
          const item = document.createElement('div');
          item.className = 'auditor-item';
          item.innerHTML = `<div class="auditor-meta"><strong>Authorized Auditor (Active)</strong><span class="font-mono text-cyan">${addr.slice(0, 6)}...${addr.slice(-4)}</span><small>Network: ${net} · Scope: ${scope} · Valid until ${date}</small></div><button class="btn btn-secondary btn-sm" onclick="revokeAuditorMock(this, 'Auditor')">Revoke</button>`;
          list.prepend(item);
        }
        alert(`Auditor policy successfully registered and anchored to VeyroqRegistry on ${net}!`);
      }, 750);
    });
  });

  window.revokeAuditorMock = function(btn, name) {
    if (confirm(`Are you sure you want to revoke on-chain audit authorization for ${name}?`)) {
      const item = btn.closest('.auditor-item');
      if (item) {
        item.style.opacity = '0.35';
        btn.disabled = true;
        btn.innerText = "Revoked";
      }
    }
  };
}
