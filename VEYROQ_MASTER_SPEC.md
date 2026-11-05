# Veyroq — Master Specification & Technical Blueprint

> **Protocol Name:** Veyroq (`veyroq.xyz`)  
> **Ecosystem:** Circle's Arc Layer-1 Blockchain (Arc Privacy Sector - APS)  
> **Primary Asset:** Native USDC  
> **Core Tooling:** Foundry (`forge`), Solidity `^0.8.24`, TypeScript, Makefiles  
> **Version:** 1.0.0-MVP  

---

## 1. Executive Summary & Brand Identity

### The Brand: Veyroq
**Veyroq** is the institutional auditability, selective disclosure, and compliance infrastructure layer purpose-built for **Circle's Arc blockchain** and the **Arc Privacy Sector (APS)**.

### The Problem
Arc by Circle introduces confidential execution (pEVM) using secure hardware enclaves and native USDC gas. While this keeps corporate payroll, B2B settlements, and treasury rebalancing private from public blockchain explorers, enterprises are legally mandated to produce auditable, GAAP/IFRS-compliant tax records and proofs of completeness for regulators (IRS, HMRC, SEC) and accounting firms (PwC, EY, Deloitte). 

Without an enterprise-grade tool to ingest Arc **View Keys**, decrypt historical transactions locally, and generate cryptographically verifiable audit reports, institutions cannot deploy capital onto Arc.

### The Solution: Veyroq
Veyroq bridges confidential on-chain execution with institutional regulatory compliance:
1. **On-Chain Audit Registry (`contracts/`):** A lightweight, gas-optimized Foundry contract deployed on Arc to manage auditor authorizations and anchor cryptographic audit root commitments.
2. **Client-Side Decryption & Merkle Verification (`console/` & `@veyroq/core`):** A 100% zero-custody engine where the company’s View Key stays on their local machine, decrypts pEVM transaction records, and builds Merkle inclusion proofs.
3. **Auditor & Compliance Cockpit (`console/`):** A clean, institutional portal for CFOs and auditors to input View Keys, review scoped ledger activity, and export 1-click tax files (QuickBooks / Xero CSV + Cryptographic Proof Certificates).
4. **Interactive Documentation Hub (`docs/`):** Clear developer guides, cryptographic specifications, and integration tutorials.
5. **Marketing Landing Page (`landing/`):** Institutional landing page highlighting the value proposition, security model, and Circle Alliance alignment.

---

## 2. Modular Multi-Directory Architecture

To enable clean version control and independent deployment/pushing, Veyroq is structured into separate, modular components:

```
untapped market/ (Veyroq Workspace)
├── VEYROQ_MASTER_SPEC.md        # This master architecture blueprint
├── Makefile                     # Root build, test, and orchestration commands
│
├── contracts/                   # Foundry Smart Contract Suite
│   ├── foundry.toml             # Foundry configuration for Arc Testnet / Mainnet
│   ├── Makefile                 # Foundry build & test automation
│   ├── src/
│   │   ├── VeyroqRegistry.sol   # On-chain auditor registry & proof commitment
│   │   └── interfaces/
│   │       └── IVeyroqRegistry.sol
│   └── test/
│       ├── VeyroqRegistry.t.sol # Invariant, fuzz & unit test suite
│       └── mocks/
│           └── MockUSDC.sol
│
├── landing/                     # Institutional Landing Page (veyroq.xyz)
│   ├── index.html               # High-conversion institutional overview
│   ├── styles.css               # Obsidian / Cyan / Platinum palette
│   └── app.js
│
├── docs/                        # Protocol & Developer Documentation
│   ├── index.html               # Interactive documentation browser
│   ├── architecture.md          # Cryptographic proofs & View Key mechanics
│   ├── integration.md           # Guide for enterprise CFOs and auditors
│   └── styles.css
│
├── console/                     # Veyroq Auditor & Compliance Cockpit
│   ├── index.html               # Local View Key Decryption & Audit Generator
│   ├── styles.css               # Clean, high-density financial UI
│   ├── app.js                   # Client-side cryptographic decryptor & Merkle verifier
│   └── exporter.js              # GAAP/IFRS, QuickBooks & Xero CSV generator
│
└── legal/                       # Comprehensive Institutional Legal Suite
    ├── PRIVACY_POLICY.md        # Strict Zero-Data Retention & Zero-Custody Policy
    ├── TERMS_OF_SERVICE.md      # SaaS terms, liability limitations, non-custodial status
    ├── REFUND_POLICY.md         # Digital service & on-chain settlement refund terms
    └── REGULATORY_DISCLAIMER.md # Safe harbor, tax disclaimer, and compliance guidelines
```

