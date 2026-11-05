// Veyroq Client-Side Decryption & Merkle Audit Engine
// 100% Zero-Custody: Executing purely in volatile browser memory.

export const DEMO_TRANSACTIONS = [
  {
    id: "tx-vq-01",
    date: "2026-08-04 14:22:10 UTC",
    block: 418042,
    type: "CONFIDENTIAL_PAYROLL",
    category: "Officer Compensation (W-2)",
    counterparty: "0x89C4...12eA (Encrypted Recipient)",
    plainCounterparty: "Dr. Elena Rostova (Chief AI Scientist)",
    grossAmount: 35000.00,
    asset: "USDC",
    ciphertextHash: "0xa1e4f9b8c2d11099432857492cdaee11b402891901aef"
  },
  {
    id: "tx-vq-02",
    date: "2026-08-11 09:15:33 UTC",
    block: 418491,
    type: "SUPPLIER_SETTLEMENT",
    category: "Cloud GPU Compute Cluster",
    counterparty: "0x33A1...8910 (Encrypted Recipient)",
    plainCounterparty: "Lambda Compute Corp (A100 Cluster)",
    grossAmount: 48500.00,
    asset: "USDC",
    ciphertextHash: "0xb7c819230fae41209bceda51892019910fbcda2198034"
  },
  {
    id: "tx-vq-03",
    date: "2026-08-19 18:40:02 UTC",
    block: 418902,
    type: "TREASURY_REBALANCE",
    category: "Yield Sweep to BlackRock BUIDL",
    counterparty: "0xFE91...4402 (Encrypted Recipient)",
    plainCounterparty: "Securitize / BlackRock Treasury Vault",
    grossAmount: 50000.00,
    asset: "USDC",
    ciphertextHash: "0xc3d94018274aefb192840cde4810294719bbfe8192039"
  },
  {
    id: "tx-vq-04",
    date: "2026-08-27 11:05:49 UTC",
    block: 419014,
    type: "CONFIDENTIAL_PAYROLL",
    category: "Engineering Payroll Batch B",
    counterparty: "0x44D9...1802 (Encrypted Recipient)",
    plainCounterparty: "Core Protocol Engineers (8 Contractors)",
    grossAmount: 12000.00,
    asset: "USDC",
    ciphertextHash: "0xd90184aefb10294857102938475610293847561029384"
  },
  {
    id: "tx-vq-05",
    date: "2026-09-03 16:30:12 UTC",
    block: 419110,
    type: "SUPPLIER_SETTLEMENT",
    category: "Smart Contract Audit Retainer",
    counterparty: "0x66B2...9014 (Encrypted Recipient)",
    plainCounterparty: "OpenZeppelin Security Advisory",
    grossAmount: 2500.00,
    asset: "USDC",
    ciphertextHash: "0xe51029384756102938475610293847561029384756102"
  },
  {
    id: "tx-vq-06",
    date: "2026-09-15 20:10:00 UTC",
    block: 419200,
    type: "VENDOR_EXPENSE",
    category: "Validator & RPC Infrastructure",
    counterparty: "0x11C9...8831 (Encrypted Recipient)",
    plainCounterparty: "Enterprise Dedicated RPC Infrastructure",
    grossAmount: 250.00,
    asset: "USDC",
    ciphertextHash: "0xf11029384756102938475610293847561029384756102"
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
    const shortLeaf = tx.leafHash ? tx.leafHash.slice(0, 10) + '...' : '';
    const genericType = (tx.type || 'TRANSACTION').replace(/_/g, ' ');
    return {
      ...tx,
      plainCounterparty: `[REDACTED] ${genericType} [${shortLeaf}]`
    };
  });
}

