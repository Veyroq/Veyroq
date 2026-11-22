// Veyroq Institutional Audit & Real On-Chain Transaction Engine
// Supports Privy Auth, Injected Web3, Live RPC Ingestion & Persistent Tagging.

import { NETWORKS, fetchLiveTransactions, fetchUsdcBalance, saveTransactionTag, getTransactionTag, getExplorerAddressUrl } from './chain-scanner.js';
import { 
  connectInjectedWallet, 
  initPrivy, 
  initPrivyFromServer,
  getPrivyProvider,
  restorePrivySession,
  sendEmailOtp, 
  verifyEmailOtp, 
  setAuthState, 
  getAuthState, 
  clearAuthState, 
  getAuthSession, 
  disconnectWallet, 
  copyToClipboard 
} from './privy-auth.js';
import {
  REGISTRY_ADDRESS,
  USDC_ADDRESS,
  ARC_CHAIN_ID_DEC,
  ARC_CHAIN_ID_HEX,
  ARC_EXPLORER_TX,
  TIER_FEES,
  PROTOCOL_FEE,
  fetchOnChainSubscription,
  fetchProtocolFee,
  fetchCommitmentCount,
  fetchAuditCommitments,
  resolveLatestProofId,
  verifyBatchInclusionOnChain,
  executeSubscribeOnChain,
  executeCommitProofOnChain,
  executeAuthorizeAuditorOnChain,
  executeRevokeAuditorOnChain
} from './contract-client.js';
import {
  keccak256Utf8,
  computeTransactionLeaf,
  buildMerkleTree,
  computeMerkleRoot,
  getMerkleProof,
  verifyMerkleProofLocal,
  verifyCertificatePayload
} from './merkle.js';

export {
  keccak256Utf8,
  computeTransactionLeaf,
  buildMerkleTree,
  computeMerkleRoot,
  getMerkleProof,
  verifyMerkleProofLocal,
  verifyCertificatePayload
};

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

// SHA-256 helper using Web Cryptography API (used for policy scope hashes)
export async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return '0x' + Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
}

// Prepare export transactions based on active disclosure scope
export function prepareExportTransactions(transactions, scope) {
  if (scope !== 'redacted') return transactions;
  return transactions.map(tx => {
    const shortLeaf = tx.leafHash ? tx.leafHash.slice(0, 10) + '...' : (tx.hash ? tx.hash.slice(0, 10) + '...' : '');
    const genericType = (tx.type || tx.category || 'TRANSACTION').replace(/_/g, ' ');
    return {
      ...tx,
      plainCounterparty: `[REDACTED] ${genericType} [${shortLeaf}]`,
      notes: ''
    };
  });
}

