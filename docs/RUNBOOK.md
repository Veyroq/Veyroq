# Veyroq Operations & Deployment Runbook

## 1. Architecture Overview (Split Hosting)

| Layer | Host | Source | Responsibility |
|---|---|---|---|
| Edge Frontend + Static CDN | **Vercel** | `landing/`, `console/`, `docs/`, `legal/`, `assets/`, `vercel.json` | Global CDN caching, host rewrites (`app.*`, `docs.*`), strict CSP/security headers |
| First-Party API Proxy | **Vercel** | `api/index.js` (`VEYROQ_BACKEND_URL`) | Proxies `/api/*`, `/health`, `/healthz` to persistent Node backend so cookies stay first-party |
| Persistent API & Auth Server | **Railway** or **Render** | `server.js`, `railway.toml`, `render.yaml` | Privy auth proxy, SIWE nonce validation, rate limiting, Pino JSON logs, `/health` |
| On-Chain State | **Circle Arc Testnet** (`5042002`) | `contracts/src/VeyroqRegistry.sol` | Immutable tier subscriptions & `0x8A1D55E8E07fa49edF4c0a420b8B033ad03B37B3` |

### Why Persistent Node Server + Vercel Edge?
- `activeNonces` (single-use SIWE replay defense) and `rateBuckets` (auth abuse protection) require persistent process memory (`server.js`), which serverless lambdas recycle between invocations.
- Setting `VEYROQ_BACKEND_URL=https://api.veyroq.xyz` on Vercel lets browsers call `/api/*` on the same origin without Safari/Chrome third-party cookie blocking.

---

## 2. Environment Matrix

| Variable | Local (`.env`) | Staging (`railway`/`render` + `vercel`) | Production (`railway`/`render` + `vercel`) |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | `production` |
| `VEYROQ_ENV` | `development` | `staging` | `production` |
| `LOG_LEVEL` | `info` | `debug` | `info` |
| `SESSION_SECRET` | Random local hex | Unique 32B hex (`openssl rand -hex 32`) | Unique 32B hex (never shared w/ staging) |
| `PRIVY_APP_ID` | Dev Privy App ID | Dedicated Staging App ID | Production App ID |
| `ARC_RPC_URL` | `https://rpc.testnet.arc.io` | `https://rpc.testnet.arc.io` | Dedicated RPC URL |
| `VEYROQ_REGISTRY_ADDRESS` | Testnet contract | Staging contract | Verified prod contract |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | `https://staging.veyroq.xyz,https://app-staging.veyroq.xyz` | `https://veyroq.xyz,https://app.veyroq.xyz` |
| `VEYROQ_CROSS_SITE_COOKIES` | `false` | `false` (true only if bypassing Vercel proxy) | `false` |
| `VEYROQ_BACKEND_URL` *(Vercel only)* | *(unset)* | `https://veyroq-staging.up.railway.app` *(Preview scope)* | `https://api.veyroq.xyz` *(Production scope)* |

---

## 3. Team Workflow (7–10 Developers)

### GitHub Branch & Environment Protection Settings
Configure these rules under **GitHub -> Settings -> Branches / Environments**:
1. Protect `main` and `staging`:
   - Require Pull Request before merging.
   - Require **1–2 code owner / peer approvals** on `main`.
   - Require status check **`Build, Security & Test Gate`** (`.github/workflows/ci.yml`) to pass before merge.
   - Disable force pushes and branch deletions.
2. Create GitHub Environments **`staging`** and **`production`**:
   - On `production`, optionally enable **Required reviewers** (release captain/lead) before `deploy-production` runs.
3. Disable automatic branch-push deploys directly on Render/Railway (`autoDeploy: false` in `render.yaml`) so **failing tests always block deployment**. Instead, configure CI deploy triggers under **Settings -> Secrets and variables -> Actions**:
   - Secrets (Railway CLI tokens): `RAILWAY_STAGING_TOKEN`, `RAILWAY_PROD_TOKEN` *(or Render URL hooks `STAGING_BACKEND_DEPLOY_HOOK`, `PROD_BACKEND_DEPLOY_HOOK`)*.
   - Secrets (Vercel hooks): `STAGING_FRONTEND_DEPLOY_HOOK`, `PROD_FRONTEND_DEPLOY_HOOK`.
   - Variables: `STAGING_API_URL`, `PROD_API_URL`.

### Daily Developer Flow
1. Create a feature branch: `git checkout -b feat/short-description`
2. Develop and run `npm test` + `npm run test:contracts` locally.
3. Open PR against `staging` -> wait for `quality-gate` green + peer approval -> squash merge.
4. CI triggers `deploy-staging` and verifies `/health`. QA/team validates staging Console & flows.
5. Open release PR `staging -> main` -> team lead approves -> merge triggers `deploy-production` + `/health` smoke check.

---

## 4. Health & Smoke Verification

- **Fast Liveness Check (`200 OK`):**
  ```bash
  curl -fsS https://api.veyroq.xyz/health
  ```
- **Deep Readiness Check (probes Circle Arc RPC, returns `503` if RPC fails):**
  ```bash
  curl -fsS "https://api.veyroq.xyz/health?deep=1"
  ```
- **Vercel Proxy End-to-End Check:**
  ```bash
  curl -fsS https://app.veyroq.xyz/api/health
  ```

---

## 5. Rollback Procedures (<2 Minute SLA)

### A. Roll Back Vercel Frontend (UI, Copy, Assets, Proxy Config)
- **Dashboard:** Vercel Project -> **Deployments** -> find last green deployment -> **`...` -> Instant Rollback**.
- **CLI:**
  ```bash
  vercel rollback <previous-deployment-url> --prod
  ```
-Takes effect globally in seconds without touching backend state.

### B. Roll Back Railway or Render Backend (`server.js`)
- **Railway:** Project -> **Deployments** -> select previous healthy deployment -> **Rollback / Redeploy**.
- **Render:** Service -> **Events / Deploys** -> select last known-good commit -> **Rollback to this deploy**.
- Verify recovery immediately:
  ```bash
  curl -fsS "https://api.veyroq.xyz/health?deep=1"
  ```
- Note: Rolling back `server.js` clears in-memory `activeNonces` and `rateBuckets` safely; on-chain subscriptions on Arc are unaffected. Keep `SESSION_SECRET` unchanged during rollback so logged-in sessions remain valid.

### C. Revert Bad Merge Commit in Git (Clean Forward History)
Never force-push `main`. Revert cleanly so CI validates the revert before redeploying:
```bash
git checkout main && git pull
git revert -m 1 <bad-merge-commit-sha>
git push origin main
```

### D. Smart Contract Regression Handling
Solidity contracts on Arc cannot be rolled back once deployed. If a new contract address causes console/validation issues:
1. Revert `VEYROQ_REGISTRY_ADDRESS` on Railway/Render back to the previous verified contract address (e.g., `0x8A1D55E8E07fa49edF4c0a420b8B033ad03B37B3`).
2. Restart the backend and purge any hardcoded fallback changes in Git if needed.