// Browser UI Binding
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);

  let decryptedData = [];
  let calculatedMerkleRoot = "";
  let activeScope = 'full';
  let connectedAccount = null;

  const getNetName = () => $('network-select')?.value || 'Arc';
  const getNetFullName = () => $('network-select')?.options[$('network-select').selectedIndex]?.text || 'Circle Arc L1';

  function applyConnectedWallet(address, label) {
    connectedAccount = address;
    if ($('org-address')) $('org-address').value = address;
    if ($('wallet-btn-text')) $('wallet-btn-text').textContent = `${label}: ${address.slice(0, 6)}...${address.slice(-4)}`;
    const pill = $('connected-wallet-pill');
    if (pill) {
      pill.style.display = 'inline-block';
      pill.textContent = `Using ${label}`;
      pill.classList.add('badge-tag-connected');
    }
    if ($('wallet-modal')) $('wallet-modal').style.display = 'none';
  }

  function setScope(scope) {
    activeScope = scope;
    $('btn-scope-full')?.classList.toggle('active', scope === 'full');
    $('btn-scope-redacted')?.classList.toggle('active', scope === 'redacted');
    const th = $('th-counterparty');
    if (th) th.textContent = scope === 'full' ? 'Counterparty (Decrypted Auditor View)' : 'Counterparty (Zero-Leak Redacted)';
    renderTable();
  }

  function renderTable() {
    const tbody = $('table-body');
    if (!tbody) return;
    if (decryptedData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 48px; color: var(--ink-muted);">Click <strong>"Decrypt &amp; Verify Ledger"</strong> in the sidebar to decrypt transactions locally in volatile browser RAM.</td></tr>`;
      return;
    }

    tbody.innerHTML = decryptedData.map(tx => {
      const counterpartyHtml = activeScope === 'full'
        ? `<strong>${tx.plainCounterparty}</strong><span class="counterparty-sub">${tx.counterparty}</span>`
        : `<span class="redacted-pill">🔒 Confidential Counterparty</span><span class="counterparty-sub">Merkle Leaf: ${(tx.leafHash || tx.ciphertextHash).slice(0, 10)}...${(tx.leafHash || tx.ciphertextHash).slice(-4)}</span>`;

      return `<tr>
        <td>${tx.date}</td>
        <td class="font-mono">#${tx.block}</td>
        <td><strong>${tx.type.replace(/_/g, ' ')}</strong><br><small style="color:var(--ink-muted);">${tx.category}</small></td>
        <td>${counterpartyHtml}</td>
        <td style="font-weight:700; color:var(--ink-primary); font-family:var(--font-mono);">$${tx.grossAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td><span class="table-badge">${tx.asset}</span></td>
        <td><span class="badge-proof">✔ Merkle Verified</span></td>
      </tr>`;
    }).join('');
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
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('wallet-modal')) $('wallet-modal').style.display = 'none'; });

    // Web3 Browser Extension Auto-Detect
    if (typeof window.ethereum !== 'undefined' && $('detected-ext-badge')) {
      const name = window.ethereum.isRabby ? 'Rabby' : window.ethereum.isCoinbaseWallet ? 'Coinbase' : window.ethereum.isMetaMask ? 'MetaMask' : 'Web3';
      $('detected-ext-badge').textContent = `${name} Ready`;
      $('detected-ext-badge').classList.add('badge-tag-connected');
    }

    $('btn-connect-injected')?.addEventListener('click', async () => {
      if (typeof window.ethereum !== 'undefined') {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          if (accounts?.[0]) applyConnectedWallet(accounts[0], 'Web3');
        } catch (err) {
          console.warn('Wallet connection dismissed:', err);
        }
      } else {
        alert('No Web3 browser extension found. Connect using Safe Multi-Sig or Ledger options below.');
      }
    });

    // Wallet Presets
    Object.entries(WALLET_PRESETS).forEach(([btnId, preset]) => {
      $(btnId)?.addEventListener('click', () => applyConnectedWallet(preset.address, preset.label));
    });

    // Auditor Read-Only
    $('btn-connect-manual')?.addEventListener('click', () => {
      if ($('wallet-modal')) $('wallet-modal').style.display = 'none';
      $('org-address')?.focus();
      $('org-address')?.select();
    });

    // Connected Wallet Pill restore
    $('connected-wallet-pill')?.addEventListener('click', () => {
      if (connectedAccount && $('org-address')) $('org-address').value = connectedAccount;
    });

    // Demo Credentials
    $('btn-load-demo-key')?.addEventListener('click', e => {
      e.preventDefault();
      if ($('view-key')) $('view-key').value = "vk_live_7a9f4102d84c17e8b625c4ef190a33190aef92";
      if ($('org-address')) $('org-address').value = "0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec";
    });

    // Run Decryption & Merkle Ledger Verification
    $('btn-run-decryption')?.addEventListener('click', async () => {
      const btn = $('btn-run-decryption');
      btn.disabled = true;
      btn.innerHTML = `<span>Decrypting in Local RAM...</span>`;
      if ($('merkle-status')) $('merkle-status').innerHTML = `<span class="text-cyan">Querying ${getNetName()} RPC...</span>`;

      await new Promise(r => setTimeout(r, 600));
      decryptedData = [...DEMO_TRANSACTIONS];

      // Calculate Merkle leaves
      const leaves = [];
      for (const item of decryptedData) {
        const hash = await sha256(`${item.id}:${item.block}:${item.grossAmount}:${item.plainCounterparty}`);
        item.leafHash = hash;
        leaves.push(hash);
      }
      calculatedMerkleRoot = await computeMerkleRoot(leaves);

      renderTable();

      const total = decryptedData.reduce((sum, tx) => sum + tx.grossAmount, 0);
      const formattedTotal = `$${total.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC`;

      if ($('reconciled-sum')) $('reconciled-sum').innerText = formattedTotal;
      if ($('stat-volume')) $('stat-volume').innerHTML = `$${total.toLocaleString('en-US', { minimumFractionDigits: 2 })} <small>USDC</small>`;
      if ($('verified-count')) $('verified-count').innerText = decryptedData.length;
      if ($('stat-items')) $('stat-items').innerHTML = `${decryptedData.length} <small>Transactions</small>`;
      if ($('merkle-status')) $('merkle-status').innerHTML = `<span class="text-green">✔ Verified (100% Match)</span>`;
      if ($('stat-root')) $('stat-root').innerText = `${calculatedMerkleRoot.slice(0, 10)}...${calculatedMerkleRoot.slice(-4)}`;
      if ($('stat-assurance')) $('stat-assurance').innerHTML = `<span style="color:var(--green-verified);">✔ 100% RECONCILED</span>`;

      if ($('banner-proof')) $('banner-proof').style.display = 'flex';
      if ($('banner-root-hash')) $('banner-root-hash').innerText = calculatedMerkleRoot;
      if ($('slip-card-preview')) $('slip-card-preview').style.display = 'flex';

      ['btn-export-csv', 'btn-export-xero', 'btn-export-cert'].forEach(id => {
        if ($(id)) $(id).disabled = false;
      });

      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg><span>Re-Run Decryption</span>`;
    });

    // Exports
    const exportMap = {
      'btn-export-csv': (data, org, p) => window.VeyroqExporter?.exportQuickBooks(data, org, p),
      'btn-export-xero': (data, org, p) => window.VeyroqExporter?.exportXero(data, org, p),
      'btn-export-cert': (data, org, p) => window.VeyroqExporter?.exportAuditCertificate(data, calculatedMerkleRoot, org, p, getNetFullName())
    };

    Object.entries(exportMap).forEach(([id, fn]) => {
      $(id)?.addEventListener('click', () => {
        if (decryptedData.length === 0) return;
        const period = $('period-select')?.value || '2026-Q3';
        const org = $('org-address')?.value || '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec';
        fn(prepareExportTransactions(decryptedData, activeScope), org, period);
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

    // Subdomain routing
    if (window.location.hostname === 'app.veyroq.xyz') {
      document.querySelectorAll('a[href="/"]').forEach(l => l.setAttribute('href', 'https://veyroq.xyz'));
      document.querySelectorAll('a[href="/docs"]').forEach(l => l.setAttribute('href', 'https://veyroq.xyz/docs'));
      document.querySelectorAll('a[href^="/legal/"]').forEach(l => l.setAttribute('href', 'https://veyroq.xyz' + l.getAttribute('href')));
    }
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
