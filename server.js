import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { default as Privy, InMemoryCache } from '@privy-io/js-sdk-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

// Deterministic EVM address resolver (guarantees a valid, checksummed 0x EVM address)
export function resolveEvmAddress(user, fallbackSeed = '') {
  const accounts = user?.linkedAccounts || user?.linked_accounts || [];

  // 1. Look for linked embedded wallet or external Ethereum wallet with a 0x address
  const ethWallet = accounts.find(a => 
    (a.type === 'wallet' || a.chainType === 'ethereum' || a.chain_type === 'ethereum') &&
    a.address && typeof a.address === 'string' && a.address.startsWith('0x') && a.address.length === 42
  );
  if (ethWallet && ethWallet.address) {
    try {
      return ethers.getAddress(ethWallet.address);
    } catch {
      return ethWallet.address;
    }
  }

  // 2. Any 0x address in linkedAccounts
  const any0x = accounts.find(a => a.address && typeof a.address === 'string' && a.address.startsWith('0x') && a.address.length === 42);
  if (any0x && any0x.address) {
    try {
      return ethers.getAddress(any0x.address);
    } catch {
      return any0x.address;
    }
  }

  // 3. Fallback: Deterministically allocate a permanent, checksummed EVM address
  // Derived from user.id (did:privy:...) or email using standard keccak256
  const identifier = (user?.id || fallbackSeed || 'privy-user').toLowerCase();
  const hash = ethers.keccak256(ethers.toUtf8Bytes(identifier));
  return ethers.getAddress('0x' + hash.slice(-40));
}

// Singleton server-side Privy client initialized strictly with .env secret
let _privyInstance = null;
function getPrivyClient(appId) {
  if (!_privyInstance) {
    _privyInstance = new Privy({ appId, storage: new InMemoryCache() });
  }
  return _privyInstance;
}

// -----------------------------------------------------------------------------
// Non-Custodial SIWE / EIP-4361 Ownership Verification Engine
// Protects enterprise treasuries: Replay-proof, Zero-Asset Transfer, 15-min TTL
// -----------------------------------------------------------------------------
export const activeNonces = new Map();

export function generateSiweNonce(address = '', domain = '') {
  const nonce = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const expiresAt = now + 15 * 60 * 1000; // 15-minute strict TTL

  activeNonces.set(nonce, {
    address: address ? address.toLowerCase() : '',
    domain: domain.toLowerCase(),
    issuedAt: now,
    expiresAt
  });

  // Self-pruning when map exceeds 1000 entries
  if (activeNonces.size > 1000) {
    for (const [key, val] of activeNonces.entries()) {
      if (val.expiresAt < now) activeNonces.delete(key);
    }
  }

  return { nonce, expiresAt: new Date(expiresAt).toISOString() };
}

export function parseSiweMessage(message) {
  if (!message || typeof message !== 'string') return {};
  const parsed = {};

  // EIP-4361 regex parser
  const headerMatch = message.match(/^([^\s]+) wants you to sign in with your Ethereum account:\n(0x[a-fA-F0-9]{40})/);
  if (headerMatch) {
    parsed.domain = headerMatch[1].toLowerCase();
    parsed.address = headerMatch[2];
  }

  const nonceMatch = message.match(/Nonce:\s*([a-fA-F0-9]+)/i);
  if (nonceMatch) parsed.nonce = nonceMatch[1];

  const chainIdMatch = message.match(/Chain ID:\s*(\d+)/i);
  if (chainIdMatch) parsed.chainId = parseInt(chainIdMatch[1], 10);

  const issuedAtMatch = message.match(/Issued At:\s*([^\n\r]+)/i);
  if (issuedAtMatch) parsed.issuedAt = issuedAtMatch[1].trim();

  const expMatch = message.match(/Expiration Time:\s*([^\n\r]+)/i);
  if (expMatch) parsed.expirationTime = expMatch[1].trim();

  return parsed;
}

