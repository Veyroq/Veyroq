# ⚡ Veyroq (`veyroq.xyz`)

> **Institutional Selective Disclosure, View Key Decryption & Audit Infrastructure for Circle's Arc Privacy Sector (APS)**

[![Foundry](https://img.shields.io/badge/Built%20with-Foundry-orange)](https://github.com/foundry-rs/foundry)
[![Arc](https://img.shields.io/badge/Blockchain-Circle%20Arc-blue)](https://arc.io)
[![USDC](https://img.shields.io/badge/Native%20Gas-USDC-2775CA)](https://circle.com/usdc)
[![Tests](https://img.shields.io/badge/Tests-7%20Passing-brightgreen)](file:///home/binlawal/untapped%20market/contracts)

---

## 1. What is Veyroq?

**Veyroq** is the institutional auditability, selective disclosure, and compliance bridge purpose-built for **Circle’s Arc blockchain** and the **Arc Privacy Sector (APS)**.

While Arc allows enterprises to conduct private transactions (payroll, supplier settlement, treasury rebalancing) inside secure hardware enclaves using native USDC gas, companies are legally required to produce auditable, GAAP/IFRS-compliant tax reports for regulators (IRS, HMRC) and auditors (PwC, EY). 

Veyroq provides the client-side cryptographic engine and on-chain registry that enables institutions to use **Arc View Keys** to selectively decrypt transaction records, mathematically prove completeness, and export 1-click tax files with zero data leakage to the public.

---

## 2. Modular Architecture

```
untapped market/ (Veyroq Workspace)
├── VEYROQ_MASTER_SPEC.md        # Master architecture blueprint & specification
├── Makefile                     # Root build, test, and preview automation
│
├── contracts/                   # Foundry Smart Contract Suite
│   ├── foundry.toml             # Foundry configuration for Arc Testnet (Chain ID: 5042002)
│   ├── Makefile                 # Foundry build & test commands
│   ├── src/
│   │   ├── VeyroqRegistry.sol   # On-chain auditor registry & proof commitment
│   │   └── interfaces/
│   │       └── IVeyroqRegistry.sol
│   └── test/
│       ├── VeyroqRegistry.t.sol # Invariant & unit test suite (7/7 PASSING)
│       └── mocks/
│           └── MockUSDC.sol
│
├── landing/                     # Institutional Landing Page (veyroq.xyz)
├── docs/                        # Interactive Protocol Documentation
├── console/                     # Veyroq Auditor & Compliance Cockpit (Zero-Custody)
├── legal/                       # Institutional Legal Suite (Privacy, Terms, Refunds, Disclaimers)
└── chat/                        # Historical conversation archives
```

---

## 3. Quickstart & Verification

### Build & Run Tests with Foundry
```bash
# Build contracts
make build

# Run full test suite
make test

# Run tests with verbose traces
make test-verbose
```

### Local Preview Services
```bash
# Preview Landing Page (http://localhost:3000)
make serve-landing

# Preview Auditor Cockpit (http://localhost:3001)
make serve-console

# Preview Protocol Docs (http://localhost:3002)
make serve-docs
```

---

## 4. Legal & Compliance Disclaimers
* [Privacy Policy (Zero-Custody)](file:///home/binlawal/untapped%20market/legal/PRIVACY_POLICY.md)
* [Terms of Service](file:///home/binlawal/untapped%20market/legal/TERMS_OF_SERVICE.md)
* [Refund & Billing Policy](file:///home/binlawal/untapped%20market/legal/REFUND_POLICY.md)
* [Regulatory Safe Harbor Disclaimer](file:///home/binlawal/untapped%20market/legal/REGULATORY_DISCLAIMER.md)
