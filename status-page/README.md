# Veyroq Standalone Status Page (`status-page/`)

This folder is completely **self-contained** (zero dependencies on `server.js` or `node_modules`) so it stays online even if Vercel Edge or the Railway/Render API backend goes down.

## Recommended Separate Deployment (`status.veyroq.xyz`)

Host this directory on an **independent provider** from your main app (for example **Cloudflare Pages**, **Netlify**, or **GitHub Pages** in a dedicated `veyroq-status` repo):

1. Set the publish/output directory to `status-page` (build command: none).
2. Attach custom domain `status.veyroq.xyz`.
3. Add `https://status.veyroq.xyz` to `ALLOWED_ORIGINS` on your Railway/Render backend so browser `/health` and `/health?deep=1` checks succeed via CORS.
4. For automated 24/7 external alerting + historical uptime, pair with an external monitor (Better Stack / Upptime / Checkly) polling `https://api.veyroq.xyz/health?deep=1`.

## Local Preview

Run the API backend on port `3000` (`npm run dev`) with `ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001`, then serve `status-page/` independently on port `3001`:

```bash
python3 -m http.server 3001 --directory status-page
```

Open `http://localhost:3001/?api=http://localhost:3000`.
*(Note: for production independence, always deploy `status-page/` separately from the main server.)*
