import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

const BASE_URL = 'http://localhost:3000';

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


