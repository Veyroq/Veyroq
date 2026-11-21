// Zero-dependency Ethereum Keccak-256 & OpenZeppelin-compatible Merkle tree engine
// Runs identically in browser ES modules and Node.js without external dependencies.

const MASK64 = 0xffffffffffffffffn;
const KECCAK_ROUNDS = 24;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

const ROTC = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
  27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44
];

const PILN = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
  15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1
];

function rotl64(x, n) {
  const shift = BigInt(n);
  if (shift === 0n) return x & MASK64;
  return ((x << shift) | (x >> (64n - shift))) & MASK64;
}

function keccakF1600(state) {
  const bc = new Array(5);
  for (let round = 0; round < KECCAK_ROUNDS; round++) {
    // Theta
    for (let i = 0; i < 5; i++) {
      bc[i] = state[i] ^ state[i + 5] ^ state[i + 10] ^ state[i + 15] ^ state[i + 20];
    }
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) {
        state[j + i] = (state[j + i] ^ t) & MASK64;
      }
    }

    // Rho & Pi
    let t = state[1];
    for (let i = 0; i < 24; i++) {
      const j = PILN[i];
      bc[0] = state[j];
      state[j] = rotl64(t, ROTC[i]);
      t = bc[0];
    }

    // Chi
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = state[j + i];
      for (let i = 0; i < 5; i++) {
        state[j + i] = (bc[i] ^ ((~bc[(i + 1) % 5] & MASK64) & bc[(i + 2) % 5])) & MASK64;
      }
    }

    // Iota
    state[0] = (state[0] ^ RC[round]) & MASK64;
  }
}

export function hexToBytes(hex) {
  const clean = String(hex ?? '').replace(/^0x/i, '').toLowerCase();
  if (clean.length % 2 !== 0 || (clean.length > 0 && !/^[0-9a-f]+$/.test(clean))) {
    throw new Error('Invalid hex input');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes) {
  let out = '0x';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function keccak256Bytes(inputBytes) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes || []);
  const rate = 136; // Keccak-256 rate in bytes (1088 bits)
  const blockCount = Math.floor(bytes.length / rate) + 1;
  const padded = new Uint8Array(blockCount * rate);
  padded.set(bytes);
  // Ethereum Keccak-256 uses 0x01 domain separator (NOT NIST SHA3-256 0x06)
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane++) {
      let word = 0n;
      const base = offset + lane * 8;
      for (let b = 0; b < 8; b++) {
        word |= BigInt(padded[base + b]) << BigInt(b * 8);
      }
      state[lane] ^= word;
    }
    keccakF1600(state);
  }

  const digest = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let word = state[i];
    for (let b = 0; b < 8; b++) {
      digest[i * 8 + b] = Number((word >> BigInt(b * 8)) & 0xffn);
    }
  }
  return bytesToHex(digest);
}

export function keccak256Utf8(str) {
  return keccak256Bytes(new TextEncoder().encode(String(str ?? '')));
}

export function keccak256Hex(hexStr) {
  return keccak256Bytes(hexToBytes(hexStr));
}

export function normalizeBytes32(hex) {
  const raw = String(hex ?? '').trim().replace(/^0x/i, '').toLowerCase();
  if (!raw || !/^[0-9a-f]+$/.test(raw)) {
    throw new Error('Invalid bytes32 hex value');
  }
  if (raw.length > 64) {
    return '0x' + raw.slice(-64);
  }
  return '0x' + raw.padStart(64, '0');
}

// OpenZeppelin MerkleProof._hashPair commutative sorted-pair keccak256
export function hashPairSorted(a, b) {
  const na = normalizeBytes32(a);
  const nb = normalizeBytes32(b);
  const first = na <= nb ? na : nb;
  const second = na <= nb ? nb : na;
  const combined = new Uint8Array(64);
  combined.set(hexToBytes(first), 0);
  combined.set(hexToBytes(second), 32);
  return keccak256Bytes(combined);
}

export function serializeTransactionLeaf(tx) {
  const item = tx || {};
  const id = String(item.transactionId ?? item.id ?? '');
  const block = String(item.blockHeight ?? item.block ?? 0);
  const numAmount = Number(item.amountUSDC ?? item.grossAmount ?? 0);
  const amount = Number.isFinite(numAmount) ? numAmount.toFixed(6) : '0.000000';
  const counterparty = String(item.plainCounterparty ?? item.counterparty ?? '');
  return `${id}:${block}:${amount}:${counterparty}`;
}

export function computeTransactionLeaf(tx) {
  return keccak256Utf8(serializeTransactionLeaf(tx));
}

export function buildMerkleTree(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    return { root: '0x00', leaves: [], levels: [], proofs: [] };
  }

  const normalized = leaves.map(normalizeBytes32);
  if (normalized.length === 1) {
    return {
      root: normalized[0],
      leaves: normalized,
      levels: [normalized],
      proofs: [[]]
    };
  }

  const levels = [normalized];
  let current = normalized;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPairSorted(current[i], current[i + 1]));
      } else {
        next.push(current[i]);
      }
    }
    levels.push(next);
    current = next;
  }

  const proofs = normalized.map((_, leafIdx) => {
    const proof = [];
    let pos = leafIdx;
    for (let lvlIdx = 0; lvlIdx < levels.length - 1; lvlIdx++) {
      const level = levels[lvlIdx];
      if (pos % 2 === 0) {
        if (pos + 1 < level.length) {
          proof.push(level[pos + 1]);
        }
      } else {
        proof.push(level[pos - 1]);
      }
      pos = Math.floor(pos / 2);
    }
    return proof;
  });

  return {
    root: levels[levels.length - 1][0],
    leaves: normalized,
    levels,
    proofs
  };
}

