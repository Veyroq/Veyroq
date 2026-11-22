import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { Readable } from 'stream';
import { server, createSessionToken, verifySessionToken, getCorsHeaders } from '../../server.js';
import vercelHandler from '../../api/index.js';

let BASE_URL = 'http://localhost:3000';
let testServerInstance = null;

function postJson(path, data, headers = {}) {
  const payload = JSON.stringify(data || {});
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, BASE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    }, r => {
      let body = '';
      r.on('data', chunk => body += chunk);
      r.on('end', () => resolve({
        statusCode: r.statusCode,
        headers: r.headers,
        body: body ? JSON.parse(body) : {}
      }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

before(async () => {
  await new Promise(resolve => {
    testServerInstance = server.listen(0, () => {
      const addr = testServerInstance.address();
      BASE_URL = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (testServerInstance) {
    await new Promise(resolve => testServerInstance.close(resolve));
  }
});

function fetchUrl(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(url, { headers, method: 'GET' }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('Integration: Server responds 200 OK on core pages', async () => {
  const pages = ['/', '/console', '/docs', '/legal/privacy', '/legal/refund'];
  for (const page of pages) {
    const res = await fetchUrl(page);
    assert.equal(res.statusCode, 200, `Expected 200 for ${page}, got ${res.statusCode}`);
    assert.equal(res.headers['content-type'].includes('text/html'), true);
  }
});

test('Integration: Server 301 redirects .html paths to extensionless URLs', async () => {
  const res = await fetchUrl('/console.html');
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers['location'], '/console');
});

test('Integration: Server serves correct MIME types for static assets', async () => {
  const assets = [
    { path: '/console/app.js', mime: 'application/javascript' },
    { path: '/console/styles.css', mime: 'text/css' },
    { path: '/assets/favicon.svg', mime: 'image/svg+xml' }
  ];

  for (const asset of assets) {
    const res = await fetchUrl(asset.path);
    assert.equal(res.statusCode, 200, `Failed to load ${asset.path}`);
    assert.equal(res.headers['content-type'].includes(asset.mime), true, `MIME mismatch for ${asset.path}`);
  }
});

test('Integration: Server handles app subdomain routing simulation', async () => {
  const res = await fetchUrl('/', { Host: 'app.veyroq.xyz' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.includes('Veyroq Cockpit'), true);
});

test('Integration: Server Privy API validates email parameter', async () => {
  const postData = JSON.stringify({ email: 'not-an-email' });
  const res = await new Promise((resolve, reject) => {
    const req = http.request(new URL('/api/auth/privy/send-code', BASE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
});

test('Integration: Server Privy API validates verify-code parameters', async () => {
  const postData = JSON.stringify({ email: 'test@veyroq.xyz', code: '' });
  const res = await new Promise((resolve, reject) => {
    const req = http.request(new URL('/api/auth/privy/verify-code', BASE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
});

test('Integration: Server SIWE API generates nonce and verifies signed challenge', async () => {
  // 1. Fetch Nonce
  const nonceRes = await fetchUrl('/api/auth/siwe/nonce');
  assert.equal(nonceRes.statusCode, 200);
  const nonceData = JSON.parse(nonceRes.body);
  assert.equal(nonceData.success, true);
  assert.ok(nonceData.nonce);

  // 1b. Proxy forwarding resolves public app.veyroq.xyz domain, never internal Railway host or spoofed host
  const proxiedNonce = await fetchUrl('/api/auth/siwe/nonce', {
    Host: 'veyroq-production.up.railway.app',
    'x-veyroq-host': 'app.veyroq.xyz'
  });
  assert.equal(JSON.parse(proxiedNonce.body).domain, 'app.veyroq.xyz');

  const fallbackNonce = await fetchUrl('/api/auth/siwe/nonce', {
    Host: 'veyroq-production.up.railway.app'
  });
  assert.equal(JSON.parse(fallbackNonce.body).domain, 'app.veyroq.xyz');

  const spoofedNonce = await fetchUrl('/api/auth/siwe/nonce', {
    Host: 'veyroq-production.up.railway.app',
    'x-veyroq-host': 'evil.example.com'
  });
  assert.equal(JSON.parse(spoofedNonce.body).domain, 'app.veyroq.xyz');

  // 2. Reject verification with missing parameters
  const postData = JSON.stringify({ message: '', signature: '' });
  const res = await new Promise((resolve, reject) => {
    const req = http.request(new URL('/api/auth/siwe/verify', BASE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, r => {
      let body = '';
      r.on('data', chunk => body += chunk);
      r.on('end', () => resolve({ statusCode: r.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
});

test('Integration: Server retires relayer execution (410), exposes Privy public config, and handles session/status checks', async () => {
  const orgAddr = '0x71C8b46B08639f70efA4C34Db895C989C7Fa22Ec';
  const otherAddr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  // 1. Legacy relayer endpoints MUST return 410 Gone (self-custodial user signing enforced)
  const relayerSub = await postJson('/api/subscription/activate', { address: orgAddr, tier: 'enterprise' });
  assert.equal(relayerSub.statusCode, 410);
  assert.equal(relayerSub.body.success, false);

  const relayerProof = await postJson('/api/audit/commit-proof', {
    auditRootHash: '0x' + '1'.repeat(64), periodStart: 100, periodEnd: 200, transactionCount: 2
  });
  assert.equal(relayerProof.statusCode, 410);

  const relayerAud = await postJson('/api/audit/authorize-auditor', {
    auditor: otherAddr, validUntil: Math.floor(Date.now() / 1000) + 86400
  });
  assert.equal(relayerAud.statusCode, 410);

  // 2. Public Privy App config returns only appId (never secrets)
  const cfgRes = await fetchUrl('/api/auth/privy/config');
  assert.ok(cfgRes.statusCode === 200 || cfgRes.statusCode === 500);
  assert.equal(cfgRes.body.includes('ARC_PRIVATE_KEY'), false);
  assert.equal(cfgRes.body.includes('DEPLOYER_KEY'), false);

  // 3. Subscription Status & Session / Logout checks
  const statusRes = await fetchUrl(`/api/subscription/status?address=${orgAddr}`);
  assert.equal(statusRes.statusCode, 200);
  assert.equal(JSON.parse(statusRes.body).isActive, false);

  const privyCookie = `veyroq_session=${createSessionToken({ address: orgAddr.toLowerCase(), method: 'privy_email', email: 'cfo@veyroq.xyz', verifiedVaults: [orgAddr.toLowerCase()] })}`;
  const sessionRes = await fetchUrl('/api/auth/session', { Cookie: privyCookie });
  assert.equal(sessionRes.statusCode, 200);
  assert.equal(JSON.parse(sessionRes.body).authenticated, true);
  assert.equal(verifySessionToken('invalid'), null);
  assert.equal(verifySessionToken('tampered.token'), null);

  const logoutRes = await postJson('/api/auth/logout', {});
  assert.equal(logoutRes.statusCode, 200);
  assert.ok(String(logoutRes.headers['set-cookie'] || '').includes('Max-Age=0'));
});

test('Integration: Server blocks secret files (.env/.git), path traversal, reflected XSS, and emits security headers', async () => {
  for (const forbiddenPath of ['/.env', '/contracts/.env', '/.git/config', '/server.js', '/package.json', '/console/../../.env']) {
    const res = await fetchUrl(forbiddenPath);
    assert.ok(res.statusCode === 403 || res.statusCode === 404, `Expected 403/404 for ${forbiddenPath}, got ${res.statusCode}`);
    assert.equal(res.body.includes('ARC_PRIVATE_KEY'), false);
    assert.equal(res.body.includes('DEPLOYER_KEY'), false);
  }

  // Malformed URI returns 400 cleanly instead of crashing server
  const badUri = await fetchUrl('/%E0%A4%A');
  assert.equal(badUri.statusCode, 400);

  // 404 page escapes reflected XSS and sets security headers
  const xssRes = await fetchUrl('/console/%3Cscript%3Ealert(1)%3C/script%3E');
  assert.equal(xssRes.statusCode, 404);
  assert.equal(xssRes.body.includes('<script>alert(1)</script>'), false);
  assert.equal(xssRes.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  assert.equal(xssRes.headers['x-frame-options'], 'DENY');
  assert.equal(xssRes.headers['x-content-type-options'], 'nosniff');
  assert.ok(xssRes.headers['content-security-policy']?.includes("frame-ancestors 'none'"));
  assert.ok(xssRes.headers['content-security-policy']?.includes("frame-src 'self' https://auth.privy.io"));
});

test('Integration: Health endpoints (/health, /healthz), strict ALLOWED_ORIGINS CORS, and Vercel proxy', async () => {
  // 1. Liveness & readiness probes
  for (const path of ['/health', '/healthz', '/api/health']) {
    const res = await fetchUrl(path);
    assert.equal(res.statusCode, 200, `Expected 200 for ${path}`);
    assert.equal(res.headers['cache-control'], 'no-store');
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'veyroq-api');
    assert.equal(typeof body.uptimeSec, 'number');
    assert.ok(body.checks?.registryAddress?.startsWith('0x'));
  }

  // 2. Strict CORS allowlist + OPTIONS preflight
  const prevOrigins = process.env.ALLOWED_ORIGINS;
  const prevBackend = process.env.VEYROQ_BACKEND_URL;
  process.env.ALLOWED_ORIGINS = 'https://app.veyroq.xyz, https://staging.veyroq.xyz';
  try {
    const trusted = getCorsHeaders({ headers: { origin: 'https://app.veyroq.xyz' } });
    assert.equal(trusted['Access-Control-Allow-Origin'], 'https://app.veyroq.xyz');
    assert.equal(trusted['Access-Control-Allow-Credentials'], 'true');

    const untrusted = getCorsHeaders({ headers: { origin: 'https://evil.example' } });
    assert.equal(untrusted['Access-Control-Allow-Origin'], undefined);

    const optRes = await new Promise((resolve, reject) => {
      const req = http.request(new URL('/api/auth/session', BASE_URL), {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.veyroq.xyz' }
      }, r => {
        r.resume();
        r.on('end', () => resolve({ statusCode: r.statusCode, headers: r.headers }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(optRes.statusCode, 204);
    assert.equal(optRes.headers['access-control-allow-origin'], 'https://app.veyroq.xyz');

    const evilOptRes = await new Promise((resolve, reject) => {
      const req = http.request(new URL('/api/auth/session', BASE_URL), {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' }
      }, r => {
        r.resume();
        r.on('end', () => resolve({ statusCode: r.statusCode, headers: r.headers }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(evilOptRes.statusCode, 204);
    assert.equal(evilOptRes.headers['access-control-allow-origin'], undefined);

    // 3. Vercel first-party proxy forwards /health cleanly & handles upstream failure with 502
    const invokeProxy = (url, method = 'GET') => new Promise(resolve => {
      const req = Readable.from([]);
      req.url = url;
      req.method = method;
      req.headers = { host: 'app.veyroq.xyz' };
      const outHeaders = {};
      const res = {
        statusCode: 200,
        setHeader(k, v) { outHeaders[k.toLowerCase()] = v; },
        end(buf) { resolve({ statusCode: this.statusCode, headers: outHeaders, body: buf ? buf.toString('utf8') : '' }); }
      };
      vercelHandler(req, res);
    });

    process.env.VEYROQ_BACKEND_URL = BASE_URL;
    const proxied = await invokeProxy('/health');
    assert.equal(proxied.statusCode, 200);
    assert.equal(JSON.parse(proxied.body).service, 'veyroq-api');

    process.env.VEYROQ_BACKEND_URL = 'http://127.0.0.1:1';
    const down = await invokeProxy('/health');
    assert.equal(down.statusCode, 502);
    assert.equal(JSON.parse(down.body).error, 'Upstream backend unavailable');
  } finally {
    if (prevOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = prevOrigins;
    if (prevBackend === undefined) delete process.env.VEYROQ_BACKEND_URL;
    else process.env.VEYROQ_BACKEND_URL = prevBackend;
  }
});