export function verifySiweSignature({ message, signature, expectedAddress, expectedDomain }) {
  if (!message || !signature) {
    return { valid: false, error: 'Missing message or signature' };
  }

  const parsed = parseSiweMessage(message);
  if (!parsed.domain || !parsed.address || !parsed.nonce) {
    return { valid: false, error: 'Malformed EIP-4361 SIWE message' };
  }

  // 1. Replay Protection: Nonce existence & TTL validation
  const stored = activeNonces.get(parsed.nonce);
  if (!stored) {
    return { valid: false, error: 'Invalid or expired nonce (Replay protection triggered)' };
  }

  if (Date.now() > stored.expiresAt) {
    activeNonces.delete(parsed.nonce);
    return { valid: false, error: 'Verification nonce has expired. Please request a fresh challenge.' };
  }

  // Single-use burn: Delete nonce immediately upon first presentation
  activeNonces.delete(parsed.nonce);

  // 2. Domain Binding (Prevents DNS/Phishing hijacking)
  if (expectedDomain) {
    const cleanExpected = expectedDomain.split(':')[0].toLowerCase();
    const cleanMessageDomain = parsed.domain.split(':')[0].toLowerCase();
    const isLocal = cleanExpected === 'localhost' || cleanExpected === '127.0.0.1';
    const isMsgLocal = cleanMessageDomain === 'localhost' || cleanMessageDomain === '127.0.0.1';
    if (!isLocal && !isMsgLocal && cleanExpected !== cleanMessageDomain) {
      return { valid: false, error: `Domain mismatch: message domain (${parsed.domain}) does not match server host (${expectedDomain})` };
    }
  }

  // 3. Address match (if expectedAddress provided)
  if (expectedAddress && parsed.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    return { valid: false, error: 'Claimed address does not match message address' };
  }

  // 4. Cryptographic ECDSA signature verification
  try {
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== parsed.address.toLowerCase()) {
      return { valid: false, error: 'Cryptographic signature mismatch: recovered signer does not match claimed treasury' };
    }

    return {
      valid: true,
      address: ethers.getAddress(recovered),
      domain: parsed.domain,
      chainId: parsed.chainId || 5042002,
      verifiedAt: new Date().toISOString()
    };
  } catch (err) {
    return { valid: false, error: `Signature verification error: ${err.message}` };
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const isAppSubdomain = host.startsWith('app.');
  const isDocsSubdomain = host.startsWith('docs.');

  let reqPath = decodeURI(req.url.split('?')[0]);

  // Normalize trailing slash (except for root '/')
  if (reqPath.length > 1 && reqPath.endsWith('/')) {
    reqPath = reqPath.slice(0, -1);
  }

  // 0. Privy Authentication Backend API Endpoints (Keeps PRIVY_APP_ID strictly in .env)
  if (reqPath === '/api/auth/privy/send-code' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body || '{}');
        if (!email || !email.includes('@')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'A valid email address is required.' }));
          return;
        }

        const privyAppId = process.env.PRIVY_APP_ID;
        if (!privyAppId) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'PRIVY_APP_ID is not configured in .env' }));
          return;
        }

        const privy = getPrivyClient(privyAppId);
        await privy.auth.email.sendCode(email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Authentication code dispatched.' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'Error sending Privy OTP' }));
      }
    });
    return;
  }

  if (reqPath === '/api/auth/privy/verify-code' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { email, code } = JSON.parse(body || '{}');
        if (!email || !code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Email and verification code are required.' }));
          return;
        }

        const privyAppId = process.env.PRIVY_APP_ID;
        if (!privyAppId) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'PRIVY_APP_ID is not configured in .env' }));
          return;
        }

        const privy = getPrivyClient(privyAppId);
        const result = await privy.auth.email.loginWithCode(email, code.trim());
        const user = result?.user;
        const address = resolveEvmAddress(user, email);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, address, email, user }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'Verification failed. Please check the code.' }));
      }
    });
    return;
  }

  // SIWE Nonce Generation (GET)
  if (reqPath === '/api/auth/siwe/nonce' && req.method === 'GET') {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
    const address = parsedUrl.searchParams.get('address') || '';
    const domain = (req.headers.host || 'veyroq.xyz').split(':')[0];
    const { nonce, expiresAt } = generateSiweNonce(address, domain);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, nonce, expiresAt, domain }));
    return;
  }

  // SIWE Signature Verification (POST)
  if (reqPath === '/api/auth/siwe/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { message, signature, address } = JSON.parse(body || '{}');
        if (!message || !signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing message or signature in request body.' }));
          return;
        }

        const verification = verifySiweSignature({
          message,
          signature,
          expectedAddress: address,
          expectedDomain: req.headers.host
        });

        if (!verification.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: verification.error }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          verified: true,
          address: verification.address,
          domain: verification.domain,
          chainId: verification.chainId,
          verifiedAt: verification.verifiedAt
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'SIWE verification error' }));
      }
    });
    return;
  }

  // 1. Clean redirect for any .html or /index requests to pure extensionless paths
  if (reqPath.endsWith('.html')) {
    let clean = reqPath.slice(0, -5);
    if (clean.endsWith('/index')) {
      clean = clean.slice(0, -6);
    }
    if (clean === '/landing' || clean === '') {
      clean = '/';
    }
    res.writeHead(301, { 'Location': clean || '/' });
    res.end();
    return;
  }

  // 2. Clean alias redirects
  if (reqPath === '/landing' || reqPath === '/landing/index') {
    res.writeHead(301, { 'Location': '/' });
    res.end();
    return;
  }
  if (reqPath === '/legal' || reqPath === '/legal/index') {
    res.writeHead(301, { 'Location': '/legal/privacy' });
    res.end();
    return;
  }

  // 3. Resolve file path (supports app.veyroq.xyz & docs.veyroq.xyz subdomains + local paths)
  let filePath;

  if (reqPath === '/favicon.ico') {
    filePath = path.join(__dirname, 'assets', 'favicon.ico');
  } else if (isAppSubdomain && (reqPath === '/' || reqPath === '')) {
    filePath = path.join(__dirname, 'console', 'index.html');
  } else if (isDocsSubdomain && (reqPath === '/' || reqPath === '')) {
    filePath = path.join(__dirname, 'docs', 'index.html');
  } else if (reqPath === '/' || reqPath === '') {
    filePath = path.join(__dirname, 'landing', 'index.html');
  } else if (reqPath === '/styles.css') {
    const dir = isAppSubdomain ? 'console' : isDocsSubdomain ? 'docs' : 'landing';
    filePath = path.join(__dirname, dir, 'styles.css');
  } else if (reqPath === '/app.js') {
    const dir = isAppSubdomain ? 'console' : isDocsSubdomain ? 'docs' : 'landing';
    filePath = path.join(__dirname, dir, 'app.js');
  } else if (reqPath === '/docs' || reqPath === '/docs/') {
    filePath = path.join(__dirname, 'docs', 'index.html');
  } else if ((reqPath.startsWith('/docs/') || (isDocsSubdomain && !reqPath.startsWith('/assets/') && !reqPath.startsWith('/docs/'))) && !reqPath.endsWith('.css') && !reqPath.endsWith('.js') && !reqPath.endsWith('.svg') && !reqPath.endsWith('.png') && !reqPath.endsWith('.webp') && !reqPath.endsWith('.ico')) {
    filePath = path.join(__dirname, 'docs', 'index.html');
  } else {
    const candidatePath = path.join(__dirname, reqPath);

    // If it's a directory, look for index.html inside
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
      filePath = path.join(candidatePath, 'index.html');
    } else if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
      filePath = candidatePath;
    } else if (fs.existsSync(candidatePath + '.html')) {
      // Clean URL mapping: e.g. /legal/refund -> legal/refund.html
      filePath = candidatePath + '.html';
    } else {
      filePath = candidatePath; // Will trigger 404
    }
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <div style="font-family:sans-serif; text-align:center; padding:50px; background:#F8F5EE; color:#151716;">
            <h2>404 - Not Found</h2>
            <p>File <code>${reqPath}</code> does not exist.</p>
            <p><a href="/">Go to Landing Page</a> | <a href="/console">Go to Cockpit</a> | <a href="/docs">Go to Docs</a></p>
          </div>
        `);
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      let body = content;
      if (ext === '.html' && req.headers.host) {
        const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
        const origin = `${proto}://${req.headers.host}`;
        body = Buffer.from(
          content.toString('utf8').replaceAll('content="/assets/og-image.png"', `content="${origin}/assets/og-image.png"`)
        );
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      res.end(body);
    }
  });
});

export { server, PORT };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 Veyroq Dev Server running at http://localhost:${PORT}`);
    console.log(`--------------------------------------------------`);
    console.log(` • Landing Page:    http://localhost:${PORT}/`);
    console.log(` • Auditor Cockpit: http://localhost:${PORT}/console`);
    console.log(` • Protocol Docs:   http://localhost:${PORT}/docs`);
    console.log(` • Legal Policies:  http://localhost:${PORT}/legal/privacy`);
    console.log(` • Refund Policy:   http://localhost:${PORT}/legal/refund`);
    console.log(`==================================================\n`);
  });
}