export function computeMerkleRoot(leaves) {
  return buildMerkleTree(leaves).root;
}

export function getMerkleProof(leaves, index) {
  const tree = buildMerkleTree(leaves);
  return tree.proofs[index] || [];
}

export function verifyMerkleProofLocal(leaf, proof, root) {
  try {
    let computed = normalizeBytes32(leaf);
    const expectedRoot = normalizeBytes32(root);
    const siblings = Array.isArray(proof) ? proof : [];
    for (const sibling of siblings) {
      computed = hashPairSorted(computed, sibling);
    }
    return computed === expectedRoot;
  } catch {
    return false;
  }
}

export function verifyCertificatePayload(cert, { onChainRoot = null, onChainBatchResults = null } = {}) {
  const emptyFail = (error) => ({
    valid: false,
    error,
    scope: 'full',
    certRoot: null,
    onChainRoot,
    rootMatchesOnChain: null,
    fieldsIntact: false,
    localProofsValid: false,
    onChainInclusionValid: null,
    totalCount: 0,
    verifiedCount: 0,
    tamperedFieldIndices: [],
    invalidLocalProofIndices: [],
    failedOnChainIndices: [],
    rows: []
  });

  if (!cert || typeof cert !== 'object') {
    return emptyFail('Audit certificate must be a JSON object.');
  }
  const rawRoot = cert.verification?.merkleRootHash;
  const items = cert.leafCommitments;
  if (!rawRoot || !Array.isArray(items) || items.length === 0) {
    return emptyFail('Certificate is missing verification.merkleRootHash or leafCommitments.');
  }

  let certRoot;
  try {
    certRoot = normalizeBytes32(rawRoot);
  } catch {
    return emptyFail('Certificate verification.merkleRootHash is not a valid 32-byte hex string.');
  }

  const hasRedactedCounterparty = items.some(it =>
    String(it?.counterparty ?? it?.plainCounterparty ?? '').startsWith('[REDACTED]')
  );
  const scope = cert.verification?.disclosureScope === 'redacted' || hasRedactedCounterparty
    ? 'redacted'
    : 'full';

  const tamperedFieldIndices = [];
  const invalidLocalProofIndices = [];
  const failedOnChainIndices = [];
  const hasBatch = Array.isArray(onChainBatchResults);

  const rows = items.map((item, idx) => {
    let leafHash = null;
    try {
      leafHash = normalizeBytes32(item?.leafHash);
    } catch {
      leafHash = null;
    }

    const expectedLeafHash = scope === 'full' ? computeTransactionLeaf(item) : null;
    const fieldMatch = scope === 'full' ? Boolean(leafHash && expectedLeafHash === leafHash) : null;
    if (scope === 'full' && !fieldMatch) {
      tamperedFieldIndices.push(idx);
    }

    const proofArr = Array.isArray(item?.merkleProof) ? item.merkleProof : [];
    const proofValid = leafHash ? verifyMerkleProofLocal(leafHash, proofArr, certRoot) : false;
    if (!proofValid) {
      invalidLocalProofIndices.push(idx);
    }

    const onChainIncluded = hasBatch ? Boolean(onChainBatchResults[idx]) : null;
    if (hasBatch && !onChainIncluded) {
      failedOnChainIndices.push(idx);
    }

    return {
      index: idx,
      transactionId: item?.transactionId ?? item?.id ?? '',
      blockHeight: item?.blockHeight ?? item?.block ?? null,
      amountUSDC: item?.amountUSDC ?? item?.grossAmount ?? 0,
      counterparty: item?.counterparty ?? item?.plainCounterparty ?? '',
      classification: item?.classification ?? item?.category ?? '',
      leafHash,
      expectedLeafHash,
      fieldMatch,
      proofValid,
      onChainIncluded
    };
  });

  let normOnChainRoot = null;
  let rootMatchesOnChain = null;
  if (onChainRoot !== null && onChainRoot !== undefined && onChainRoot !== '') {
    try {
      normOnChainRoot = normalizeBytes32(onChainRoot);
      rootMatchesOnChain = normOnChainRoot === certRoot;
    } catch {
      normOnChainRoot = String(onChainRoot);
      rootMatchesOnChain = false;
    }
  }

  const totalCount = rows.length;
  const fieldsIntact = scope !== 'full' ? null : tamperedFieldIndices.length === 0;
  const localProofsValid = totalCount > 0 && invalidLocalProofIndices.length === 0;
  const onChainInclusionValid = hasBatch
    ? (onChainBatchResults.length === totalCount && failedOnChainIndices.length === 0)
    : null;

  const valid = Boolean(
    totalCount > 0 &&
    localProofsValid &&
    (scope !== 'full' || fieldsIntact) &&
    (normOnChainRoot === null || rootMatchesOnChain) &&
    (!hasBatch || onChainInclusionValid)
  );

  const verifiedCount = rows.filter(r =>
    r.proofValid &&
    (scope !== 'full' || r.fieldMatch) &&
    (r.onChainIncluded !== false)
  ).length;

  return {
    valid,
    error: null,
    scope,
    certRoot,
    onChainRoot: normOnChainRoot,
    rootMatchesOnChain,
    fieldsIntact,
    localProofsValid,
    onChainInclusionValid,
    totalCount,
    verifiedCount,
    tamperedFieldIndices,
    invalidLocalProofIndices,
    failedOnChainIndices,
    rows
  };
}
