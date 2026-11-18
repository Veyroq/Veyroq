// Veyroq Live Contract Client for Circle Arc Testnet
// Interacts with deployed VeyroqRegistry (0x8A1D55E8E07fa49edF4c0a420b8B033ad03B37B3)
// and official Circle Arc Testnet USDC (0x3600000000000000000000000000000000000000).

export const REGISTRY_ADDRESS = '0x8A1D55E8E07fa49edF4c0a420b8B033ad03B37B3';
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
export const ARC_CHAIN_ID_DEC = 5042002;
export const ARC_CHAIN_ID_HEX = '0x4cef52';
export const ARC_RPC_URL = 'https://rpc.testnet.arc.io';
export const ARC_EXPLORER_TX = 'https://explorer.testnet.arc.io/tx/';

export const TIER_FEES = {
  free: 0n,
  single_org: 5_000_000n,  // $5 USDC (6 decimals)
  enterprise: 50_000_000n, // $50 USDC (6 decimals)
  partner: 150_000_000n    // $150 USDC (6 decimals)
};

export const PROTOCOL_FEE = 5_000_000n; // $5 USDC (6 decimals)

// Selectors
export const SELECTORS = {
  getSubscription: '0x0cbebc24',
  subscribe: '0x3a04bc0c',
  commitAuditProof: '0x6cdc2c15',
  authorizeAuditor: '0x6f5ca4d2',
  approve: '0x095ea7b3',
  allowance: '0xdd62ed3e'
};

// ABI Encoding Helpers
export function padAddress(addr) {
  if (!addr) return '0'.repeat(64);
  const clean = addr.toLowerCase().replace(/^0x/, '');
  return clean.padStart(64, '0');
}

export function padUint256(num) {
  const bn = BigInt(num || 0);
  return bn.toString(16).padStart(64, '0');
}

export function padBytes32(hex) {
  if (!hex) return '0'.repeat(64);
  const clean = hex.replace(/^0x/, '');
  return clean.padEnd(64, '0').slice(0, 64);
}

// Low-level JSON-RPC caller
export async function arcRpcCall(method, params = []) {
  const res = await fetch(ARC_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Arc RPC Error');
  return data.result;
}

// Wait for on-chain transaction receipt before dependent contract calls
export async function waitForTxReceipt(txHash, timeoutMs = 45000) {
  if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await arcRpcCall('eth_getTransactionReceipt', [txHash]);
      if (receipt) {
        if (receipt.status === '0x0') {
          throw new Error(`Transaction reverted on-chain (${txHash.slice(0, 10)}...)`);
        }
        return receipt;
      }
    } catch (err) {
      if (err.message?.includes('reverted')) throw err;
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  return null;
}

// Network Switcher
export async function ensureArcNetwork(provider) {
  if (!provider || !provider.request) return false;
  const currentChain = await provider.request({ method: 'eth_chainId' });
  if (currentChain === ARC_CHAIN_ID_HEX) return true;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_CHAIN_ID_HEX }]
    });
    return true;
  } catch (switchError) {
    // 4902 means the chain has not been added to MetaMask
    if (switchError.code === 4902 || switchError.message?.includes('Unrecognized chain')) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: ARC_CHAIN_ID_HEX,
          chainName: 'Circle Arc Testnet',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
          rpcUrls: [ARC_RPC_URL],
          blockExplorerUrls: ['https://explorer.testnet.arc.io']
        }]
      });
      return true;
    }
    throw switchError;
  }
}

// Read On-Chain Subscription directly from VeyroqRegistry smart contract
export async function fetchOnChainSubscription(orgAddress) {
  if (!orgAddress || !orgAddress.startsWith('0x')) {
    return { tier: 'Free', tierKey: 'free', tierCode: 0, expiresAt: 0, isActive: false };
  }

  // 1. Query Arc Testnet RPC getSubscription(address) on VeyroqRegistry (Single Source of Truth)
  try {
    const data = SELECTORS.getSubscription + padAddress(orgAddress);
    const result = await arcRpcCall('eth_call', [{ to: REGISTRY_ADDRESS, data }, 'latest']);
    if (result && result !== '0x') {
      const clean = result.replace(/^0x/, '');
      const tierCode = parseInt(clean.slice(0, 64), 16) || 0;
      const expiresAt = parseInt(clean.slice(64, 128), 16) || 0;
      const isActive = parseInt(clean.slice(128, 192), 16) === 1 && tierCode > 0;

      if (isActive) {
        const tierName = tierCode === 3
          ? 'Audit Firm Partner'
          : (tierCode === 2 ? 'Enterprise Treasury' : 'Single Org ($5 USDC)');
        const tierKey = tierCode === 3
          ? 'partner'
          : (tierCode === 2 ? 'enterprise' : 'single_org');
        return {
          tier: tierName,
          tierKey,
          tierCode,
          expiresAt: expiresAt * 1000,
          isActive: true
        };
      }
      return { tier: 'Free', tierKey: 'free', tierCode: 0, expiresAt: expiresAt * 1000, isActive: false };
    }
  } catch (err) {
    console.warn('Failed to fetch on-chain subscription:', err);
  }

  return { tier: 'Free', tierKey: 'free', tierCode: 0, expiresAt: 0, isActive: false };
}

