# Veyroq Integration Guide — For Enterprise CFOs & Auditors

> **Audience:** Chief Financial Officers, Internal Audit Teams, External Auditors (PwC, EY, Deloitte, KPMG)  
> **Version:** 1.0.0-MVP  
> **Network:** Circle Arc (Chain ID: 5042002)

---

## Quick Summary

Veyroq is a **zero-custody audit compliance tool** for enterprises using Circle's Arc blockchain. It lets you:

1. **Decrypt** your confidential Arc transactions locally in your browser.
2. **Verify** completeness using cryptographic Merkle proofs.
3. **Export** GAAP/IFRS-compliant journal entries for QuickBooks, Xero, or NetSuite.
4. **Anchor** an immutable audit proof on-chain for regulatory citation.

**No private keys, View Keys, or financial data ever leave your browser.**

---

## Step 1: Accessing the Veyroq Cockpit

Navigate to the Veyroq Compliance Console:

```
https://app.veyroq.xyz
```

### Authentication

Sign in using **Privy Embedded Wallets** or your **EIP-1193 / Safe Multisig Wallet**:

- **Email + OTP (Privy):** Enter your corporate email; receive a one-time passcode (`auth.privy.io`) to access your non-custodial embedded wallet.
- **External / Multisig Wallet (SIWE + EIP-1271):** Connect MetaMask, Ledger, or verify treasury ownership via Safe EIP-1271 signatures.

This authentication verifies treasury ownership without Veyroq ever having custody of your private key.

---

## Step 2: Entering Your Scoped View Key

After authentication, enter your **Arc Scoped View Key** in the Audit Configuration panel:

| Field | Example Value |
|---|---|
| Organization Address | `0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec` |
| Scoped View Key | `vk_arc_live_7a9f4102d84c17e8b625c4ef190a33190aef92` |
| Audit Period | FY 2026 - Q3 (July–September) |

### Where to Get Your View Key

Your Arc View Key is issued by your organization's Arc account administrator. Contact your internal IT or blockchain operations team.

> **⚠️ Security Note:** Your View Key is a read-only credential. It cannot spend, transfer, or modify any on-chain assets. However, it reveals financial transaction details — treat it with the same confidentiality as your bank statements.

---

## Step 3: Running Decryption & Verification

Click **"Decrypt & Verify Ledger"** to initiate the audit workflow:

1. **RPC Query:** Veyroq fetches encrypted transaction ciphertexts from the Arc RPC node.
2. **Local Decryption:** Your View Key decrypts the ciphertexts in your browser. No data is transmitted.
3. **Merkle Construction:** SHA-256 leaf hashes are computed for each transaction; a Merkle Tree is built.
4. **Root Comparison:** The computed Merkle Root is compared against the on-chain block commitment.

### Verification Outcomes

| Status | Meaning |
|---|---|
| ✔ Verified (100% Match) | All transactions present, unaltered, complete. |
| ⚠ Partial Match | Some transactions may be missing. Investigate. |
| ✘ Root Mismatch | Critical integrity issue. Records may have been tampered with. |

---

## Step 4: Reviewing the Decrypted Ledger

The **Decrypted Confidential Ledger** tab displays all resolved transactions:

- **Timestamp / Date** — UTC time of the on-chain settlement.
- **Arc Block** — The specific block number where the transaction was confirmed.
- **Transaction Type** — Classification (Payroll, Supplier Settlement, Treasury Rebalance, etc.).
- **Counterparty Identity** — The decrypted recipient (was previously encrypted on-chain).
- **Gross Amount** — The USDC value of the transaction.
- **Inclusion Proof** — Confirmation that this specific record is Merkle-verified.

---

## Step 5: Exporting for Accounting Software

### QuickBooks / Xero CSV Export

Click **"Export QuickBooks / Xero CSV"** to download a GAAP-formatted general journal:

- Each transaction generates a **debit/credit double-entry pair**.
- Account codes are automatically mapped (e.g., `Payroll Expenses:Officer Compensation`).
- Import directly into QuickBooks Desktop, QuickBooks Online, or Xero Manual Journals.

### NetSuite Export

For enterprise ERP users, select the NetSuite format for subsidiary-aware journal entries.

### Audit Certificate (JSON)

Click **"Download Audit Certificate (JSON)"** to generate a cryptographically signed proof document containing:

- Protocol version and generation timestamp.
- Merkle Root Hash and leaf commitments.
- Reconciliation status and assurance statement.
- Legal disclaimer.

This JSON document can be:
- Attached to GAAP/IFRS workpapers.
- Submitted alongside SEC 10-K filings.
- Provided to external auditors as supplementary evidence.

---

## Step 6: Managing On-Chain Auditor Policies

Switch to the **"On-Chain Auditor Policies"** tab to manage who can verify and anchor proofs for your organization.

### Authorizing an Auditor

1. Enter the auditor's EVM address on Arc.
2. Set an expiry date for the authorization.
3. Describe the engagement scope (e.g., "FY2026 Comprehensive GAAP Audit").
4. Click **"Broadcast Authorization to Arc"** — this creates an on-chain permission record in `VeyroqRegistry.sol`.

### Revoking an Auditor

Click **"Revoke"** next to any authorized auditor to immediately terminate their on-chain permissions.

---

## For External Auditors (PwC, EY, Deloitte, KPMG)

### What You Receive

1. **GAAP/IFRS Journal CSV** — Double-entry formatted, ready for workpaper import.
2. **Cryptographic Audit Certificate** — JSON document with Merkle Root, leaf hashes, and assurance statement.
3. **On-Chain Verification** — You can independently verify the Merkle Root against the `VeyroqRegistry` contract on Arc.

### Independent Verification

As an authorized auditor, you can:

1. Query `VeyroqRegistry.getAuditCommitment(organization, proofId)` to retrieve the anchored Merkle Root.
2. Use `VeyroqRegistry.verifyTransactionInclusion(organization, proofId, leafHash, merkleProof)` to verify specific line items.
3. Cross-reference the certificate's `merkleRootHash` against the contract's stored value.

### Regulatory Citation Format

When citing Veyroq verification in audit reports:

```
Transaction integrity verified via Veyroq Institutional Audit Protocol v1.0.0.
Merkle Root: 0x8a1d7f4e912c4b...c902
Anchored on Circle Arc (Chain ID: 5042002) at block #419,200.
VeyroqRegistry Contract: 0xD431c...
Proof ID: 0
```

---

## Frequently Asked Questions

### Does Veyroq store my View Key or financial data?

**No.** Veyroq is 100% client-side. Your View Key is used for in-browser decryption and is never transmitted over the network. Decrypted records exist only in browser memory and are wiped when you close the tab.

### What happens if I lose my View Key?

Contact your organization's Arc account administrator to reissue a new Scoped View Key. Veyroq does not store or recover View Keys.

### Is the Merkle proof legally admissible?

Veyroq provides cryptographic evidence of transaction completeness. While not a legal opinion, the mathematical guarantees of Merkle Trees (used in Bitcoin, Ethereum, and banking systems) are widely accepted as supplementary audit evidence by major accounting firms.

### Can I use Veyroq without Circle Wallet?

Yes. Circle Wallet authentication is optional. You can use the Cockpit with just your View Key and organization address.

---

## Support & Contact

- **Documentation:** [docs.veyroq.xyz](https://docs.veyroq.xyz)
- **Security Issues:** security@veyroq.xyz
- **Enterprise Sales:** enterprise@veyroq.xyz
