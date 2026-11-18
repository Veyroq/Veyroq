# Veyroq — Zero-Custody Institutional Treasury Audit Protocol

Veyroq provides client-side View Key decryption, cryptographic transaction verification, EIP-1271 / Safe multisig SIWE verification, and GAAP-ready tax exports on **Circle Arc Testnet**.

## Production Architecture

Veyroq runs cleanly in both local development (`node server.js` monolith) and split production hosting:

- **Frontend Edge (Vercel):** Serves static web surfaces (`landing/`, `console/`, `docs/`, `legal/`, `assets/`) globally via CDN (`vercel.json`).
- **API & Auth Backend (Railway or Render):** Runs `server.js` persistently for `/api/auth/*`, `/health`, rate limiting, SIWE nonce validation, and structured Pino JSON logging (`railway.toml`, `render.yaml`).
- **First-Party Vercel Proxy (`api/index.js`):** When `VEYROQ_BACKEND_URL` is configured on Vercel, requests to `/api/*` and `/health*` proxy directly to Railway/Render so auth cookies remain first-party `SameSite=Lax`.
- **Smart Contracts (`contracts/`):** `VeyroqRegistry.sol` verified on Arc Testnet (`0x8A1D55E8E07fa49edF4c0a420b8B033ad03B37B3`).

## Quickstart (Local Development)

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Start the server (serves landing page, console, docs, legal, and APIs on `http://localhost:3000`):
   ```bash
   npm run dev
   ```
4. Open:
   - Landing page: `http://localhost:3000/`
   - Institutional Console: `http://localhost:3000/console`
   - Documentation: `http://localhost:3000/docs`
   - Healthcheck: `http://localhost:3000/health`

## Testing & Verification

- Node unit + integration suite (enforces >=60% line coverage):
  ```bash
  npm test
  ```
- Solidity smart contract tests (Foundry):
  ```bash
  npm run test:contracts
  ```
- Full test suite (Node + Foundry):
  ```bash
  npm run test:all
  ```
- Rebuild Privy SDK browser bundle:
  ```bash
  npm run build:privy
  ```

## Operations & Team Engineering Docs

- [Operations & Rollback Runbook](docs/RUNBOOK.md) — Split-hosting setup, 7–10 developer PR/CI/CD workflow, staging promotion, and <2-minute rollbacks.
- [Incident Playbook & Post-Mortem Template](docs/PLAYBOOK.md) — Triage guides (Arc RPC, Privy OTP, Safe SIWE, cookies) and blameless 48-hour post-mortem template.
- [Environment Templates](.env.example) & [Staging Environment Template](.env.staging.example).