// On-Chain Subscription Execution (Approve + Subscribe for 1 single 30-day cycle)
export async function executeSubscribeOnChain(provider, tierCode, months = 1) {
  await ensureArcNetwork(provider);
  const accounts = await provider.request({ method: 'eth_accounts' });
  const user = accounts[0];
  if (!user) throw new Error('No connected wallet account found.');

  // Pre-flight check against on-chain VeyroqRegistry 30-day lock
  const currentSub = await fetchOnChainSubscription(user);
  if (currentSub && currentSub.isActive && currentSub.expiresAt > Date.now()) {
    const expiryDate = new Date(currentSub.expiresAt).toISOString().split('T')[0];
    throw new Error(`Active 30-day subscription (${currentSub.tier}) already in progress on-chain until ${expiryDate}. Renewal unlocks after your 30-day period expires.`);
  }

  const monthlyFee = tierCode === 3
    ? TIER_FEES.partner
    : (tierCode === 2 ? TIER_FEES.enterprise : TIER_FEES.single_org);
  const totalFee = monthlyFee * 1n;

  // 1. Check USDC allowance
  const allowanceData = SELECTORS.allowance + padAddress(user) + padAddress(REGISTRY_ADDRESS);
  const currentAllowanceHex = await arcRpcCall('eth_call', [{ to: USDC_ADDRESS, data: allowanceData }, 'latest']);
  const currentAllowance = BigInt(currentAllowanceHex || '0');

  // 2. Approve if necessary and wait for mining before calling subscribe()
  if (currentAllowance < totalFee) {
    const approveData = SELECTORS.approve + padAddress(REGISTRY_ADDRESS) + padUint256(totalFee);
    const approveTx = await provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: user,
        to: USDC_ADDRESS,
        data: approveData,
        value: '0x0'
      }]
    });
    await waitForTxReceipt(approveTx);
  }

  // 3. Call subscribe(tierCode, 1) — 30-day single cycle enforced by VeyroqRegistry
  const subscribeData = SELECTORS.subscribe + padUint256(tierCode) + padUint256(1);
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: user,
      to: REGISTRY_ADDRESS,
      data: subscribeData,
      value: '0x0'
    }]
  });
  await waitForTxReceipt(txHash);

  return txHash;
}

// On-Chain Merkle Proof Anchoring (Approve 5 USDC fee + commitAuditProof)
export async function executeCommitProofOnChain(provider, orgAddress, auditRootHash, periodStart, periodEnd, txCount) {
  await ensureArcNetwork(provider);
  const accounts = await provider.request({ method: 'eth_accounts' });
  const user = accounts[0];
  if (!user) throw new Error('No connected wallet account found.');

  // 1. Check & approve 5 USDC protocol fee
  const allowanceData = SELECTORS.allowance + padAddress(user) + padAddress(REGISTRY_ADDRESS);
  const currentAllowanceHex = await arcRpcCall('eth_call', [{ to: USDC_ADDRESS, data: allowanceData }, 'latest']);
  const currentAllowance = BigInt(currentAllowanceHex || '0');

  if (currentAllowance < PROTOCOL_FEE) {
    const approveData = SELECTORS.approve + padAddress(REGISTRY_ADDRESS) + padUint256(PROTOCOL_FEE);
    const approveTx = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: user, to: USDC_ADDRESS, data: approveData, value: '0x0' }]
    });
    await waitForTxReceipt(approveTx);
  }

  // 2. Call commitAuditProof(orgAddress, auditRootHash, periodStart, periodEnd, txCount, metadataHash)
  const metaHash = '0x' + '0'.repeat(64);
  const commitData = SELECTORS.commitAuditProof +
    padAddress(orgAddress) +
    padBytes32(auditRootHash) +
    padUint256(periodStart) +
    padUint256(periodEnd) +
    padUint256(txCount) +
    padBytes32(metaHash);

  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: user,
      to: REGISTRY_ADDRESS,
      data: commitData,
      value: '0x0'
    }]
  });
  await waitForTxReceipt(txHash);

  return txHash;
}

// On-Chain Auditor Delegation Policy
export async function executeAuthorizeAuditorOnChain(provider, auditorAddress, validUntilTimestamp, scopeHashHex = null) {
  await ensureArcNetwork(provider);
  const accounts = await provider.request({ method: 'eth_accounts' });
  const user = accounts[0];
  if (!user) throw new Error('No connected wallet account found.');

  const scope = scopeHashHex || ('0x' + '0'.repeat(64));
  const authData = SELECTORS.authorizeAuditor +
    padAddress(auditorAddress) +
    padUint256(validUntilTimestamp) +
    padBytes32(scope);

  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: user,
      to: REGISTRY_ADDRESS,
      data: authData,
      value: '0x0'
    }]
  });
  await waitForTxReceipt(txHash);

  return txHash;
}

