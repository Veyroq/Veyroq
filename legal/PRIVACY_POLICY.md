# Veyroq — Institutional Privacy Policy

**Last Updated:** November 1, 2026  
**Effective Date:** November 1, 2026  
**Entity:** Veyroq Protocol & Veyroq Labs (`veyroq.xyz`)  

---

### 1. Introduction & Core Principle: Client-Side Zero-Custody
Veyroq provides institutional auditability, selective disclosure, and tax-compliance infrastructure for digital asset treasuries across supported blockchain networks and enterprise stablecoin rails.

Our foundational architectural rule is **Client-Side Zero-Custody**. We do not collect, view, store, transmit, or custody your private spending keys, read-only View Keys, or decrypted corporate transaction records.

---

### 2. What Information We Do NOT Collect
* **No Cryptographic Keys:** Your Scoped View Keys, passkey credentials, seed phrases, and private keys remain strictly within your local computing environment (your browser or local runtime). Decryption occurs exclusively in client-side memory.
* **No Financial Transaction Plaintext:** We do not store or transmit decrypted financial amounts, counterparty addresses, payroll records, or commercial contract data to our servers.
* **No Custodial Wallet Balances:** Veyroq is a software utility and never takes custody of funds, stablecoins, or treasury assets.

---

### 3. Information We May Process (Minimal Operational Data)
* **Public Network Metadata:** Publicly broadcast on-chain transaction hashes, block timestamps, and smart contract event logs on supported networks.
* **Aggregated Usage Telemetry (Optional/Opt-In):** Basic application performance metrics (e.g., page load latency, browser user-agent) with IP addresses anonymized. We do not correlate web analytics with on-chain wallet addresses.

---

### 4. Client-Side Decryption Architecture
When an enterprise CFO, accountant, or auditor utilizes the Veyroq Compliance Console:
1. The Scoped View Key is loaded into local browser volatile memory (RAM) only.
2. Encrypted transaction payloads are retrieved directly from network RPC nodes.
3. Cryptographic decryption and Merkle completeness proofs execute locally via WebAssembly and the native Web Crypto API.
4. When the browser tab is closed, all plaintext and key representations are immediately cleared from local memory.

---

### 5. Third-Party RPC Providers
When querying blockchain networks, your client communicates with public or private RPC nodes. Please review the privacy policies of your selected RPC node provider regarding IP address logging.

---

### 6. Compliance with Global Privacy Regulations (GDPR & CCPA)
Because Veyroq does not store personal financial data or identities on central databases, Veyroq adheres to the principles of "Privacy by Design" and data minimization under the EU General Data Protection Regulation (GDPR) and the California Consumer Privacy Act (CCPA).

---

### 7. Contact & Inquiries
For legal or privacy inquiries regarding Veyroq software:  
**Email:** `legal@veyroq.xyz`  
**Website:** `https://veyroq.xyz`
