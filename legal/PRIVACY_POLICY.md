# Veyroq — Institutional Privacy Policy

**Last Updated:** November 18, 2026  
**Effective Date:** November 18, 2026  
**Entity:** Veyroq Protocol & Veyroq Labs (`veyroq.xyz`)  

---

### 1. Introduction & Core Principle: Client-Side Zero-Custody
Veyroq provides institutional auditability, selective disclosure, and compliance export tools for digital asset treasuries across supported EVM networks.

Our foundational rule is **Client-Side Zero-Custody**. Veyroq servers never collect, store, or custody your private spending keys, read-only View Keys, or decrypted financial transaction tables.

---

### 2. What Information We Do NOT Collect
* **No Spending Keys or View Keys on Backend:** Your private keys, seed phrases, and Scoped View Keys remain in your browser / wallet signer. Cryptographic hashing (`SHA-256` Merkle roots) and decryption run locally in browser JavaScript using the native Web Crypto API.
* **No Backend Database of Financial Plaintext:** We do not store decrypted corporate financial amounts, transaction labels, or accounting exports in any central database.
* **No Custodial Asset Balances:** Veyroq is software infrastructure and never holds user funds or stablecoins.

---

### 3. Operational, Session & Client-Storage Data Processed
* **Authentication & Signed Session Cookies (`veyroq_session`):** When authenticating via Privy Email OTP (`auth.privy.io`) or an EVM wallet SIWE challenge (`/api/auth/siwe/*`), the server issues an `HttpOnly`, HMAC-signed 24-hour session cookie storing your wallet address, authentication method, email address (when signing in via Privy email), and SIWE-verified vault addresses.
* **Local Browser Storage (`localStorage`):** Client session metadata (`veyroq_auth_session_v1`) and custom transaction classification tags remain locally in browser `localStorage` across tab reloads until you sign out, disconnect, or clear site data. Volatile decrypted memory clears when the tab closes.
* **Privy Embedded Wallets:** Email login OTP delivery and non-custodial key sharding are provided by Privy (`auth.privy.io`) subject to Privy’s privacy terms.
* **Public Blockchain Queries & Logs:** The app queries configured EVM RPC nodes (`rpc.testnet.arc.io`, etc.) and Blockscout explorer APIs (`explorer.testnet.arc.io`) for public logs and USDC balances. Server HTTP logs record request IDs, routes, status codes, and latency while automatically redacting cookies, authorization headers, and signatures.

---

### 4. Compliance with Global Privacy Standards (GDPR & CCPA)
By keeping financial plaintext, transaction classifications, and View Keys local to the client without central financial databases, Veyroq applies data-minimization and Privacy-by-Design principles aligned with GDPR and CCPA.

---

### 5. Contact & Inquiries
For legal or privacy inquiries regarding Veyroq software:  
**Email:** `legal@veyroq.xyz`  
**Website:** `https://veyroq.xyz`
