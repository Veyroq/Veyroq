# Veyroq Incident Response Playbook

## 1. Severity Levels

| Severity | Definition | Target Response | Target Mitigation |
|---|---|---|---|
| **SEV-1 (Critical)** | `/health` failing, login/Privy outage, wrong contract address served, suspected key/session compromise | < 15 min | < 30 min (or immediate rollback) |
| **SEV-2 (Degraded)** | `/health?deep=1` returns `503` (Arc RPC slow/down), Safe EIP-1271 verification failing, elevated 429s/502s | < 30 min | < 2 hours |
| **SEV-3 (Minor)** | UI layout issue, single non-blocking exporter quirk, docs typo | Next business day | Planned PR |

---

## 2. L1 -> L2 Triage Checklist

1. **Check Backend Liveness & RPC:**
   ```bash
   curl -i "https://api.veyroq.xyz/health?deep=1"
   ```
   - `200` with `arcRpc.ok: true`: API and Arc RPC are healthy; check Vercel proxy or browser console.
   - `503` with `arcRpc.ok: false`: Arc Testnet RPC is unreachable or timing out (`2.5s` threshold).
   - `502 Upstream backend unavailable` from Vercel: `VEYROQ_BACKEND_URL` host (Railway/Render) is down, restarting, or timed out (`10s`).
2. **Check Structured Logs (Railway / Render stdout):**
   Filter JSON logs by `"level":50` (error), `"level":40` (warn), `"statusCode":500`, or match a user's `reqId`.
3. **Check Recent Deployments:**
   Compare deployment timestamp on Vercel and Railway/Render against the start of errors. **Rollback first, debug on staging second.**

---

## 3. Concrete Incident Playbooks

### A. Vercel Returns `502 Upstream backend unavailable`
- **Cause:** Railway/Render backend crashed, failed `/health`, or `VEYROQ_BACKEND_URL` points to a stale URL/missing protocol.
- **Fix:**
  1. Check Railway/Render service logs and deployment status.
  2. Roll back backend deployment if a recent release triggered crash loops.
  3. Confirm Vercel env var `VEYROQ_BACKEND_URL` uses `https://...` with no trailing space.

### B. Auth Cookies / Sessions Not Persisting After Login
- **Cause:** Missing `SESSION_SECRET` across restarts (falls back to random key per boot), or browser calling Railway/Render cross-origin with `VEYROQ_CROSS_SITE_COOKIES=false`.
- **Fix:**
  1. Verify `/health` returns `checks.sessionSecretConfigured: true`.
  2. If using Vercel `/api/*` proxy, verify `VEYROQ_BACKEND_URL` is set on Vercel so requests are same-origin (`SameSite=Lax`).
  3. If calling backend cross-origin without the Vercel proxy, set `VEYROQ_CROSS_SITE_COOKIES=true` AND include the exact frontend origin in `ALLOWED_ORIGINS`.

### C. Safe Multisig / EIP-1271 Treasury Ownership Verification Fails
- **Cause:** Safe contract is deployed on a different chain than Arc Testnet (`5042002`), off-chain message not signed by threshold signers yet, or RPC probe failed.
- **Fix:**
  1. Check `/health?deep=1` for `arcRpc.ok: true`.
  2. Confirm the Safe proxy contract actually exists on `5042002` at the submitted treasury address.
  3. Review Pino warning logs for the specific Safe address (never log signatures or secrets).

### D. Arc RPC Latency Spikes or Rate-Limiting (`503` on `?deep=1`)
- **Fix:**
  1. Swap `ARC_RPC_URL` on Railway/Render to a backup/dedicated RPC endpoint and trigger config reload — no code change needed.

### E. Suspected `SESSION_SECRET` Exposure
- **Fix (SEV-1):**
  1. Immediately rotate `SESSION_SECRET` (`openssl rand -hex 32`) on Railway/Render (forces immediate invalidation of all existing cookies).
  2. Audit git history and logs for leak vector.
  3. Complete post-mortem within 48 hours.

---

## 4. 48-Hour Blameless Post-Mortem Template

Create a copy under `docs/postmortems/YYYY-MM-DD-short-slug.md` within 48 hours of any SEV-1 or SEV-2 incident:

```markdown
# Incident Post-Mortem: [Title]

- **Date / Duration:** YYYY-MM-DD HH:MM UTC to HH:MM UTC (Total: XXm)
- **Severity:** SEV-1 / SEV-2
- **Incident Commander & Responders:** [Names]
- **Commit / Deployment Involved:** [SHA or Deployment ID]

## Summary
[1–3 sentences describing what broke, user impact, and how service was restored.]

## Timeline (UTC)
- HH:MM — Trigger event (e.g., deploy / RPC outage)
- HH:MM — Alert / user report received
- HH:MM — Rollback / mitigation applied
- HH:MM — Verified recovery via `/health?deep=1`

## Root Cause
[Technical explanation focusing on system gaps, not individual blame.]

## What Went Well / What Didn't
- **Went well:** ...
- **Needs improvement:** ...

## Preventive Action Items
| Action | Owner | Due Date | Status |
|---|---|---|---|
| Add regression test for ... | @handle | YYYY-MM-DD | Open |
| Add CI check / monitor for ... | @handle | YYYY-MM-DD | Open |
```
