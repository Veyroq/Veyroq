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