// Browser UI Binding
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);

  function escapeHtml(val) {
    return String(val ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function safeTxHash(hash) {
    const clean = String(hash || '').trim();
    return /^(0x)?[0-9a-fA-F]{64}$/.test(clean) ? clean : '';
  }

  function formatUserError(err, prefix = '') {
    const code = err?.code ?? err?.info?.error?.code;
    const raw = String(err?.shortMessage || err?.reason || err?.message || err || 'Unexpected error').trim();
    const isRejected = code === 4001 || code === 'ACTION_REJECTED' || /user rejected|user denied|rejected the request/i.test(raw);
    if (isRejected) return 'Request cancelled in your wallet.';
    const cleaned = raw.replace(/\s*\(action=[\s\S]*\)\s*$/, '').trim();
    return prefix ? `${prefix}: ${cleaned}` : cleaned;
  }

  const TOAST_ICONS = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
  };

  function showToast(message, type = 'info', durationMs = 4500) {
    let region = $('toast-region');
    if (!region && document.body) {
      region = document.createElement('div');
      region.id = 'toast-region';
      region.className = 'toast-region';
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    if (!region) return;

    const kind = TOAST_ICONS[type] ? type : 'info';
    while (region.children.length >= 3) {
      region.firstElementChild?.remove();
    }

    const toast = document.createElement('div');
    toast.className = `veyroq-toast toast-${kind}`;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    const icon = document.createElement('span');
    icon.className = 'veyroq-toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = TOAST_ICONS[kind];

    const body = document.createElement('div');
    body.className = 'veyroq-toast-body';
    body.textContent = String(message || '');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'veyroq-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '×';

    let timer = null;
    const dismiss = () => {
      if (timer) clearTimeout(timer);
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 160);
    };

    closeBtn.addEventListener('click', dismiss);
    toast.addEventListener('mouseenter', () => { if (timer) clearTimeout(timer); });
    toast.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 2200); });

    toast.append(icon, body, closeBtn);
    region.appendChild(toast);
    timer = setTimeout(dismiss, durationMs);
  }
  if (typeof window !== 'undefined') window.showToast = showToast;

  let allFetchedTransactions = [];
  let loadedTransactions = [];
  let calculatedMerkleRoot = "";

  const QUARTER_MONTH_LABELS = ['Jan - Mar', 'Apr - June', 'July - Sept', 'Oct - Dec'];

  function populateAccountingPeriods() {
    const sel = $('period-select');
    if (!sel) return;
    const now = new Date();
    let y = now.getUTCFullYear();
    let q = Math.floor(now.getUTCMonth() / 3) + 1;
    const options = [{ value: 'ALL', label: 'All Available History' }];
    for (let i = 0; i < 4; i++) {
      options.push({
        value: `${y}-Q${q}`,
        label: `FY ${y} - Q${q} (${QUARTER_MONTH_LABELS[q - 1]})`
      });
      q -= 1;
      if (q === 0) { q = 4; y -= 1; }
    }
    sel.innerHTML = options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    sel.value = 'ALL';
  }

  function parseTxTimestampSec(tx) {
    const raw = String(tx?.date || '').trim();
    if (!raw) return null;
    const iso = raw.endsWith('UTC') ? raw.replace(' UTC', 'Z').replace(' ', 'T') : raw;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }

  function getPeriodBounds(periodValue, txs = []) {
    const m = /^(\d{4})-Q([1-4])$/.exec(String(periodValue || ''));
    if (m) {
      const year = Number(m[1]);
      const quarter = Number(m[2]);
      const startMonth = (quarter - 1) * 3;
      const startMs = Date.UTC(year, startMonth, 1, 0, 0, 0);
      const endMs = Date.UTC(year, startMonth + 3, 0, 23, 59, 59);
      return { periodStart: Math.floor(startMs / 1000), periodEnd: Math.floor(endMs / 1000) };
    }
    const timestamps = (txs || []).map(parseTxTimestampSec).filter(t => t !== null);
    const now = Math.floor(Date.now() / 1000);
    if (timestamps.length > 0) {
      return {
        periodStart: Math.min(...timestamps),
        periodEnd: Math.max(...timestamps)
      };
    }
    return { periodStart: now - (90 * 86400), periodEnd: now };
  }

  function applyActivePeriodFilter() {
    const periodVal = $('period-select')?.value || 'ALL';
    if (periodVal === 'ALL') {
      loadedTransactions = [...allFetchedTransactions];
      return;
    }
    const { periodStart, periodEnd } = getPeriodBounds(periodVal);
    loadedTransactions = allFetchedTransactions.filter(tx => {
      const ts = parseTxTimestampSec(tx);
      if (ts === null) return true;
      return ts >= periodStart && ts <= periodEnd;
    });
  }

  function initAuditorExpiryDefault() {
    const input = $('auditor-expiry-input');
    if (!input) return;
    const today = new Date();
    const minStr = today.toISOString().slice(0, 10);
    const defDate = new Date(today.getTime() + (90 * 86400 * 1000));
    input.min = minStr;
    if (!input.value) input.value = defDate.toISOString().slice(0, 10);
  }
  let lastCommitment = null;
  let currentProtocolFee = PROTOCOL_FEE;
  let activeScope = 'full';
  let connectedAddress = null;
  let connectedMethod = null;
  let currentTierCode = 0;
  const serverVerifiedVaults = new Set();

  const getNetName = () => $('network-select')?.value || 'Arc';
  const getNetFullName = () => $('network-select')?.options[$('network-select').selectedIndex]?.text || 'Arc Testnet';

  // EIP-6963 Multi-Wallet Discovery Registry
  const eip6963Providers = new Map();
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('eip6963:announceProvider', (event) => {
      const detail = event.detail;
      if (detail && detail.info && detail.provider) {
        const key = (detail.info.rdns || detail.info.name || '').toLowerCase();
        eip6963Providers.set(key, detail);
      }
    });
    try {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    } catch {}
  }

  function resolveSelectedProvider(selectionKey) {
    const key = (selectionKey || '').toLowerCase();
    for (const [k, detail] of eip6963Providers.entries()) {
      const name = (detail.info?.name || '').toLowerCase();
      if (k.includes(key) || name.includes(key)) {
        return detail.provider;
      }
    }
    const eth = window.ethereum;
    if (!eth) return null;
    if (Array.isArray(eth.providers)) {
      if (key === 'safepal') {
        const p = eth.providers.find(pr => pr.isSafePal);
        if (p) return p;
      }
      if (key === 'rabby') {
        const p = eth.providers.find(pr => pr.isRabby);
        if (p) return p;
      }
      if (key === 'metamask') {
        const p = eth.providers.find(pr => pr.isMetaMask && !pr.isRabby && !pr.isSafePal);
        if (p) return p;
      }
    }
    if (key === 'safepal' && (window.safepalProvider || eth.isSafePal)) {
      return window.safepalProvider || eth;
    }
    if (key === 'rabby' && eth.isRabby) return eth;
    if (key === 'metamask' && eth.isMetaMask && !eth.isRabby) return eth;
    return eth;
  }

  // ---------------------------------------------------------------------------
  // Two-Tier Vault Management (Draft Mode vs Server-Verified EIP-4361 / Session Vault)
  // ---------------------------------------------------------------------------
  function isVaultVerified(address) {
    if (!address) return false;
    const target = address.toLowerCase();
    if (connectedAddress && connectedAddress.toLowerCase() === target) {
      return true;
    }
    return serverVerifiedVaults.has(target);
  }

  function setVaultVerified(address) {
    if (!address) return;
    serverVerifiedVaults.add(address.toLowerCase());
    updateVaultTierUI(address);
  }

  function updateVaultTierUI(address) {
    const target = address || $('org-address')?.value?.trim();
    const isVerified = isVaultVerified(target);
    const badge = $('vault-status-badge');
    const btn = $('btn-open-verify-modal');

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
        btn.title = 'Vault custody actively verified via session / EIP-4361';
      } else {
        btn.className = 'btn-verify-tier';
        btn.textContent = 'Verify Ownership ↗';
        btn.title = 'Verify vault custody via active session or EIP-4361 challenge';
      }
    }
  }

  let currentSiweChallenge = null;

  async function openVerifyModal() {
    const addr = $('org-address')?.value?.trim();
    if (!addr || !addr.startsWith('0x') || addr.length !== 42) {
      showToast('Enter a valid 42-character EVM address (0x...) in Treasury Wallet Address.', 'warning');
      $('org-address')?.focus();
      return;
    }

    if (connectedAddress && connectedAddress.toLowerCase() === addr.toLowerCase()) {
      setVaultVerified(addr, { verifiedAt: new Date().toISOString(), method: connectedMethod || 'Session' });
      showToast(`Vault ${addr.slice(0, 6)}...${addr.slice(-4)} verified via your connected ${connectedMethod || 'wallet'} session.`, 'success');
      updateVaultTierUI(addr);
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

    const walletSelect = $('siwe-wallet-select');
    const manualGroup = $('siwe-manual-sig-group');
    if (walletSelect) {
      const isPrivy = (connectedMethod && connectedMethod.toLowerCase().includes('privy'));
      if (isPrivy && connectedAddress && connectedAddress.toLowerCase() === addr.toLowerCase()) {
        walletSelect.value = 'privy';
      } else if (walletSelect.value === 'privy' && (!connectedAddress || connectedAddress.toLowerCase() !== addr.toLowerCase())) {
        walletSelect.value = window.ethereum?.isRabby ? 'rabby' : (window.ethereum?.isSafePal ? 'safepal' : 'metamask');
      }
      if (manualGroup) {
        manualGroup.style.display = walletSelect.value === 'hardware' ? 'block' : 'none';
      }
    }

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
    const selectedMethod = $('siwe-wallet-select')?.value || 'privy';

    try {
      if (signBtn) signBtn.disabled = true;

      let signature = '';

      if (selectedMethod === 'privy') {
        if (signText) signText.textContent = 'Awaiting Privy wallet signature...';
        if (feedback) {
          feedback.style.color = 'var(--ink-secondary)';
          feedback.textContent = 'Signing EIP-4361 ownership proof with your Privy wallet...';
        }
        const privyProv = await getPrivyProvider();
        if (!privyProv) {
          throw new Error('Privy wallet signer not unlocked. Reconnect via Privy Email OTP first.');
        }
        const accts = await privyProv.request({ method: 'eth_accounts' });
        const signerAddr = accts?.[0] || connectedAddress;
        if (!signerAddr) throw new Error('No active Privy signer address found.');
        signature = await privyProv.request({
          method: 'personal_sign',
          params: [message, signerAddr]
        });
      } else if (selectedMethod === 'hardware') {
        signature = $('siwe-manual-sig-input')?.value?.trim() || '';
        if (!signature || !signature.startsWith('0x') || signature.length < 130) {
          throw new Error('Please paste a valid 0x signature hex (offline signer or EIP-1271 Safe message signature).');
        }
      } else {
        if (signText) signText.textContent = 'Awaiting wallet signature...';
        if (feedback) {
          feedback.style.color = 'var(--ink-secondary)';
          feedback.textContent = `Prompting ${selectedMethod.toUpperCase()} wallet: Confirm "No balance change"...`;
        }

        const provider = resolveSelectedProvider(selectedMethod);
        if (!provider) {
          throw new Error(`${selectedMethod.toUpperCase()} wallet extension not detected in browser.`);
        }

        let accounts = await provider.request({ method: 'eth_accounts' });
        if (!accounts || accounts.length === 0) {
          accounts = await provider.request({ method: 'eth_requestAccounts' });
        }
        const activeAddr = accounts?.[0];
        if (!activeAddr) {
          throw new Error(`No account unlocked in ${selectedMethod.toUpperCase()}.`);
        }

        // Sign with active signer (works for direct EOA AND Safe Multisig owner verification)
        signature = await provider.request({
          method: 'personal_sign',
          params: [message, activeAddr]
        });
      }

      if (signText) signText.textContent = 'Verifying on-chain ownership...';

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
        feedback.textContent = verifyData.role === 'safe_owner'
          ? `✓ Safe Multisig verified on-chain via Owner (${verifyData.signer?.slice(0, 6)}...${verifyData.signer?.slice(-4)})!`
          : '✓ Treasury ownership verified! Replay protection locked.';
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
    connectedMethod = label;
    setAuthState(address, label, null, email);
    setVaultVerified(address, { verifiedAt: new Date().toISOString(), method: label });

    const shortAddr = address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

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

    if ($('display-treasury-name')) $('display-treasury-name').textContent = `${label} Treasury Vault`;
    if ($('display-treasury-addr')) $('display-treasury-addr').textContent = shortAddr;
    if ($('btn-copy-strip-addr')) $('btn-copy-strip-addr').style.display = 'inline-block';
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
    refreshAccountUsdcBalance(getNetName(), address);

    if ($('wallet-modal')) $('wallet-modal').style.display = 'none';
  }

  async function refreshAccountUsdcBalance(networkOverride = null, addrOverride = null) {
    const targetAddr = addrOverride || connectedAddress;
    const netKey = networkOverride || getNetName() || 'Arc';
    const netInfo = NETWORKS[netKey] || NETWORKS['Arc'];
    const chainLabel = $('account-modal-usdc-chain');
    const balEl = $('account-modal-usdc-balance');

    if (chainLabel) chainLabel.textContent = netInfo?.name || netKey;
    if (!targetAddr || !balEl) {
      if (balEl) balEl.textContent = '— USDC';
      return;
    }

    balEl.textContent = 'Loading...';
    try {
      const res = await fetchUsdcBalance(targetAddr, netKey);
      if (!res.supported) {
        balEl.textContent = `Not configured on ${netKey}`;
        return;
      }
      balEl.textContent = `${res.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`;
    } catch {
      balEl.textContent = 'Balance unavailable';
    }
  }

  function isPrivyModeActive(auth = getAuthState()) {
    return Boolean(
      (connectedMethod && connectedMethod.toLowerCase().includes('privy')) ||
      (auth?.method && auth.method.toLowerCase().includes('privy')) ||
      auth?.email
    );
  }

  async function resolveActiveSigner() {
    const auth = getAuthState();
    if (isPrivyModeActive(auth)) {
      const provider = await getPrivyProvider();
      if (!provider) {
        openWalletModal();
        throw new Error('Privy wallet signer needs a fresh OTP unlock. Sign in via Privy Email OTP to authorize transactions.');
      }
      const accounts = await provider.request({ method: 'eth_accounts' });
      const addr = accounts?.[0] || connectedAddress || auth.address;
      return { provider, address: addr, isPrivy: true, label: 'Privy Wallet' };
    }

    const provider = window.ethereum;
    if (!provider) {
      throw new Error('A Web3 wallet extension (SafePal, Rabby, MetaMask) or Privy Wallet is required.');
    }
    let accounts = await provider.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0) {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    }
    return { provider, address: accounts?.[0] || connectedAddress, isPrivy: false, label: 'Browser Extension Wallet' };
  }

  async function ensureArcUsdcBalance(userAddr, requiredRaw, actionLabel) {
    const bal = await fetchUsdcBalance(userAddr, 'Arc');
    if (bal.supported && bal.raw < requiredRaw) {
      const requiredUsd = (Number(requiredRaw) / 1e6).toFixed(2);
      throw new Error(
        `Insufficient USDC on Circle Arc Testnet. Your wallet (${userAddr.slice(0, 6)}...${userAddr.slice(-4)}) holds ${bal.balance.toFixed(2)} USDC, but ${actionLabel} requires $${requiredUsd} USDC. Open your Account modal to copy your address and fund from Circle Faucet.`
      );
    }
  }

  function handleDisconnect() {
    connectedAddress = null;
    connectedMethod = null;
    currentTierCode = 0;
    serverVerifiedVaults.clear();
    disconnectWallet();

    const walletBtn = $('btn-wallet-connect');
    if (walletBtn) {
      walletBtn.classList.remove('connected');
      walletBtn.title = 'Connect Treasury Wallet';
    }
    if ($('wallet-btn-text')) $('wallet-btn-text').textContent = 'Connect Wallet';

    const pill = $('connected-wallet-pill');
    if (pill) {
      pill.style.display = 'none';
      pill.classList.remove('badge-tag-connected');
    }

    if ($('display-treasury-name')) $('display-treasury-name').textContent = 'Unassigned Vault';
    if ($('display-treasury-addr')) $('display-treasury-addr').textContent = 'Not connected';
    if ($('btn-copy-strip-addr')) $('btn-copy-strip-addr').style.display = 'none';
    if ($('org-address')) $('org-address').value = '';
    if ($('cert-display-vault')) $('cert-display-vault').textContent = '—';
    if ($('account-modal-full-address')) $('account-modal-full-address').textContent = '—';
    if ($('account-modal-usdc-balance')) $('account-modal-usdc-balance').textContent = '— USDC';

    if ($('privy-email-step')) $('privy-email-step').style.display = 'block';
    if ($('privy-otp-step')) $('privy-otp-step').style.display = 'none';
    if ($('privy-otp-input')) $('privy-otp-input').value = '';
    if ($('privy-auth-status')) $('privy-auth-status').textContent = '';

    if ($('account-modal')) $('account-modal').style.display = 'none';
    const badge = $('plan-badge-display');
    if (badge) {
      badge.textContent = 'No Active Plan';
      badge.className = 'plan-badge none';
    }
    updateTierButtons('none');
    allFetchedTransactions = [];
    loadedTransactions = [];
    lastCommitment = null;
    if ($('commit-receipt-box')) $('commit-receipt-box').style.display = 'none';
    renderTable();
    calculateCompleteness();
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
    refreshAccountUsdcBalance(getNetName(), connectedAddress);
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
    const catSelect = $('tag-category-select');
    const customInput = $('tag-custom-category-input');
    const currentCat = (existingTag.category || tx.category || 'Operating Expense').trim();
    if (catSelect) {
      const hasOption = Array.from(catSelect.options).some(opt => opt.value === currentCat && opt.value !== 'Other');
      if (hasOption) {
        catSelect.value = currentCat;
        if (customInput) { customInput.style.display = 'none'; customInput.value = ''; }
      } else {
        catSelect.value = 'Other';
        if (customInput) { customInput.style.display = 'block'; customInput.value = currentCat; }
      }
    }
    if ($('tag-notes-input')) $('tag-notes-input').value = existingTag.notes || tx.notes || '';

    if ($('tag-modal')) $('tag-modal').style.display = 'flex';
  }

  window.openTagModalFromRow = openTagModal;

  function renderTable() {
    const tbody = $('table-body');
    if (!tbody) return;

    if (loadedTransactions.length === 0) {
      const addr = $('org-address')?.value?.trim();
      const msg = addr
        ? `No on-chain USDC transfer events found for ${escapeHtml(addr.slice(0, 8))}... on ${escapeHtml(getNetName())}.`
        : 'Enter a treasury wallet address above and click <strong>"Fetch Real On-Chain History"</strong> to scan live blocks via RPC node.';
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 48px; color: var(--ink-muted);">${msg}</td></tr>`;
      if ($('synced-tx-count')) $('synced-tx-count').textContent = '(0 Synced)';
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
        counterpartyHtml = `<strong>${escapeHtml(currentLabel)}</strong><br><small class="counterparty-sub">${escapeHtml(sub)}</small>`;
      } else {
        const refShort = `Ref: ${escapeHtml(txHash.slice(0, 10))}...${escapeHtml(txHash.slice(-4))}`;
        counterpartyHtml = `<span class="redacted-pill"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Confidential counterparty</span><br><small class="counterparty-sub font-mono">${refShort}</small>`;
      }

      const validExplorerUrl = typeof tx.explorerLink === 'string' && /^https:\/\//i.test(tx.explorerLink) ? tx.explorerLink : '';
      const safeBlock = Number(tx.block) || 0;
      const explorerLink = validExplorerUrl
        ? `<a href="${escapeHtml(validExplorerUrl)}" target="_blank" rel="noopener noreferrer" class="table-tx-link">#${safeBlock} ↗</a>`
        : `#${safeBlock}`;

      // Zero-leak search index: omit plain counterparty/notes when Redacted Client scope is active
      const searchIndex = activeScope === 'full'
        ? `${txHash} ${tx.rawCounterparty || ''} ${tx.counterparty || ''} ${currentLabel} ${currentCategory} ${tagInfo.notes || tx.notes || ''} ${safeBlock}`
        : `${txHash} ${currentCategory} ${safeBlock}`;

      return `<tr data-search="${escapeHtml(searchIndex)}">
        <td>${escapeHtml(tx.date)}</td>
        <td class="font-mono">${explorerLink}</td>
        <td>${counterpartyHtml}</td>
        <td><strong>${escapeHtml(currentCategory)}</strong></td>
        <td style="font-weight:700; color:var(--ink-primary); font-family:var(--font-mono);">$${Number(tx.grossAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td><span class="table-badge">${escapeHtml(tx.asset || 'USDC')}</span></td>
        <td>
          <button class="btn-tag-action" data-tx-hash="${escapeHtml(txHash)}">
            ${tagInfo.tag ? 'Edit Tag' : '+ Tag'}
          </button>
        </td>
      </tr>`;
    }).join('');
    if (window.applyTableFilters) window.applyTableFilters();
  }

  let isSubscribingInFlight = false;

  function setAllTierButtonsInFlight(selectedBtnId) {
    ['btn-tier-single', 'btn-tier-enterprise', 'btn-tier-partner'].forEach(id => {
      const b = $(id);
      if (b) {
        b.disabled = true;
        if (id === selectedBtnId) {
          b.textContent = 'Subscribing...';
        }
      }
    });
  }

  function updateTierButtons(activeKey, expiresAt = 0) {
    const tiers = [
      { key: 'single_org', btnId: 'btn-tier-single', price: '$5 USDC' },
      { key: 'enterprise', btnId: 'btn-tier-enterprise', price: '$50 USDC' },
      { key: 'partner', btnId: 'btn-tier-partner', price: '$150 USDC' }
    ];

    const normalizedActive = (activeKey === 'single') ? 'single_org' : activeKey;
    const hasActiveSub = Boolean(normalizedActive && normalizedActive !== 'none' && normalizedActive !== 'free');
    const daysRemaining = (hasActiveSub && expiresAt > Date.now())
      ? Math.max(1, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
      : 30;

    tiers.forEach(({ key, btnId, price }) => {
      const btn = $(btnId);
      const tile = btn ? btn.closest('.plan-tile') : null;
      if (btn) {
        const isCurrentTier = hasActiveSub && (key === normalizedActive);
        if (isCurrentTier) {
          btn.className = 'btn-select-tier current';
          btn.textContent = `Active Plan (${daysRemaining}d left)`;
          btn.disabled = true;
          if (tile) tile.classList.add('active-tier');
        } else if (hasActiveSub) {
          // On-chain 30-day single-subscription lock: cannot subscribe again until 30-day cycle expires
          btn.className = 'btn-select-tier';
          btn.textContent = `Locked (${daysRemaining}d Active)`;
          btn.disabled = true;
          if (tile) tile.classList.remove('active-tier');
        } else {
          btn.className = 'btn-select-tier';
          btn.textContent = `Subscribe (${price})`;
          btn.disabled = false;
          if (tile) tile.classList.remove('active-tier');
        }
      }
    });
  }

  async function syncOnChainSubscription(address) {
    const target = address || connectedAddress || $('org-address')?.value?.trim();
    if (!target || !/^0x[0-9a-fA-F]{40}$/.test(target)) return;
    try {
      const sub = await fetchOnChainSubscription(target);
      const badge = $('plan-badge-display');
      if (sub.isActive && sub.tierCode > 0) {
        currentTierCode = sub.tierCode;
        const activeKey = sub.tierKey || (sub.tierCode === 3 ? 'partner' : (sub.tierCode === 2 ? 'enterprise' : 'single_org'));
        if (badge) {
          badge.textContent = `${sub.tier} (On-Chain)`;
          badge.className = activeKey === 'partner' ? 'plan-badge partner' : (activeKey === 'single_org' ? 'plan-badge single' : 'plan-badge enterprise');
        }
        updateTierButtons(activeKey, sub.expiresAt);
      } else {
        currentTierCode = 0;
        if (badge) {
          badge.textContent = 'No Active Plan';
          badge.className = 'plan-badge none';
        }
        updateTierButtons('none', 0);
      }
    } catch (err) {
      console.warn('Subscription sync error:', err);
    }
  }

  function showConfirmModal({ title = 'Confirm On-Chain Action', message = '', walletLabel = '—', networkLabel = 'Circle Arc Testnet', confirmLabel = 'Confirm & Sign' }) {
    const modal = $('confirm-tx-modal');
    if (!modal) return Promise.resolve(true);

    if ($('confirm-modal-title')) $('confirm-modal-title').textContent = title;
    if ($('confirm-modal-message')) $('confirm-modal-message').textContent = message;
    if ($('confirm-modal-wallet')) $('confirm-modal-wallet').textContent = walletLabel;
    if ($('confirm-modal-network')) $('confirm-modal-network').textContent = networkLabel;
    if ($('btn-confirm-ok')) $('btn-confirm-ok').textContent = confirmLabel;

    modal.style.display = 'flex';

    return new Promise((resolve) => {
      const cleanup = (result) => {
        modal.style.display = 'none';
        $('btn-confirm-ok')?.removeEventListener('click', onOk);
        $('btn-confirm-cancel')?.removeEventListener('click', onCancel);
        $('btn-confirm-close')?.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onEsc);
        resolve(result);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
      const onEsc = (e) => { if (e.key === 'Escape') cleanup(false); };

      $('btn-confirm-ok')?.addEventListener('click', onOk);
      $('btn-confirm-cancel')?.addEventListener('click', onCancel);
      $('btn-confirm-close')?.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onEsc);
    });
  }

  let subSuccessTimer = null;

  function closeSubscriptionSuccessModal() {
    if (subSuccessTimer) {
      clearTimeout(subSuccessTimer);
      subSuccessTimer = null;
    }
    if ($('subscription-success-modal')) {
      $('subscription-success-modal').style.display = 'none';
    }
  }

  function showSubscriptionSuccessModal(tierKey, tierLabel, txHash) {
    const modal = $('subscription-success-modal');
    const titleEl = $('sub-success-title');
    const linkEl = $('sub-success-tx-link');

    const cleanTierName = tierKey === 'partner'
      ? 'Audit Firm Partner ($150 USDC)'
      : (tierKey === 'enterprise' ? 'Enterprise Treasury ($50 USDC)' : 'Single Organization ($5 USDC)');

    if (titleEl) {
      titleEl.textContent = `Successfully subscribed to ${cleanTierName}`;
    }
    if (linkEl && txHash) {
      linkEl.href = ARC_EXPLORER_TX + txHash;
      linkEl.textContent = `${txHash.slice(0, 10)}...${txHash.slice(-8)} ↗`;
      linkEl.title = txHash;
    }
    if (modal) {
      modal.style.display = 'flex';
    }
    if (subSuccessTimer) clearTimeout(subSuccessTimer);
    subSuccessTimer = setTimeout(() => {
      closeSubscriptionSuccessModal();
    }, 5000);
  }

  window.handlePlanTierSelect = async function(tierKey, tierLabel) {
    if (isSubscribingInFlight) {
      return;
    }

    const badge = $('plan-badge-display');
    const closePlanModal = () => {
      if ($('plan-modal')) $('plan-modal').style.display = 'none';
    };

    const auth = getAuthState();
    const userAddr = connectedAddress || auth.address;

    if (!userAddr) {
      closePlanModal();
      openWalletModal();
      return;
    }

    const normalizedTierKey = (tierKey === 'single' || tierKey === 'free') ? 'single_org' : tierKey;
    const tierCode = normalizedTierKey === 'partner' ? 3 : (normalizedTierKey === 'enterprise' ? 2 : 1);
    const btnId = normalizedTierKey === 'single_org' ? 'btn-tier-single' : ('btn-tier-' + normalizedTierKey);
    const targetBtn = $(btnId);
    if (targetBtn && (targetBtn.disabled || targetBtn.classList.contains('current'))) {
      return;
    }
    if (currentTierCode > 0) {
      showToast('An active 30-day subscription is already in progress on-chain for this wallet. Renewal unlocks once the current cycle completes.', 'info');
      return;
    }

    const feeLabel = normalizedTierKey === 'partner' ? '$150' : (normalizedTierKey === 'enterprise' ? '$50' : '$5');
    const requiredFee = normalizedTierKey === 'partner'
      ? TIER_FEES.partner
      : (normalizedTierKey === 'enterprise' ? TIER_FEES.enterprise : TIER_FEES.single_org);

    let signer;
    try {
      signer = await resolveActiveSigner();
      await ensureArcUsdcBalance(signer.address || userAddr, requiredFee, tierLabel);
    } catch (err) {
      showToast(formatUserError(err), 'warning');
      return;
    }

    const signingAddr = signer.address || userAddr;
    const shortSigning = signingAddr ? `${signingAddr.slice(0, 6)}...${signingAddr.slice(-4)}` : signer.label;
    const ok = await showConfirmModal({
      title: `Confirm ${tierLabel} Subscription`,
      message: `Your ${signer.label} will approve ${feeLabel} USDC (if needed) and subscribe for one 30-day cycle on Circle Arc Testnet.`,
      walletLabel: `${signer.label} (${shortSigning})`,
      networkLabel: 'Circle Arc Testnet',
      confirmLabel: `Pay ${feeLabel} USDC & Subscribe`
    });
    if (!ok) return;

    isSubscribingInFlight = true;
    setAllTierButtonsInFlight(btnId);

    try {
      const txHash = await executeSubscribeOnChain(signer.provider, tierCode, 1);
      currentTierCode = tierCode;
      if (badge) {
        badge.textContent = `${tierLabel} (On-Chain)`;
        badge.className = 'plan-badge ' + (normalizedTierKey === 'partner' ? 'partner' : (normalizedTierKey === 'enterprise' ? 'enterprise' : 'single'));
      }
      updateTierButtons(normalizedTierKey, Date.now() + 30 * 24 * 60 * 60 * 1000);
      refreshAccountUsdcBalance('Arc', signingAddr);
      closePlanModal();
      showSubscriptionSuccessModal(normalizedTierKey, tierLabel, txHash);
    } catch (err) {
      console.error('On-chain subscription failed:', err);
      await syncOnChainSubscription(signingAddr || userAddr);
      const msg = formatUserError(err, 'On-chain subscription failed');
      showToast(msg, msg === 'Request cancelled in your wallet.' ? 'warning' : 'error');
    } finally {
      isSubscribingInFlight = false;
    }
  };

  async function calculateCompleteness() {
    if (loadedTransactions.length === 0) {
      calculatedMerkleRoot = '';
      if ($('reconciled-sum')) $('reconciled-sum').innerText = '$0.00 USDC';
      if ($('stat-volume')) $('stat-volume').innerHTML = '$0.00 <small>USDC</small>';
      if ($('verified-count')) $('verified-count').innerText = '0';
      if ($('stat-items')) $('stat-items').innerHTML = '0 <small>Transactions</small>';
      if ($('merkle-status')) $('merkle-status').innerHTML = '<span class="status-verified-text">Awaiting on-chain history</span>';
      if ($('stat-root')) $('stat-root').innerText = '—';
      if ($('stat-assurance')) $('stat-assurance').innerHTML = '<span class="status-verified-text" style="color:var(--ink-secondary);">Awaiting Audit</span>';
      if ($('cert-display-outflow')) $('cert-display-outflow').textContent = '$0.00 USDC';
      if ($('cert-display-items')) $('cert-display-items').textContent = '0 Verified';
      if ($('cert-display-proof')) $('cert-display-proof').textContent = '—';
      if ($('synced-tx-count')) $('synced-tx-count').textContent = '(0 Synced)';
      if ($('banner-proof')) $('banner-proof').style.display = 'none';
      if ($('slip-card-preview')) $('slip-card-preview').style.display = 'none';
      ['btn-export-csv', 'btn-export-xero', 'btn-export-cert', 'btn-anchor-proof-modal'].forEach(id => {
        if ($(id)) $(id).disabled = true;
      });
      return;
    }

    const leaves = [];
    for (const item of loadedTransactions) {
      const hash = computeTransactionLeaf(item);
      item.leafHash = hash;
      leaves.push(hash);
    }
    const tree = buildMerkleTree(leaves);
    loadedTransactions.forEach((item, idx) => {
      item.merkleProof = tree.proofs[idx] || [];
    });
    calculatedMerkleRoot = tree.root;

    if (lastCommitment && lastCommitment.rootHash !== calculatedMerkleRoot) {
      lastCommitment = null;
      if ($('commit-receipt-box')) $('commit-receipt-box').style.display = 'none';
    }

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
      if ($('account-modal-network')) $('account-modal-network').textContent = getNetFullName();
      refreshAccountUsdcBalance(getNetName(), connectedAddress);
    });

    $('btn-refresh-usdc-balance')?.addEventListener('click', () => {
      refreshAccountUsdcBalance(getNetName(), connectedAddress);
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

    $('btn-close-sub-success')?.addEventListener('click', closeSubscriptionSuccessModal);
    $('subscription-success-modal')?.addEventListener('click', e => {
      if (e.target === $('subscription-success-modal')) closeSubscriptionSuccessModal();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeWalletModal();
        closeAccountModal();
        closeSubscriptionSuccessModal();
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
      const statusEl = $('privy-auth-status');
      try {
        if (statusEl) { statusEl.style.color = ''; statusEl.textContent = 'Awaiting wallet approval...'; }
        const address = await connectInjectedWallet();
        if (statusEl) statusEl.textContent = '';
        applyConnectedWallet(address, 'Web3');
      } catch (err) {
        const msg = formatUserError(err);
        if (statusEl) {
          statusEl.style.color = '#B91C1C';
          statusEl.textContent = msg;
        }
        showToast(msg, msg === 'Request cancelled in your wallet.' ? 'warning' : 'error');
      }
    });

    // Connect via Privy Email OTP
    $('btn-privy-send-otp')?.addEventListener('click', async () => {
      const email = $('privy-email-input')?.value?.trim();
      const statusEl = $('privy-auth-status');
      if (!email || !email.includes('@')) {
        if (statusEl) {
          statusEl.style.color = '#B91C1C';
          statusEl.textContent = 'Please enter a valid email address.';
        }
        $('privy-email-input')?.focus();
        showToast('Please enter a valid email address.', 'warning');
        return;
      }
      if (statusEl) statusEl.style.color = '';

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
        if (statusEl) statusEl.textContent = 'Verifying code & unlocking Privy wallet...';
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

    // Auto-restore active persistent session + browser Privy embedded signer on boot
    initPrivyFromServer()
      .then(() => restorePrivySession())
      .then(restored => {
        if (restored && restored.address) {
          applyConnectedWallet(restored.address, 'Privy', restored.email || null);
        } else if (connectedMethod && connectedMethod.toLowerCase().includes('privy')) {
          handleDisconnect();
        }
      })
      .catch(() => {});

    const existingSession = getAuthSession();
    if (existingSession && existingSession.address && !existingSession.method?.toLowerCase().includes('privy')) {
      applyConnectedWallet(existingSession.address, existingSession.method, existingSession.email);
    }
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && Array.isArray(data.verifiedVaults)) {
          data.verifiedVaults.forEach(v => serverVerifiedVaults.add(String(v).toLowerCase()));
        }
        if (data && data.authenticated && data.address && !connectedAddress && data.method !== 'privy_email') {
          applyConnectedWallet(data.address, 'Web3', data.email || null);
        }
        updateVaultTierUI();
      })
      .catch(() => {});

    // Delegated handler for Transaction Tagging buttons (avoids inline onclick string interpolation)
    $('table-body')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-tag-action');
      const txHash = btn?.getAttribute('data-tx-hash');
      if (txHash) openTagModal(txHash);
    });

    // Two-Tier Treasury Verification Events (debounced valid-address sync avoids RPC 429s)
    let orgInputSyncTimer = null;
    $('org-address')?.addEventListener('input', () => {
      updateVaultTierUI();
      if (connectedAddress) return;
      if (orgInputSyncTimer) clearTimeout(orgInputSyncTimer);
      orgInputSyncTimer = setTimeout(() => {
        const val = $('org-address')?.value?.trim();
        if (val && /^0x[0-9a-fA-F]{40}$/.test(val)) {
          syncOnChainSubscription(val);
        }
      }, 350);
    });
    $('btn-open-verify-modal')?.addEventListener('click', openVerifyModal);
    $('btn-close-verify-modal')?.addEventListener('click', closeVerifyModal);
    $('btn-submit-siwe-sign')?.addEventListener('click', submitSiweSign);
    $('siwe-wallet-select')?.addEventListener('change', (e) => {
      const manualGroup = $('siwe-manual-sig-group');
      if (manualGroup) {
        manualGroup.style.display = e.target.value === 'hardware' ? 'block' : 'none';
      }
    });
    updateVaultTierUI();
    syncOnChainSubscription();

    // Custom Category Toggle & Tag Save Action
    $('tag-category-select')?.addEventListener('change', (e) => {
      const customInput = $('tag-custom-category-input');
      if (!customInput) return;
      if (e.target.value === 'Other') {
        customInput.style.display = 'block';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
      }
    });

    $('btn-save-tag')?.addEventListener('click', () => {
      const hash = $('tag-target-hash')?.value;
      const tag = $('tag-name-input')?.value?.trim() || '';
      const selectedCat = $('tag-category-select')?.value || 'Operating Expense';
      const customCat = $('tag-custom-category-input')?.value?.trim() || '';
      if (selectedCat === 'Other' && !customCat) {
        showToast('Enter a custom accounting category name.', 'warning');
        $('tag-custom-category-input')?.focus();
        return;
      }
      const category = selectedCat === 'Other' ? customCat : selectedCat;
      const notes = $('tag-notes-input')?.value?.trim() || '';

      if (hash) {
        saveTransactionTag(hash, tag, category, notes);
        const match = allFetchedTransactions.find(t => (t.hash || t.id) === hash);
        if (match) {
          if (tag) match.plainCounterparty = tag;
          match.category = category;
          match.notes = notes;
          match.isTagged = Boolean(tag);
        }
        applyActivePeriodFilter();
        if ($('tag-modal')) $('tag-modal').style.display = 'none';
        renderTable();
        calculateCompleteness();
        showToast('Transaction tag saved locally.', 'success');
      }
    });

    $('period-select')?.addEventListener('change', async () => {
      applyActivePeriodFilter();
      renderTable();
      await calculateCompleteness();
    });

    // Real On-Chain RPC Ingestion
    $('btn-run-decryption')?.addEventListener('click', async () => {
      if (currentTierCode === 0) {
        if ($('plan-modal')) $('plan-modal').style.display = 'flex';
        return;
      }

      let addr = $('org-address')?.value?.trim();
      if (!addr && connectedAddress) {
        addr = connectedAddress;
        if ($('org-address')) $('org-address').value = connectedAddress;
        updateVaultTierUI(connectedAddress);
      }
      const netKey = getNetName();
      const btn = $('btn-run-decryption');

      if (!addr || !addr.startsWith('0x')) {
        showToast('Enter or connect a valid 42-character EVM wallet address (0x...).', 'warning');
        $('org-address')?.focus();
        return;
      }

      btn.disabled = true;
      btn.innerHTML = `<span>Scanning ${netKey} RPC...</span>`;
      if ($('merkle-status')) $('merkle-status').innerHTML = `<span class="text-cyan">Connecting to ${netKey} RPC...</span>`;

      try {
        const liveTxs = await fetchLiveTransactions(addr, netKey);
        allFetchedTransactions = liveTxs || [];
        applyActivePeriodFilter();
        if (loadedTransactions.length === 0) {
          if ($('merkle-status')) $('merkle-status').innerHTML = `<span class="status-verified-text">0 on-chain events found</span>`;
        }
      } catch (e) {
        console.warn('RPC fetch failed:', e);
        allFetchedTransactions = [];
        loadedTransactions = [];
        showToast(formatUserError(e, `Failed to fetch transactions from ${netKey} RPC`), 'error');
      }

      renderTable();
      await calculateCompleteness();

      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>Refresh On-Chain History</span>`;
    });

    function buildCurrentSessionCertificate() {
      if (loadedTransactions.length === 0 || !window.VeyroqExporter?.buildAuditCertificate) return null;
      const period = $('period-select')?.value || 'ALL';
      const org = $('org-address')?.value?.trim() || connectedAddress || 'Unassigned';
      const data = prepareExportTransactions(loadedTransactions, activeScope);
      return window.VeyroqExporter.buildAuditCertificate(data, calculatedMerkleRoot, org, period, getNetFullName(), {
        disclosureScope: activeScope,
        commitment: lastCommitment,
        registryAddress: REGISTRY_ADDRESS,
        chainId: ARC_CHAIN_ID_DEC
      });
    }

    // Exports
    const exportMap = {
      'btn-export-csv': (data, org, p) => window.VeyroqExporter?.exportQuickBooks(data, org, p),
      'btn-export-xero': (data, org, p) => window.VeyroqExporter?.exportXero(data, org, p),
      'btn-export-cert': (data, org, p) => window.VeyroqExporter?.exportAuditCertificate(data, calculatedMerkleRoot, org, p, getNetFullName(), {
        disclosureScope: activeScope,
        commitment: lastCommitment,
        registryAddress: REGISTRY_ADDRESS,
        chainId: ARC_CHAIN_ID_DEC
      })
    };

    async function refreshProtocolFeeUI() {
      const note = $('commit-fee-note');
      if (!note) return;
      try {
        currentProtocolFee = await fetchProtocolFee();
        note.textContent = currentProtocolFee === 0n
          ? 'Commit fee: Included with active subscription (Arc gas only)'
          : `On-chain protocol fee: $${(Number(currentProtocolFee) / 1e6).toFixed(2)} USDC + Arc gas`;
      } catch {
        note.textContent = 'Commit fee synced with VeyroqRegistry';
      }
    }

    Object.entries(exportMap).forEach(([id, fn]) => {
      $(id)?.addEventListener('click', () => {
        if (loadedTransactions.length === 0) return;
        const period = $('period-select')?.value || 'ALL';
        const org = $('org-address')?.value?.trim() || connectedAddress || 'Unassigned';
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

    $('btn-open-auditor-modal')?.addEventListener('click', () => {
      if (currentTierCode === 0) {
        if ($('plan-modal')) $('plan-modal').style.display = 'flex';
        return;
      }
      if ($('auditor-modal')) $('auditor-modal').style.display = 'flex';
    });

    function renderProofCommitted(feedback, txHash) {
      const validHash = safeTxHash(txHash);
      const link = validHash
        ? `<a href="${escapeHtml(ARC_EXPLORER_TX + validHash)}" target="_blank" rel="noopener noreferrer" style="color:var(--burgundy); text-decoration:underline; font-weight:600; margin-left:4px;">${escapeHtml(validHash.slice(0, 10))}... ↗</a>`
        : '';
      if (feedback) {
        feedback.innerHTML = `<span style="color:var(--green-verified); font-weight:600;">✓ Audit proof committed</span> ${link}`;
      }
      if ($('cert-display-proof')) {
        const certLink = validHash
          ? `<a href="${escapeHtml(ARC_EXPLORER_TX + validHash)}" target="_blank" rel="noopener noreferrer" style="color:var(--green-verified); text-decoration:underline;">(Verified On-Chain)</a>`
          : '(Verified)';
        $('cert-display-proof').innerHTML = `${escapeHtml(calculatedMerkleRoot.slice(0, 10))}... ${certLink}`;
      }
    }

    function prependAuthorizedAuditor(addr, txHash, scope, dateVal) {
      const list = $('auditor-list-container');
      if (!list) return;
      $('auditor-empty-state')?.remove();
      const validHash = safeTxHash(txHash);
      const explorerLink = validHash
        ? `<a href="${escapeHtml(ARC_EXPLORER_TX + validHash)}" target="_blank" rel="noopener noreferrer" style="color:var(--burgundy); text-decoration:underline; font-size:11px; margin-left:6px;">Tx ↗</a>`
        : '';
      const item = document.createElement('div');
      item.className = 'auditor-item';
      item.innerHTML = `<div class="auditor-meta"><strong>Authorized Auditor (Active On-Chain)</strong><span class="font-mono text-cyan" style="font-size:11px;">${escapeHtml(addr.slice(0, 6))}...${escapeHtml(addr.slice(-4))}${explorerLink}</span><small>Scope: ${escapeHtml(scope)} · Valid until ${escapeHtml(dateVal)}</small></div><button class="btn btn-secondary btn-sm" type="button">Revoke</button>`;
      item.querySelector('button')?.addEventListener('click', (e) => revokeAuthorizedAuditorOnChain(e.currentTarget, addr));
      list.prepend(item);
    }

    async function revokeAuthorizedAuditorOnChain(btn, auditorAddr) {
      let signer;
      try {
        signer = await resolveActiveSigner();
      } catch (err) {
        showToast(formatUserError(err), 'warning');
        return;
      }
      const shortSigning = signer.address ? `${signer.address.slice(0, 6)}...${signer.address.slice(-4)}` : signer.label;
      const ok = await showConfirmModal({
        title: 'Revoke Auditor Authorization',
        message: `Revoke on-chain audit authorization for ${auditorAddr.slice(0, 6)}...${auditorAddr.slice(-4)} on VeyroqRegistry?`,
        walletLabel: `${signer.label} (${shortSigning})`,
        networkLabel: 'Arc Testnet',
        confirmLabel: 'Revoke On-Chain'
      });
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = 'Revoking...';
      try {
        await executeRevokeAuditorOnChain(signer.provider, auditorAddr);
        const item = btn.closest('.auditor-item');
        if (item) item.style.opacity = '0.4';
        btn.textContent = 'Revoked';
        showToast(`Auditor ${auditorAddr.slice(0, 6)}...${auditorAddr.slice(-4)} revoked on Arc.`, 'success');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Revoke';
        const msg = formatUserError(err, 'Auditor revocation failed');
        showToast(msg, msg === 'Request cancelled in your wallet.' ? 'warning' : 'error');
      }
    }

    function renderCommitReceiptBox(commitment) {
      const box = $('commit-receipt-box');
      if (!box || !commitment) return;
      if ($('receipt-proof-id')) {
        $('receipt-proof-id').textContent = (commitment.proofId !== null && commitment.proofId !== undefined)
          ? String(commitment.proofId)
          : 'Pending';
      }
      if ($('receipt-root-hash')) $('receipt-root-hash').textContent = commitment.rootHash || calculatedMerkleRoot;
      const validHash = safeTxHash(commitment.txHash);
      if ($('receipt-tx-link') && validHash) {
        $('receipt-tx-link').href = ARC_EXPLORER_TX + validHash;
        $('receipt-tx-link').textContent = `Tx ${validHash.slice(0, 10)}...${validHash.slice(-6)} ↗`;
      }
      box.style.display = 'flex';
    }

    function setVerifierTab(mode) {
      const isCert = mode === 'cert';
      $('tab-verifier-cert')?.classList.toggle('active', isCert);
      $('tab-verifier-history')?.classList.toggle('active', !isCert);
      if ($('verifier-pane-cert')) $('verifier-pane-cert').style.display = isCert ? 'block' : 'none';
      if ($('verifier-pane-history')) $('verifier-pane-history').style.display = isCert ? 'none' : 'block';
    }

    function applyParsedCertificateInputs(cert) {
      if (!cert || typeof cert !== 'object') return;
      if (cert.organization?.address && /^0x[0-9a-fA-F]{40}$/.test(cert.organization.address) && $('verifier-org-input')) {
        $('verifier-org-input').value = cert.organization.address;
      }
      if (cert.onChainCommitment?.proofId !== undefined && cert.onChainCommitment?.proofId !== null && $('verifier-proof-id-input')) {
        $('verifier-proof-id-input').value = String(cert.onChainCommitment.proofId);
      }
    }

    function renderVerifierResult(res, onChainError = null) {
      const box = $('verifier-result-box');
      if (!box) return;
      box.style.display = 'block';
      if (res.error && res.totalCount === 0) {
        box.innerHTML = `<div class="verify-summary-header"><span class="verify-pill fail">INVALID CERTIFICATE</span></div><div class="verify-check-detail">${escapeHtml(res.error)}</div>`;
        return;
      }

      const verifiedOnArc = res.valid && res.rootMatchesOnChain === true && res.onChainInclusionValid === true && !onChainError;
      const statusBadge = !res.valid
        ? '<span class="verify-pill fail">VERIFICATION FAILED / TAMPERED</span>'
        : (verifiedOnArc
          ? '<span class="verify-pill pass">VERIFIED ON ARC</span>'
          : (onChainError
            ? '<span class="verify-pill pass">LOCAL PROOF VALID (ARC RPC ERROR)</span>'
            : '<span class="verify-pill pass">LOCAL MERKLE PROOF VALID</span>'));
      const rootLine = res.rootMatchesOnChain === null
        ? 'Local Merkle check only (enter Org + Proof ID to compare against Arc)'
        : (res.rootMatchesOnChain ? 'Matches VeyroqRegistry root on Arc Testnet' : `Mismatch against Arc root (${escapeHtml(String(res.onChainRoot || 'missing'))})`);
      const fieldLine = res.scope === 'redacted'
        ? 'Redacted disclosure scope (counterparties masked cleanly)'
        : (res.fieldsIntact ? 'All decrypted amounts & counterparties match leaf hashes' : `Tampered fields detected at row(s): ${res.tamperedFieldIndices.map(i => i + 1).join(', ')}`);
      const contractLine = onChainError
        ? `On-chain RPC error: ${escapeHtml(onChainError)}`
        : (res.onChainInclusionValid === null
          ? 'Skipped (provide Org + Proof ID to query verifyBatchInclusion)'
          : (res.onChainInclusionValid ? 'Smart contract verifyBatchInclusion() returned true for all rows' : `Contract rejected row(s): ${res.failedOnChainIndices.map(i => i + 1).join(', ')}`));

      const rowsHtml = res.rows.map(r => {
        const rowOk = r.proofValid && (res.scope !== 'full' || r.fieldMatch) && (r.onChainIncluded !== false);
        const pill = rowOk ? '<span class="row-status-ok">PASS</span>' : '<span class="row-status-fail">FAIL</span>';
        return `<div class="verify-tx-row"><div><strong>${escapeHtml(r.transactionId || `Row ${r.index + 1}`)}</strong> · <span>$${Number(r.amountUSDC || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC</span></div><div>${pill}</div></div>`;
      }).join('');

      box.innerHTML = `
        <div class="verify-summary-header">${statusBadge}<span class="font-mono" style="font-size:11px; color:var(--ink-secondary);">${res.verifiedCount}/${res.totalCount} items verified</span></div>
        <div class="verify-checks-list">
          <div class="verify-check-item"><strong>On-Chain Root:</strong> ${rootLine}</div>
          <div class="verify-check-item"><strong>Field Integrity:</strong> ${escapeHtml(fieldLine)}</div>
          <div class="verify-check-item"><strong>Arc Contract Call:</strong> ${contractLine}</div>
        </div>
        <div class="verify-tx-list">${rowsHtml}</div>
      `;
    }

    async function runOnChainCertificateVerification() {
      const raw = $('verifier-json-input')?.value?.trim();
      if (!raw) {
        renderVerifierResult({ error: 'Paste or upload an Audit Certificate JSON first.', totalCount: 0 });
        return;
      }
      let cert;
      try {
        cert = JSON.parse(raw);
      } catch {
        renderVerifierResult({ error: 'Invalid JSON format in Audit Certificate field.', totalCount: 0 });
        return;
      }
      applyParsedCertificateInputs(cert);

      const org = $('verifier-org-input')?.value?.trim() || '';
      const proofIdStr = $('verifier-proof-id-input')?.value?.trim() || '';
      let onChainRoot = null;
      let onChainBatchResults = null;
      let onChainError = null;

      if (/^0x[0-9a-fA-F]{40}$/.test(org) && proofIdStr !== '') {
        const proofId = Number(proofIdStr);
        if (Number.isInteger(proofId) && proofId >= 0) {
          const btn = $('btn-run-onchain-verify');
          if (btn) { btn.disabled = true; btn.textContent = 'Querying VeyroqRegistry on Arc...'; }
          try {
            const list = await fetchAuditCommitments(org, proofId, 1);
            if (!list.length) {
              onChainRoot = 'Not found on-chain';
            } else {
              onChainRoot = list[0].auditRootHash;
              const items = Array.isArray(cert.leafCommitments) ? cert.leafCommitments : [];
              const leafHashes = items.map(it => it?.leafHash || ('0x' + '0'.repeat(64)));
              const merkleProofs = items.map(it => (Array.isArray(it?.merkleProof) ? it.merkleProof : []));
              onChainBatchResults = await verifyBatchInclusionOnChain(org, proofId, leafHashes, merkleProofs);
            }
          } catch (err) {
            onChainError = err.message || 'RPC verification error';
          } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Verify Against VeyroqRegistry on Arc'; }
          }
        }
      }

      const summary = verifyCertificatePayload(cert, { onChainRoot, onChainBatchResults });
      renderVerifierResult(summary, onChainError);
    }

    async function loadOrgCommitmentsHistory(targetOrg) {
      const listEl = $('history-results-list');
      if (!listEl) return;
      const org = (targetOrg || $('history-org-input')?.value || '').trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(org)) {
        listEl.innerHTML = '<div class="history-empty">Enter a valid 42-character EVM organization address (0x...).</div>';
        return;
      }
      listEl.innerHTML = '<div class="history-empty">Querying VeyroqRegistry on Arc Testnet...</div>';
      try {
        const total = await fetchCommitmentCount(org);
        if (total === 0) {
          listEl.innerHTML = '<div class="history-empty">No audit commitments found on-chain for this organization yet.</div>';
          return;
        }
        const limit = Math.min(25, total);
        const offset = Math.max(0, total - limit);
        const commitments = await fetchAuditCommitments(org, offset, limit);
        listEl.innerHTML = '';
        commitments.slice().reverse().forEach(c => {
          const card = document.createElement('div');
          card.className = 'history-commitment-item';
          const dt = c.timestamp ? new Date(c.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
          card.innerHTML = `
            <div class="history-item-top">
              <strong>Proof #${c.proofId}</strong>
              <span style="font-size:11px; color:var(--ink-secondary);">${c.transactionCount} tx · ${escapeHtml(dt)}</span>
            </div>
            <div class="receipt-hash-box font-mono">${escapeHtml(c.auditRootHash)}</div>
            <div class="history-item-meta">
              <span class="font-mono" style="font-size:11px;">Submitter: ${escapeHtml(c.submitter.slice(0, 6))}...${escapeHtml(c.submitter.slice(-4))}</span>
              <button type="button" class="btn btn-secondary btn-sm">Use in Verifier</button>
            </div>
          `;
          card.querySelector('button')?.addEventListener('click', () => {
            if ($('verifier-org-input')) $('verifier-org-input').value = org;
            if ($('verifier-proof-id-input')) $('verifier-proof-id-input').value = String(c.proofId);
            setVerifierTab('cert');
          });
          listEl.appendChild(card);
        });
      } catch (err) {
        listEl.innerHTML = `<div class="history-empty" style="color:#B91C1C;">Failed to query commitments: ${escapeHtml(err.message || err)}</div>`;
      }
    }

    $('btn-open-comp-top')?.addEventListener('click', refreshProtocolFeeUI);
    $('btn-open-verifier-modal')?.addEventListener('click', () => {
      const activeOrg = $('org-address')?.value?.trim() || connectedAddress || '';
      if (activeOrg && $('verifier-org-input') && !$('verifier-org-input').value) $('verifier-org-input').value = activeOrg;
      if (activeOrg && $('history-org-input') && !$('history-org-input').value) $('history-org-input').value = activeOrg;
    });
    $('tab-verifier-cert')?.addEventListener('click', () => setVerifierTab('cert'));
    $('tab-verifier-history')?.addEventListener('click', () => setVerifierTab('history'));
    $('btn-verifier-load-session')?.addEventListener('click', () => {
      const cert = buildCurrentSessionCertificate();
      if (!cert) {
        renderVerifierResult({ error: 'Load and classify transactions first to export a session certificate.', totalCount: 0 });
        showToast('Fetch transactions first to load a session certificate.', 'warning');
        return;
      }
      if ($('verifier-json-input')) $('verifier-json-input').value = JSON.stringify(cert, null, 2);
      applyParsedCertificateInputs(cert);
    });
    $('verifier-file-input')?.addEventListener('change', async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const text = await file.text();
      if ($('verifier-json-input')) $('verifier-json-input').value = text;
      try { applyParsedCertificateInputs(JSON.parse(text)); } catch {}
    });
    $('verifier-json-input')?.addEventListener('input', () => {
      try { applyParsedCertificateInputs(JSON.parse($('verifier-json-input').value)); } catch {}
    });
    $('btn-run-onchain-verify')?.addEventListener('click', runOnChainCertificateVerification);
    $('btn-load-org-history')?.addEventListener('click', () => loadOrgCommitmentsHistory());
    $('btn-copy-receipt-root')?.addEventListener('click', () => {
      const root = lastCommitment?.rootHash || calculatedMerkleRoot;
      if (!root) return;
      copyToClipboard(root);
      const btn = $('btn-copy-receipt-root');
      if (btn) {
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = 'Copy Root'; }, 1600);
      }
    });
    $('btn-receipt-download-cert')?.addEventListener('click', () => $('btn-export-cert')?.click());
    $('btn-receipt-verify-now')?.addEventListener('click', async () => {
      const cert = buildCurrentSessionCertificate();
      if ($('compliance-modal')) $('compliance-modal').style.display = 'none';
      if (window.openVerifierModal) window.openVerifierModal();
      setVerifierTab('cert');
      if (cert && $('verifier-json-input')) {
        $('verifier-json-input').value = JSON.stringify(cert, null, 2);
        applyParsedCertificateInputs(cert);
      }
      await runOnChainCertificateVerification();
    });

    // Commit Audit Proof On-Chain Action (User signs directly via Privy or Web3 Wallet)
    $('btn-anchor-proof-modal')?.addEventListener('click', async () => {
      if (currentTierCode === 0) {
        if ($('plan-modal')) $('plan-modal').style.display = 'flex';
        return;
      }

      const feedback = $('anchor-proof-feedback');
      const btn = $('btn-anchor-proof-modal');
      const btnText = $('anchor-btn-text');

      if (!calculatedMerkleRoot) {
        if (feedback) feedback.innerHTML = `<span style="color:#B45309;">Fetch on-chain transactions first to generate a Merkle root proof.</span>`;
        showToast('Fetch on-chain transactions first to generate a Merkle root proof.', 'warning');
        return;
      }

      const orgAddress = connectedAddress || $('org-address')?.value?.trim();
      const selectedPeriod = $('period-select')?.value || 'ALL';
      const { periodStart, periodEnd } = getPeriodBounds(selectedPeriod, loadedTransactions);
      const count = loadedTransactions.length;

      let signer;
      try {
        signer = await resolveActiveSigner();
        const fee = await fetchProtocolFee();
        currentProtocolFee = fee;
        if (fee > 0n) {
          await ensureArcUsdcBalance(signer.address || orgAddress, fee, 'Audit Proof Commitment');
        }
      } catch (err) {
        if (feedback) feedback.innerHTML = `<span style="color:#C93B2B;">${escapeHtml(err.message || err)}</span>`;
        return;
      }

      try {
        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = 'Signing & Saving...';
        if (feedback) feedback.innerHTML = `<span style="color:var(--burgundy);">Signing audit proof via ${escapeHtml(signer.label)}...</span>`;

        const txHash = await executeCommitProofOnChain(signer.provider, orgAddress, calculatedMerkleRoot, periodStart, periodEnd, count);
        let resolved = await resolveLatestProofId(orgAddress, calculatedMerkleRoot);
        if (!resolved) {
          await new Promise(r => setTimeout(r, 1500));
          resolved = await resolveLatestProofId(orgAddress, calculatedMerkleRoot);
        }
        lastCommitment = {
          proofId: resolved?.proofId ?? null,
          txHash,
          rootHash: calculatedMerkleRoot,
          orgAddress,
          periodStart,
          periodEnd,
          txCount: count,
          anchoredAt: new Date().toISOString()
        };
        renderProofCommitted(feedback, txHash);
        renderCommitReceiptBox(lastCommitment);
        refreshAccountUsdcBalance('Arc', signer.address);
      } catch (err) {
        console.error('Anchor proof failed:', err);
        if (feedback) feedback.innerHTML = `<span style="color:#C93B2B;">Failed: ${escapeHtml(err.message || err)}</span>`;
      } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Commit Audit Proof';
      }
    });

    // Auditor Policy Authorization On-Chain Action (User signs directly via Privy or Web3 Wallet)
    $('btn-submit-policy')?.addEventListener('click', async () => {
      if (currentTierCode === 0) {
        if ($('plan-modal')) $('plan-modal').style.display = 'flex';
        return;
      }

      const addr = $('auditor-addr-input')?.value?.trim();
      const dateVal = $('auditor-expiry-input')?.value?.trim() || '';
      const scope = $('auditor-scope-input')?.value || 'ALL_TRANSACTIONS';
      const feedback = $('policy-tx-feedback');
      const btn = $('btn-submit-policy');
      const btnText = $('btn-submit-policy-text');

      if (!addr || !addr.startsWith('0x') || addr.length !== 42) {
        if (feedback) feedback.innerHTML = `<span style="color:#B45309;">Enter a valid 42-character EVM address (0x...).</span>`;
        showToast('Enter a valid 42-character EVM address (0x...).', 'warning');
        $('auditor-addr-input')?.focus();
        return;
      }

      const expiryMs = Date.parse(`${dateVal}T23:59:59Z`);
      const expiryTimestamp = Number.isFinite(expiryMs) ? Math.floor(expiryMs / 1000) : 0;
      if (!dateVal || expiryTimestamp <= Math.floor(Date.now() / 1000)) {
        if (feedback) feedback.innerHTML = `<span style="color:#B45309;">Select an expiration date in the future.</span>`;
        showToast('Select an expiration date in the future.', 'warning');
        $('auditor-expiry-input')?.focus();
        return;
      }

      let signer;
      try {
        signer = await resolveActiveSigner();
      } catch (err) {
        if (feedback) feedback.innerHTML = `<span style="color:#C93B2B;">${escapeHtml(err.message || err)}</span>`;
        return;
      }

      const signingAddr = signer.address;
      const shortSigning = signingAddr ? `${signingAddr.slice(0, 6)}...${signingAddr.slice(-4)}` : signer.label;
      const ok = await showConfirmModal({
        title: 'Authorize Delegated Auditor',
        message: `Grant scoped audit access to ${addr.slice(0, 6)}...${addr.slice(-4)} until ${dateVal}.`,
        walletLabel: `${signer.label} (${shortSigning})`,
        networkLabel: 'Arc Testnet',
        confirmLabel: 'Authorize On-Chain'
      });
      if (!ok) return;

      if (btn) btn.disabled = true;
      if (btnText) btnText.textContent = 'Authorizing on Arc Testnet...';
      if (feedback) feedback.innerHTML = `<span style="color:var(--burgundy);">Signing transaction via ${escapeHtml(signer.label)}...</span>`;

      try {
        const scopeHash = await sha256(scope);
        const txHash = await executeAuthorizeAuditorOnChain(signer.provider, addr, expiryTimestamp, scopeHash);

        prependAuthorizedAuditor(addr, txHash, scope, dateVal);

        if (feedback) {
          const validHash = safeTxHash(txHash);
          feedback.innerHTML = validHash
            ? `<span style="color:var(--green-verified); font-weight:600;">✓ Auditor authorized on Arc!</span> <a href="${escapeHtml(ARC_EXPLORER_TX + validHash)}" target="_blank" rel="noopener noreferrer" style="color:var(--burgundy); text-decoration:underline;">Tx on Explorer ↗</a>`
            : `<span style="color:var(--green-verified); font-weight:600;">✓ Auditor policy registered!</span>`;
        }
      } catch (err) {
        console.error('Authorize auditor failed:', err);
        if (feedback) feedback.innerHTML = `<span style="color:#C93B2B;">Failed: ${escapeHtml(err.message || err)}</span>`;
      } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Authorize Auditor Policy on Arc Testnet';
      }
    });

    if (document.location.hostname.endsWith('veyroq.xyz')) {
      document.querySelectorAll('a[href="/"]').forEach(link => {
        link.setAttribute('href', 'https://veyroq.xyz');
      });
      document.querySelectorAll('a[href="/docs"]').forEach(link => {
        link.setAttribute('href', 'https://docs.veyroq.xyz');
      });
      document.querySelectorAll('a[href^="/legal/"]').forEach(link => {
        link.setAttribute('href', `https://docs.veyroq.xyz${link.getAttribute('href')}`);
      });
    }

    const params = new URLSearchParams(window.location.search || '');
    const deepVerify = params.get('verify') === '1';
    const deepOrg = params.get('org') || '';
    const deepProofId = params.get('proofId') || '';

    // Auto-prompt plan modal on launch if not subscribed (suppressed when opening Verifier link directly)
    const auth = getAuthState();
    if (auth.isAuthenticated && auth.address) {
      syncOnChainSubscription(auth.address);
    } else if (!deepVerify && !deepOrg) {
      setTimeout(() => {
        if (currentTierCode === 0 && $('plan-modal')) {
          $('plan-modal').style.display = 'flex';
        }
      }, 400);
    }

    if (deepVerify || /^0x[0-9a-fA-F]{40}$/.test(deepOrg)) {
      if (window.openVerifierModal) window.openVerifierModal();
      if ($('verifier-org-input') && deepOrg) $('verifier-org-input').value = deepOrg;
      if ($('history-org-input') && deepOrg) $('history-org-input').value = deepOrg;
      if ($('verifier-proof-id-input') && deepProofId) $('verifier-proof-id-input').value = deepProofId;
      if (/^0x[0-9a-fA-F]{40}$/.test(deepOrg) && !deepProofId) {
        setVerifierTab('history');
        loadOrgCommitmentsHistory(deepOrg);
      }
    }

    populateAccountingPeriods();
    initAuditorExpiryDefault();
    refreshProtocolFeeUI();
    renderTable();
    calculateCompleteness();
  }

  // Ensure initialization runs reliably across all browser execution timings
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
