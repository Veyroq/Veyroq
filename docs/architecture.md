# Veyroq Architecture — Cryptographic Proof & View Key Mechanics

> **Version:** 1.0.0-MVP  
> **Network:** Circle Arc (Chain ID: 5042002)  
> **Sector:** Arc Privacy Sector (APS / pEVM)

---

## 1. The Privacy Problem for Institutions

Circle's Arc blockchain uses **confidential execution** via the **pEVM (Privacy-Enabled EVM)**. Transactions processed inside pEVM hardware enclaves are encrypted — amounts, counterparties, and business logic are invisible to public block explorers.

**This is excellent for corporate privacy.** However, enterprises face a regulatory paradox:

- **IRS (US):** Requires complete financial records under IRC §6001.
- **HMRC (UK):** Mandates "adequate and accurate" records under TMA 2000.
- **SEC:** Requires audited GAAP financials for public companies.
- **IFRS:** International standard requiring complete, neutral, and free-from-error records.

**Without a mechanism to selectively decrypt and verify completeness, institutions cannot adopt Arc for treasury operations.**

---

## 2. Arc View Keys (Scoped Decryption)

Arc View Keys are cryptographic credentials issued by the pEVM enclave infrastructure that allow **read-only access** to encrypted transaction data. They do NOT grant spending authority.

### Key Properties

| Property | Description |
|---|---|
| **Scope** | View Keys can be scoped to specific date ranges, block windows, or counterparty filters. |
| **Derivation** | Derived from the organization's master secret inside the TEE (Trusted Execution Environment). |
| **Non-Custodial** | The View Key reveals transaction data when applied locally — it does not need to be submitted to any server. |
| **Revocable** | Organizations can rotate or invalidate View Keys without affecting spending keys. |

### View Key Format

```
vk_arc_live_{scope_hash}_{derivation_nonce}
```

Example:  
`vk_arc_live_7a9f4102d84c17e8b625c4ef190a33190aef92`

---

## 3. Client-Side Decryption Workflow

Veyroq **never** stores, transmits, or has access to View Keys. The entire decryption flow occurs in the user's browser:

```
┌──────────────────────────────────────────────┐
│  USER'S BROWSER (Zero-Custody Environment)   │
│                                              │
│  1. User enters Scoped View Key / connects   │
│  2. Browser queries Arc RPC for logs & tx    │
│  3. Web Crypto SHA-256 & hashing run locally │
│  4. Plaintext records never hit backend DB   │
│  5. Session & custom tags remain client-side │
└──────────────────────────────────────────────┘
```

### Security Guarantees

- **Network isolation:** View Keys and decrypted financial tables are never persisted on Veyroq backend servers.
- **Browser-local state:** Transaction classification tags and session state stay on your device (`localStorage`), never in a central vendor database.
- **No key custody:** Relayer execution endpoints are retired (`410 Gone`); users sign transactions directly from their own wallets.
- **CSP enforced:** Strict Content Security Policy restricts external script execution.

---

## 4. Merkle Completeness Proofs

After decryption, Veyroq constructs a **Merkle Tree** from all decrypted transaction records and compares the computed root against the on-chain block state commitment.

### Construction Algorithm

```
Leaf = SHA-256(tx_id || block_number || amount || counterparty)

Level 0: [Leaf₁, Leaf₂, Leaf₃, ..., Leafₙ]
Level 1: [SHA-256(Leaf₁ + Leaf₂), SHA-256(Leaf₃ + Leaf₄), ...]
Level 2: [SHA-256(Node₁ + Node₂), ...]
...
Root:    [Merkle Root Hash]
```

### Verification Steps

1. **Compute all leaf hashes** from decrypted transaction data.
2. **Build the Merkle Tree** bottom-up using sorted-pair SHA-256 hashing.
3. **Compare computed Merkle Root** against the on-chain commitment stored in Arc block headers.
4. **If roots match:** Mathematical guarantee that **zero transactions were omitted, fabricated, or altered.**

### On-Chain Anchoring

The verified Merkle Root is then anchored on-chain via `VeyroqRegistry.commitAuditProof()`:

```solidity
function commitAuditProof(
    address organization,
    bytes32 auditRootHash,     // The computed Merkle Root
    uint256 periodStart,
    uint256 periodEnd,
    uint256 transactionCount,
    bytes32 metadataHash       // Hash of engagement letter / audit scope
) external payable returns (uint256 proofId);
```

This creates an immutable, timestamped on-chain receipt that can be cited in regulatory filings.

---

## 5. Individual Transaction Inclusion Proofs

Beyond proving completeness, Veyroq also supports **individual transaction inclusion proofs** — allowing an auditor to verify that a specific line item existed within the committed dataset.

```solidity
function verifyTransactionInclusion(
    address organization,
    uint256 proofId,
    bytes32 leafHash,
    bytes32[] calldata merkleProof
) external view returns (bool);
```

This is valuable for:
- Spot-check audits (IRS/HMRC random sampling).
- Dispute resolution ("Did payment X actually occur?").
- Cross-referencing bank reconciliation statements.

---

## 6. Threat Model & Assumptions

| Threat | Mitigation |
|---|---|
| **Veyroq acts maliciously** | Impossible — Veyroq never receives the View Key. All computation is client-side. |
| **Browser extension injects script** | CSP headers restrict script sources. Users advised to use hardened browsers. |
| **Compromised Arc RPC node** | Merkle Root comparison against block headers detects any tampered ciphertexts. |
| **Organization omits transactions** | The Merkle Root will NOT match the on-chain commitment if any records are excluded. |
| **Replay attack** | Each commitment is timestamped and includes `periodStart`/`periodEnd` to prevent re-use. |

---

## 7. Cryptographic Dependencies

| Library | Purpose | Trust Level |
|---|---|---|
| Web Crypto API (`crypto.subtle`) | SHA-256 hashing, ECDSA verification | Browser-native, hardware-accelerated |
| OpenZeppelin `MerkleProof.sol` | On-chain Merkle inclusion verification | Industry-standard, audited |
| Arc pEVM Enclave SDK | View Key derivation, ciphertext decryption | Circle-maintained, TEE-backed |

---

## 8. Future: ZK-SNARK Compliance Proofs (v2)

In future versions, Veyroq plans to integrate **Zero-Knowledge proofs** to enable:

- **Range proofs:** "Total payroll < $500,000" without revealing individual salaries.
- **Aggregate proofs:** "Total USDC outflows match declared tax obligation" without revealing counterparties.
- **Cross-chain attestations:** Prove compliance across multiple chains without revealing business relationships.

This will use **Groth16** or **PLONK** circuits compiled to the Arc VM's native proof verification precompile.
