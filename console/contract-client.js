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

export const PROTOCOL_FEE = 0n; // Default fallback; live fee is read dynamically from protocolFee()

// Selectors
export const SELECTORS = {
  getSubscription: '0x0cbebc24',
  subscribe: '0x3a04bc0c',
  commitAuditProof: '0x6cdc2c15',
  authorizeAuditor: '0x6f5ca4d2',
  revokeAuditor: '0xb402980b',
  approve: '0x095ea7b3',
  allowance: '0xdd62ed3e',
  protocolFee: '0xb0e21e8a',
  getCommitmentCount: '0xb536148f',
  getAuditCommitments: '0x583a5fa3',
  verifyTransactionInclusion: '0xe5ee75a7',
  verifyBatchInclusion: '0x30c6a97f'
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

export function encodeVerifyTransactionInclusion(orgAddress, proofId, leafHash, merkleProof = []) {
  const proof = Array.isArray(merkleProof) ? merkleProof : [];
  return SELECTORS.verifyTransactionInclusion +
    padAddress(orgAddress) +
    padUint256(proofId) +
    padBytes32(leafHash) +
    padUint256(128) +
    padUint256(proof.length) +
    proof.map(padBytes32).join('');
}

export function encodeVerifyBatchInclusion(orgAddress, proofId, leafHashes = [], merkleProofs = []) {
  const leaves = Array.isArray(leafHashes) ? leafHashes : [];
  const proofs = Array.isArray(merkleProofs) ? merkleProofs : [];
  const offsetLeafHashes = 128;
  const offsetMerkleProofs = 128 + 32 * (1 + leaves.length);

  let relOffset = 32 * proofs.length;
  const proofOffsets = [];
  const proofBodies = [];
  for (const p of proofs) {
    const arr = Array.isArray(p) ? p : [];
    proofOffsets.push(padUint256(relOffset));
    proofBodies.push(padUint256(arr.length) + arr.map(padBytes32).join(''));
    relOffset += 32 * (1 + arr.length);
  }

  return SELECTORS.verifyBatchInclusion +
    padAddress(orgAddress) +
    padUint256(proofId) +
    padUint256(offsetLeafHashes) +
    padUint256(offsetMerkleProofs) +
    padUint256(leaves.length) +
    leaves.map(padBytes32).join('') +
    padUint256(proofs.length) +
    proofOffsets.join('') +
    proofBodies.join('');
}

export function decodeAuditCommitments(hexResult, startOffset = 0) {
  if (!hexResult || typeof hexResult !== 'string' || hexResult === '0x') return [];
  const clean = hexResult.replace(/^0x/i, '');
  if (clean.length < 128) return [];
  const offsetWords = Number(BigInt('0x' + clean.slice(0, 64)) / 32n);
  const countStart = offsetWords * 64;
  if (clean.length < countStart + 64) return [];
  const count = Number(BigInt('0x' + clean.slice(countStart, countStart + 64)));
  const itemsStart = countStart + 64;
  const STRUCT_HEX_LEN = 7 * 64;
  const out = [];
  for (let i = 0; i < count; i++) {
    const base = itemsStart + i * STRUCT_HEX_LEN;
    if (clean.length < base + STRUCT_HEX_LEN) break;
    const chunk = clean.slice(base, base + STRUCT_HEX_LEN);
    out.push({
      proofId: startOffset + i,
      auditRootHash: '0x' + chunk.slice(0, 64).toLowerCase(),
      periodStart: Number(BigInt('0x' + chunk.slice(64, 128))),
      periodEnd: Number(BigInt('0x' + chunk.slice(128, 192))),
      transactionCount: Number(BigInt('0x' + chunk.slice(192, 256))),
      metadataHash: '0x' + chunk.slice(256, 320).toLowerCase(),
      timestamp: Number(BigInt('0x' + chunk.slice(320, 384))),
      submitter: '0x' + chunk.slice(384 + 24, 448).toLowerCase()
    });
  }
  return out;
}

export function decodeBoolArray(hexResult) {
  if (!hexResult || typeof hexResult !== 'string' || hexResult === '0x') return [];
  const clean = hexResult.replace(/^0x/i, '');
  if (clean.length < 128) return [];
  const offsetWords = Number(BigInt('0x' + clean.slice(0, 64)) / 32n);
  const countStart = offsetWords * 64;
  if (clean.length < countStart + 64) return [];
  const count = Number(BigInt('0x' + clean.slice(countStart, countStart + 64)));
  const itemsStart = countStart + 64;
  const results = [];
  for (let i = 0; i < count; i++) {
    const start = itemsStart + i * 64;
    if (clean.length < start + 64) break;
    results.push(BigInt('0x' + clean.slice(start, start + 64)) === 1n);
  }
  return results;
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

// Read current protocol fee dynamically from VeyroqRegistry.protocolFee()
export async function fetchProtocolFee() {
  try {
    const result = await arcRpcCall('eth_call', [{ to: REGISTRY_ADDRESS, data: SELECTORS.protocolFee }, 'latest']);
    if (!result || result === '0x') return PROTOCOL_FEE;
    return BigInt(result);
  } catch {
    return PROTOCOL_FEE;
  }
}

export async function fetchCommitmentCount(orgAddress) {
  if (!orgAddress || !orgAddress.startsWith('0x')) return 0;
  const data = SELECTORS.getCommitmentCount + padAddress(orgAddress);
  const result = await arcRpcCall('eth_call', [{ to: REGISTRY_ADDRESS, data }, 'latest']);
  if (!result || result === '0x') return 0;
  return Number(BigInt(result));
}

export async function fetchAuditCommitments(orgAddress, offset = 0, limit = 50) {
  if (!orgAddress || !orgAddress.startsWith('0x')) return [];
  const data = SELECTORS.getAuditCommitments + padAddress(orgAddress) + padUint256(offset) + padUint256(limit);
  const result = await arcRpcCall('eth_call', [{ to: REGISTRY_ADDRESS, data }, 'latest']);
  return decodeAuditCommitments(result, offset);
}

export async function resolveLatestProofId(orgAddress, auditRootHash) {
  if (!orgAddress || !auditRootHash) return null;
  const count = await fetchCommitmentCount(orgAddress);
  if (count <= 0) return null;
  const limit = Math.min(20, count);
  const offset = Math.max(0, count - limit);
  const commitments = await fetchAuditCommitments(orgAddress, offset, limit);
  const target = auditRootHash.toLowerCase();
  for (let i = commitments.length - 1; i >= 0; i--) {
    if (commitments[i].auditRootHash.toLowerCase() === target) {
      return { proofId: commitments[i].proofId, commitment: commitments[i] };
    }
  }
  return null;
}

export async function verifyTransactionInclusionOnChain(orgAddress, proofId, leafHash, merkleProof = []) {
  const data = encodeVerifyTransactionInclusion(orgAddress, proofId, leafHash, merkleProof);
  const result = await arcRpcCall('eth_call', [{ to: REGISTRY_ADDRESS, data }, 'latest']);
  return Boolean(result && result !== '0x' && BigInt(result) === 1n);
}

export async function verifyBatchInclusionOnChain(orgAddress, proofId, leafHashes = [], merkleProofs = []) {
  if (!Array.isArray(leafHashes) || leafHashes.length === 0) return [];
  const data = encodeVerifyBatchInclusion(orgAddress, proofId, leafHashes, merkleProofs);
  const result = await arcRpcCall('eth_call', [{ to: REGISTRY_ADDRESS, data }, 'latest']);
  return decodeBoolArray(result);
}

// On-Chain Merkle Proof Anchoring (reads dynamic protocolFee(); skips USDC.approve when fee === 0)
export async function executeCommitProofOnChain(provider, orgAddress, auditRootHash, periodStart, periodEnd, txCount) {
  await ensureArcNetwork(provider);
  const accounts = await provider.request({ method: 'eth_accounts' });
  const user = accounts[0];
  if (!user) throw new Error('No connected wallet account found.');

  // 1. Check live protocolFee() and approve only if fee > 0
  const fee = await fetchProtocolFee();
  if (fee > 0n) {
    const allowanceData = SELECTORS.allowance + padAddress(user) + padAddress(REGISTRY_ADDRESS);
    const currentAllowanceHex = await arcRpcCall('eth_call', [{ to: USDC_ADDRESS, data: allowanceData }, 'latest']);
    const currentAllowance = BigInt(currentAllowanceHex || '0');

    if (currentAllowance < fee) {
      const approveData = SELECTORS.approve + padAddress(REGISTRY_ADDRESS) + padUint256(fee);
      const approveTx = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: user, to: USDC_ADDRESS, data: approveData, value: '0x0' }]
      });
      await waitForTxReceipt(approveTx);
    }
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

// On-Chain Auditor Revocation
export async function executeRevokeAuditorOnChain(provider, auditorAddress) {
  await ensureArcNetwork(provider);
  const accounts = await provider.request({ method: 'eth_accounts' });
  const user = accounts[0];
  if (!user) throw new Error('No connected wallet account found.');

  const revokeData = SELECTORS.revokeAuditor + padAddress(auditorAddress);
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: user,
      to: REGISTRY_ADDRESS,
      data: revokeData,
      value: '0x0'
    }]
  });
  await waitForTxReceipt(txHash);

  return txHash;
}