---

## 3. Cryptographic & Verification Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. TRANSACTION PHASE (On-Chain / Arc pEVM)                                  │
│    • Company A sends $50,000 USDC to Vendor B inside Arc Privacy Sector.    │
│    • Amounts and counterparties are encrypted inside hardware enclaves.     │
│    • State commitments update Arc block headers.                            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. SELECTIVE DISCLOSURE (Client-Side inside Veyroq Console)                 │
│    • Auditor/CFO enters Scoped View Key (restricted to e.g. FY 2026).       │
│    • ZERO-CUSTODY GUARANTEE: Key NEVER leaves the user's browser.           │
│    • Decrypts transaction ciphertexts locally via Arc RPC.                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. PROOF OF COMPLETENESS & INTEGRITY                                        │
│    • Engine recomputes Merkle Leaf Hashes for all decrypted records.        │
│    • Compares calculated Merkle Root against on-chain block commitment.     │
│    • Mathematical guarantee: Zero hidden transactions, zero altered values. │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. INSTITUTIONAL AUDIT EXPORT                                               │
│    • 1-Click CSV export formatted for QuickBooks, Xero, and NetSuite.       │
│    • Cryptographically signed "Audit Verification Certificate" (JSON/PDF).  │
│    • Audit proof hash anchored on VeyroqRegistry.sol for on-chain receipt.  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Smart Contract Specification: `VeyroqRegistry.sol`

### Responsibilities:
1. **Auditor Permissioning:** An institution can authorize designated auditor addresses with specific date ranges or block windows.
2. **Commitment Anchoring:** Once an audit is verified, the auditor or institution submits the `auditRootHash` to the contract.
3. **Immutable Verification Events:** Emits on-chain receipts (`AuditAnchored`, `AuditorAuthorized`) that can be cited in formal regulatory filings.
4. **Settlement Fee:** Collects a protocol fee in native USDC for official proof registration.

---

## 5. Institutional Legal & Compliance Safeguards

To protect the company, founders, and users from legal liability, regulatory exposure, or lawsuits:

1. **Privacy Policy (Zero-Custody):**
   * Explicitly declares that Veyroq never collects, stores, or transmits View Keys, spending keys, or decrypted financial transaction records. All cryptographic operations occur client-side.
2. **Terms of Service:**
   * Limits liability to the maximum extent permitted by law.
   * Clarifies that Veyroq is a software utility and does not provide financial, legal, tax, or accounting advice.
3. **Refund Policy:**
   * Clearly outlines non-refundable policy on on-chain gas/settlement transactions and standard subscription terms.
4. **Regulatory & Tax Safe Harbor Disclaimer:**
   * Clarifies that Veyroq provides cryptographic verification tools, but the user is solely responsible for the accuracy of their tax filings and legal compliance.

---

## 6. Execution Roadmap

* **Step 1:** Clean legacy files and initialize Foundry configuration (`contracts/`).
* **Step 2:** Write `VeyroqRegistry.sol` and Foundry tests (`contracts/test/VeyroqRegistry.t.sol`).
* **Step 3:** Create legal suite in `legal/` (`PRIVACY_POLICY.md`, `TERMS_OF_SERVICE.md`, `REFUND_POLICY.md`, `REGULATORY_DISCLAIMER.md`).
* **Step 4:** Build the Veyroq Landing Page (`landing/`).
* **Step 5:** Build the Interactive Documentation (`docs/`).
* **Step 6:** Build the Veyroq Compliance & Auditor Cockpit (`console/`).
