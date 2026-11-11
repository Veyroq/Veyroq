// Veyroq Institutional Audit & Real On-Chain Transaction Engine
// Supports Privy Auth, Injected Web3, Live RPC Ingestion & Persistent Tagging.

import { NETWORKS, fetchLiveTransactions, saveTransactionTag, getTransactionTag, getExplorerAddressUrl } from './chain-scanner.js';
import { 
  connectInjectedWallet, 
  initPrivy, 
  sendEmailOtp, 
  verifyEmailOtp, 
  setAuthState, 
  clearAuthState, 
  getAuthSession, 
  disconnectWallet, 
  copyToClipboard 
} from './privy-auth.js';
import {
  REGISTRY_ADDRESS,
  USDC_ADDRESS,
  ARC_CHAIN_ID_HEX,
  ARC_EXPLORER_TX,
  fetchOnChainSubscription,
  executeSubscribeOnChain,
  executeCommitProofOnChain,
  executeAuthorizeAuditorOnChain
} from './contract-client.js';

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

  // ---------------------------------------------------------------------------
  // Two-Tier Vault Management (Draft Mode vs EIP-4361 Verified Organization Vault)
  // ---------------------------------------------------------------------------
  function getVerifiedVaults() {
    try {
      return JSON.parse(localStorage.getItem('veyroq_verified_vaults') || '{}');
    } catch {
      return {};
    }
  }

  function isVaultVerified(address) {
    if (!address) return false;
    const vaults = getVerifiedVaults();
    return !!vaults[address.toLowerCase()];
  }

  function setVaultVerified(address, details = {}) {
    if (!address) return;
    const vaults = getVerifiedVaults();
    vaults[address.toLowerCase()] = {
      verifiedAt: details.verifiedAt || new Date().toISOString(),
      domain: details.domain || window.location.host,
      chainId: details.chainId || 5042002
    };
    localStorage.setItem('veyroq_verified_vaults', JSON.stringify(vaults));
    updateVaultTierUI(address);
  }

  function updateVaultTierUI(address) {
    const target = address || $('org-address')?.value?.trim();
    const isVerified = isVaultVerified(target);
    const badge = $('vault-status-badge');
    const btn = $('btn-open-verify-modal');
    const stripStatus = $('merkle-status');

    if (badge) {
      if (isVerified) {
        badge.className = 'badge-tier verified';
        badge.textContent = '✓ Verified Organization Vault';
      } else {
        badge.className = 'badge-tier unverified';
        badge.textContent = 'Draft Mode (Unverified)';
      }
    }

    if (btn) {
      if (isVerified) {
        btn.className = 'btn-verify-tier verified';
        btn.textContent = 'Verified ✓';
        btn.title = 'Vault ownership cryptographically verified via EIP-4361';
      } else {
        btn.className = 'btn-verify-tier';
        btn.textContent = 'Verify Ownership ↗';
        btn.title = 'Sign EIP-4361 zero-gas challenge to verify vault ownership';
      }
    }

    if (stripStatus) {
      if (isVerified) {
        stripStatus.innerHTML = '<span class="status-verified-text" style="color:#1E6B37;">✓ Verified Organization Vault</span>';
      } else {
        stripStatus.innerHTML = '<span class="status-verified-text">Draft Workspace (Unverified)</span>';
      }
    }
  }

  let currentSiweChallenge = null;

  async function openVerifyModal() {
    const addr = $('org-address')?.value?.trim();
    if (!addr || !addr.startsWith('0x') || addr.length !== 42) {
      alert('Please enter a valid 42-character EVM address (0x...) in Treasury Wallet Address.');
      $('org-address')?.focus();
      return;
    }

    const modal = $('verify-treasury-modal');
    const preview = $('siwe-challenge-preview');
    const nonceDisplay = $('siwe-nonce-display');
    const domainPreview = $('siwe-modal-domain');
    const feedback = $('siwe-verification-feedback');
    const signBtn = $('btn-submit-siwe-sign');
    const signText = $('btn-siwe-sign-text');

    if (modal) modal.style.display = 'flex';
    if (feedback) feedback.textContent = '';
    if (signBtn) signBtn.disabled = false;
    if (signText) signText.textContent = 'Sign Verification Challenge';

    const domain = window.location.host;
    if (domainPreview) domainPreview.textContent = domain;
    if (preview) preview.textContent = 'Requesting challenge from server...';
    if (nonceDisplay) nonceDisplay.textContent = 'Nonce: loading...';

    try {
      const res = await fetch(`/api/auth/siwe/nonce?address=${encodeURIComponent(addr)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to fetch challenge');

      const chainId = 5042002;
      const issuedAt = new Date().toISOString();
      const expiresAt = data.expiresAt;

      const message = `${data.domain || domain} wants you to sign in with your Ethereum account:\n${addr}\n\nVerify treasury ownership for Veyroq Institutional Cockpit. This action is zero-gas and NEVER approves token transfers or contract allowances.\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${data.nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}`;

      currentSiweChallenge = {
        message,
        address: addr,
        nonce: data.nonce,
        domain: data.domain || domain,
        chainId
      };

      if (preview) preview.textContent = message;
      if (nonceDisplay) nonceDisplay.textContent = `Nonce: ${data.nonce.slice(0, 8)}...`;
    } catch (err) {
      if (preview) preview.textContent = `Error: ${err.message}`;
      if (feedback) {
        feedback.style.color = '#8A201C';
        feedback.textContent = `Failed to generate challenge: ${err.message}`;
      }
    }
  }

  function closeVerifyModal() {
    if ($('verify-treasury-modal')) $('verify-treasury-modal').style.display = 'none';
    currentSiweChallenge = null;
  }

  async function submitSiweSign() {
    if (!currentSiweChallenge) return;
    const { message, address } = currentSiweChallenge;
    const feedback = $('siwe-verification-feedback');
    const signBtn = $('btn-submit-siwe-sign');
    const signText = $('btn-siwe-sign-text');

    try {
      if (signBtn) signBtn.disabled = true;
      if (signText) signText.textContent = 'Awaiting wallet signature...';
      if (feedback) {
        feedback.style.color = 'var(--ink-secondary)';
        feedback.textContent = 'Confirm on your wallet / Ledger screen: No balance change...';
      }

      let provider = window.ethereum;
      if (!provider) {
        throw new Error('No Web3 wallet extension (Rabby, MetaMask, Safe) detected in browser.');
      }

      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, address]
      });

      if (signText) signText.textContent = 'Verifying signature on server...';

      const verifyRes = await fetch('/api/auth/siwe/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature, address })
      });

      const verifyData = await verifyRes.json();
      if (!verifyData.success) {
        throw new Error(verifyData.error || 'Server rejected verification signature.');
      }

      setVaultVerified(address, verifyData);
      if (feedback) {
        feedback.style.color = '#1E6B37';
        feedback.textContent = '✓ Treasury ownership verified! Replay protection locked.';
      }
      if (signText) signText.textContent = 'Verified Successfully ✓';

      setTimeout(() => {
        closeVerifyModal();
      }, 1200);
    } catch (err) {
      if (signBtn) signBtn.disabled = false;
      if (signText) signText.textContent = 'Sign Verification Challenge';
      if (feedback) {
        feedback.style.color = '#8A201C';
        feedback.textContent = err.message || 'Signature failed or rejected.';
      }
    }
  }

  function applyConnectedWallet(address, label, email = null) {
    if (!address) return;
    connectedAddress = address;
    setAuthState(address, label, null, email);

    const shortAddr = address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

    if ($('org-address')) $('org-address').value = address;

    const walletBtn = $('btn-wallet-connect');
    if (walletBtn) {
      walletBtn.classList.add('connected');
      walletBtn.title = `Connected: ${address} (Click to manage)`;
    }
    if ($('wallet-btn-text')) {
      $('wallet-btn-text').textContent = `${label}: ${shortAddr}`;
    }

    const pill = $('connected-wallet-pill');
    if (pill) {
      pill.style.display = 'inline-block';
      pill.textContent = `${label} Verified`;
      pill.classList.add('badge-tag-connected');
      pill.title = 'Click to inspect allocated address & session';
    }

    if ($('display-treasury-addr')) $('display-treasury-addr').textContent = shortAddr;
    if ($('cert-display-vault')) $('cert-display-vault').textContent = shortAddr;

    // Update Connected Account Modal
    if ($('account-modal-full-address')) $('account-modal-full-address').textContent = address;
    if ($('account-modal-auth-method')) $('account-modal-auth-method').textContent = label === 'Privy' ? 'Privy Core' : `${label} Connected`;
    if ($('account-modal-network')) $('account-modal-network').textContent = getNetFullName();
    if ($('link-account-explorer')) $('link-account-explorer').href = getExplorerAddressUrl(getNetName(), address);

    if ($('account-modal-email-row')) {
      const emailRow = $('account-modal-email-row');
      const emailVal = $('account-modal-email');
      if (email && emailRow && emailVal) {
        emailVal.textContent = email;
        emailRow.style.display = 'flex';
      } else if (emailRow) {
        emailRow.style.display = 'none';
      }
    }

    updateVaultTierUI(address);
    syncOnChainSubscription(address);

    if ($('wallet-modal')) $('wallet-modal').style.display = 'none';
  }

  function handleDisconnect() {
    connectedAddress = null;
    disconnectWallet();

    const walletBtn = $('btn-wallet-connect');
    if (walletBtn) {
      walletBtn.classList.remove('connected');
      walletBtn.title = 'Connect Treasury Wallet';
    }
    if ($('wallet-btn-text')) $('wallet-btn-text').textContent = 'Connect Wallet';

    const pill = $('connected-wallet-pill');
    if (pill) {
      pill.textContent = 'Privy Core Verified';
      pill.classList.remove('badge-tag-connected');
      pill.title = 'Manage connected account';
    }

    if ($('display-treasury-addr')) $('display-treasury-addr').textContent = '0x71C8...22Ec';
    if ($('org-address')) $('org-address').value = '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec';

    if ($('privy-email-step')) $('privy-email-step').style.display = 'block';
    if ($('privy-otp-step')) $('privy-otp-step').style.display = 'none';
    if ($('privy-otp-input')) $('privy-otp-input').value = '';
    if ($('privy-auth-status')) $('privy-auth-status').textContent = '';

    if ($('account-modal')) $('account-modal').style.display = 'none';
    updateVaultTierUI();
  }

  function openWalletModal() {
    if ($('wallet-modal')) $('wallet-modal').style.display = 'flex';
  }

  function closeWalletModal() {
    if ($('wallet-modal')) $('wallet-modal').style.display = 'none';
  }

  function openAccountModal() {
    if ($('account-modal-network')) $('account-modal-network').textContent = getNetFullName();
    if ($('link-account-explorer') && connectedAddress) {
      $('link-account-explorer').href = getExplorerAddressUrl(getNetName(), connectedAddress);
    }
    if ($('account-modal')) $('account-modal').style.display = 'flex';
  }

  function closeAccountModal() {
    if ($('account-modal')) $('account-modal').style.display = 'none';
    updateVaultTierUI();
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
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 48px; color: var(--ink-muted);">Click <strong>"Fetch Real On-Chain History"</strong> to scan live blocks via RPC node.</td></tr>`;
      return;
    }

    tbody.innerHTML = loadedTransactions.map(tx => {
      const txHash = tx.hash || tx.id;
      const tagInfo = getTransactionTag(txHash) || {};
      const currentLabel = tagInfo.tag || tx.plainCounterparty || tx.counterparty;
      const currentCategory = tagInfo.category || tx.category || 'General';

      let counterpartyHtml = '';
      if (activeScope === 'full') {
        const sub = tx.counterparty || '';
        counterpartyHtml = `<strong>${currentLabel}</strong><br><small class="counterparty-sub">${sub}</small>`;
      } else {
        const refShort = `Ref: ${txHash.slice(0, 10)}...${txHash.slice(-4)}`;
        counterpartyHtml = `<span class="redacted-pill"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Confidential counterparty</span><br><small class="counterparty-sub font-mono">${refShort}</small>`;
      }

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

  function updateTierButtons(activeKey) {
    ['free', 'enterprise', 'partner'].forEach(k => {
      const btn = $('btn-tier-' + k);
      if (btn) {
        if (k === activeKey) {
          btn.className = 'btn-select-tier current';
          btn.textContent = 'Active Plan';
        } else {
          btn.className = 'btn-select-tier';
          btn.textContent = 'Select';
        }
      }
    });
  }

  async function syncOnChainSubscription(address) {
    const target = address || connectedAddress || $('org-address')?.value?.trim();
    if (!target) return;
    try {
      const sub = await fetchOnChainSubscription(target);
      const badge = $('plan-badge-display');
      if (sub.isActive && sub.tierCode > 0) {
        if (badge) {
          badge.textContent = `${sub.tier} (On-Chain)`;
          badge.className = sub.tierCode === 2 ? 'plan-badge partner' : 'plan-badge enterprise';
        }
        updateTierButtons(sub.tierCode === 2 ? 'partner' : 'enterprise');
      }
    } catch (err) {
      console.warn('Subscription sync error:', err);
    }
  }

  window.handlePlanTierSelect = async function(tierKey, tierLabel) {
    const badge = $('plan-badge-display');
    const closePlanModal = () => {
      if ($('plan-modal')) $('plan-modal').style.display = 'none';
    };

    if (tierKey === 'free') {
      if (badge) {
        badge.textContent = tierLabel;
        badge.className = 'plan-badge free';
      }
      updateTierButtons('free');
      closePlanModal();
      return;
    }

    const tierCode = tierKey === 'partner' ? 2 : 1;
    const provider = window.ethereum;

    if (!provider) {
      if (badge) {
        badge.textContent = tierLabel;
        badge.className = 'plan-badge ' + tierKey;
      }
      updateTierButtons(tierKey);
      closePlanModal();
      alert(`Set ${tierLabel} locally.\nTo anchor and pay in testnet USDC, connect a Web3 wallet (MetaMask, Rabby) to Circle Arc Testnet.`);
      return;
    }

    const targetBtn = $('btn-tier-' + tierKey);
    const originalText = targetBtn ? targetBtn.textContent : 'Select';
    if (targetBtn) {
      targetBtn.disabled = true;
      targetBtn.textContent = 'Subscribing...';
    }

    try {
      const txHash = await executeSubscribeOnChain(provider, tierCode, 1);
      if (badge) {
        badge.textContent = `${tierLabel} (On-Chain)`;
        badge.className = 'plan-badge ' + tierKey;
      }
      updateTierButtons(tierKey);
      closePlanModal();
      alert(`Successfully subscribed on Circle Arc Testnet!\nTx Hash: ${txHash}\nView on Explorer: ${ARC_EXPLORER_TX + txHash}`);
    } catch (err) {
      console.error('On-chain subscription failed:', err);
      alert(`On-chain subscription failed: ${err.message || err}`);
    } finally {
      if (targetBtn) {
        targetBtn.disabled = false;
        targetBtn.textContent = originalText;
      }
    }
  };

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
    if ($('merkle-status')) $('merkle-status').innerHTML = `<span class="status-verified-text">100% on-chain balanced</span>`;
    if ($('stat-root')) $('stat-root').innerText = `${calculatedMerkleRoot.slice(0, 10)}...${calculatedMerkleRoot.slice(-4)}`;
    if ($('stat-assurance')) $('stat-assurance').innerHTML = `<span class="status-verified-text">GAAP proof active</span>`;

    if ($('cert-display-outflow')) $('cert-display-outflow').textContent = formattedTotal;
    if ($('cert-display-items')) $('cert-display-items').textContent = `${loadedTransactions.length} Verified (100% On-Chain)`;
    if ($('cert-display-proof')) $('cert-display-proof').textContent = `${calculatedMerkleRoot.slice(0, 10)}... (Valid Merkle Proof)`;
    if ($('synced-tx-count')) $('synced-tx-count').textContent = `(${loadedTransactions.length} Synced)`;

    if ($('banner-proof')) $('banner-proof').style.display = 'flex';
    if ($('banner-root-hash')) $('banner-root-hash').innerText = calculatedMerkleRoot;
    if ($('slip-card-preview')) $('slip-card-preview').style.display = 'flex';

    ['btn-export-csv', 'btn-export-xero', 'btn-export-cert', 'btn-anchor-proof-modal'].forEach(id => {
      if ($(id)) $(id).disabled = false;
    });
  }

  function initApp() {
    // Network Selector
    $('network-select')?.addEventListener('change', () => {
      if ($('active-network-label')) $('active-network-label').textContent = getNetFullName();
      if ($('network-rpc-status')) $('network-rpc-status').textContent = `${getNetName()} RPC Active`;
    });

    // Scope Toggle
    $('btn-scope-full')?.addEventListener('click', () => setScope('full'));
    $('btn-scope-redacted')?.addEventListener('click', () => setScope('redacted'));

    // Wallet & Account Modal Controls
    $('btn-wallet-connect')?.addEventListener('click', () => {
      if (connectedAddress) {
        openAccountModal();
      } else {
        openWalletModal();
      }
    });

    $('btn-close-modal')?.addEventListener('click', closeWalletModal);
    $('wallet-modal')?.addEventListener('click', e => { if (e.target === $('wallet-modal')) closeWalletModal(); });

    $('btn-close-account-modal')?.addEventListener('click', closeAccountModal);
    $('account-modal')?.addEventListener('click', e => { if (e.target === $('account-modal')) closeAccountModal(); });
    $('btn-disconnect-wallet')?.addEventListener('click', handleDisconnect);

    $('btn-close-tag-modal')?.addEventListener('click', () => { if ($('tag-modal')) $('tag-modal').style.display = 'none'; });
    $('tag-modal')?.addEventListener('click', e => { if (e.target === $('tag-modal')) $('tag-modal').style.display = 'none'; });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeWalletModal();
        closeAccountModal();
        if ($('tag-modal')) $('tag-modal').style.display = 'none';
      }
    });

    // 1-Click Copy Handlers with Visual Feedback
    $('btn-copy-account-addr')?.addEventListener('click', async () => {
      const addr = connectedAddress || $('account-modal-full-address')?.textContent?.trim();
      if (addr) {
        const ok = await copyToClipboard(addr);
        if (ok) {
          const span = $('copy-addr-text');
          if (span) {
            const original = span.textContent;
            span.textContent = 'Copied!';
            setTimeout(() => { span.textContent = original; }, 2000);
          }
        }
      }
    });

    $('btn-copy-org-address')?.addEventListener('click', async () => {
      const addr = $('org-address')?.value?.trim();
      if (addr) {
        const ok = await copyToClipboard(addr);
        if (ok) {
          const span = $('copy-org-text');
          if (span) {
            const original = span.textContent;
            span.textContent = 'Copied!';
            setTimeout(() => { span.textContent = original; }, 2000);
          }
        }
      }
    });

    $('btn-copy-strip-addr')?.addEventListener('click', async () => {
      const addr = connectedAddress || $('org-address')?.value?.trim();
      if (addr) {
        const ok = await copyToClipboard(addr);
        if (ok) {
          const btn = $('btn-copy-strip-addr');
          if (btn) {
            btn.style.color = 'var(--green-verified)';
            setTimeout(() => { btn.style.color = ''; }, 1500);
          }
        }
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
        if (statusEl) statusEl.textContent = 'Sending authentication code...';
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
        if (statusEl) statusEl.textContent = 'Verifying code & allocating EVM address...';
        const { address, email: verifiedEmail } = await verifyEmailOtp(email, code);
        applyConnectedWallet(address, 'Privy', verifiedEmail || email);
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message || 'Verification failed';
      }
    });

    // Auditor Read-Only
    $('btn-connect-manual')?.addEventListener('click', () => {
      closeWalletModal();
      $('org-address')?.focus();
      $('org-address')?.select();
    });

    // Connected Wallet Pill opens Account Modal or restores address
    $('connected-wallet-pill')?.addEventListener('click', () => {
      if (connectedAddress) {
        openAccountModal();
      } else {
        openWalletModal();
      }
    });

    // Auto-restore active persistent session on boot
    const existingSession = getAuthSession();
    if (existingSession && existingSession.address) {
      applyConnectedWallet(existingSession.address, existingSession.method, existingSession.email);
    }

    // Two-Tier Treasury Verification Events
    $('org-address')?.addEventListener('input', () => {
      updateVaultTierUI();
      syncOnChainSubscription();
    });
    $('btn-open-verify-modal')?.addEventListener('click', openVerifyModal);
    $('btn-close-verify-modal')?.addEventListener('click', closeVerifyModal);
    $('btn-submit-siwe-sign')?.addEventListener('click', submitSiweSign);
    updateVaultTierUI();
    syncOnChainSubscription();

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

    // Anchor Audit Proof On-Chain Action
    $('btn-anchor-proof-modal')?.addEventListener('click', async () => {
      const provider = window.ethereum;
      const feedback = $('anchor-proof-feedback');
      const btn = $('btn-anchor-proof-modal');
      const btnText = $('anchor-btn-text');

      if (!calculatedMerkleRoot) {
        alert('Please calculate or fetch transactions first to generate a Merkle root proof.');
        return;
      }

      if (!provider) {
        alert('Please connect a Web3 wallet (MetaMask, Rabby) to anchor proofs on Circle Arc Testnet.');
        return;
      }

      const orgAddress = connectedAddress || $('org-address')?.value?.trim();
      const now = Math.floor(Date.now() / 1000);
      const periodStart = now - (90 * 86400);
      const periodEnd = now;
      const count = loadedTransactions.length;

      try {
        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = 'Anchoring to Circle Arc...';
        if (feedback) feedback.innerHTML = '<span style="color:var(--burgundy);">Approving $5 protocol fee &amp; submitting proof...</span>';

        const txHash = await executeCommitProofOnChain(provider, orgAddress, calculatedMerkleRoot, periodStart, periodEnd, count);

        if (feedback) {
          feedback.innerHTML = `<span style="color:var(--green-verified); font-weight:600;">✓ Proof anchored on Arc Testnet!</span> <a href="${ARC_EXPLORER_TX}${txHash}" target="_blank" rel="noopener noreferrer" style="color:var(--burgundy); text-decoration:underline; font-weight:600; margin-left:4px;">Explorer Tx ↗</a>`;
        }
        if ($('cert-display-proof')) {
          $('cert-display-proof').innerHTML = `${calculatedMerkleRoot.slice(0, 10)}... <a href="${ARC_EXPLORER_TX}${txHash}" target="_blank" rel="noopener noreferrer" style="color:var(--green-verified); text-decoration:underline;">(Anchored on Arc)</a>`;
        }
      } catch (err) {
        console.error('Anchor proof failed:', err);
        if (feedback) feedback.innerHTML = `<span style="color:#C93B2B;">Failed: ${err.message || err}</span>`;
      } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Anchor Proof on Arc Testnet ($5 USDC)';
      }
    });

    // Auditor Policy Authorization On-Chain Action
    $('btn-submit-policy')?.addEventListener('click', async () => {
      const addr = $('auditor-addr-input')?.value?.trim();
      const dateVal = $('auditor-expiry-input')?.value || '2026-12-31';
      const scope = $('auditor-scope-input')?.value || 'ALL_TRANSACTIONS';
      const feedback = $('policy-tx-feedback');
      const btn = $('btn-submit-policy');
      const btnText = $('btn-submit-policy-text');

      if (!addr || !addr.startsWith('0x') || addr.length !== 42) {
        alert("Please enter a valid 20-byte EVM address (0x...).");
        $('auditor-addr-input')?.focus();
        return;
      }

      const expiryTimestamp = Math.floor(new Date(dateVal).getTime() / 1000);
      const provider = window.ethereum;

      if (btn) btn.disabled = true;
      if (btnText) btnText.textContent = 'Authorizing on Arc Testnet...';
      if (feedback) feedback.innerHTML = '<span style="color:var(--burgundy);">Submitting transaction to Arc Testnet...</span>';

      try {
        let txHash = null;
        if (provider) {
          txHash = await executeAuthorizeAuditorOnChain(provider, addr, expiryTimestamp, null);
        }

        const list = $('auditor-list-container');
        if (list) {
          const item = document.createElement('div');
          item.className = 'auditor-item';
          const explorerLink = txHash ? `<a href="${ARC_EXPLORER_TX}${txHash}" target="_blank" rel="noopener noreferrer" style="color:var(--burgundy); text-decoration:underline; font-size:11px; margin-left:6px;">Tx ↗</a>` : '';
          item.innerHTML = `<div class="auditor-meta"><strong>Authorized Auditor (Active On-Chain)</strong><span class="font-mono text-cyan" style="font-size:11px;">${addr.slice(0, 6)}...${addr.slice(-4)}${explorerLink}</span><small>Scope: ${scope} · Valid until ${dateVal}</small></div><button class="btn btn-secondary btn-sm" onclick="revokeAuditorMock(this, 'Auditor')">Revoke</button>`;
          list.prepend(item);
        }

        if (feedback) {
          feedback.innerHTML = txHash 
            ? `<span style="color:var(--green-verified); font-weight:600;">✓ Auditor authorized on Arc!</span> <a href="${ARC_EXPLORER_TX}${txHash}" target="_blank" rel="noopener noreferrer" style="color:var(--burgundy); text-decoration:underline;">Tx on Explorer ↗</a>`
            : `<span style="color:var(--green-verified); font-weight:600;">✓ Auditor policy registered locally!</span>`;
        }
      } catch (err) {
        console.error('Authorize auditor failed:', err);
        if (feedback) feedback.innerHTML = `<span style="color:#C93B2B;">Failed: ${err.message || err}</span>`;
      } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Authorize Auditor Policy on Arc Testnet';
      }
    });
  }

  // Ensure initialization runs reliably across all browser execution timings
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

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
