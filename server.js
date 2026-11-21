import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import pino from 'pino';
import { default as Privy, InMemoryCache } from '@privy-io/js-sdk-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

function isTestMode() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes('--test') || process.env.NODE_ENV === 'test';
}

export const logger = pino({
  level: isTestMode() ? 'silent' : (process.env.LOG_LEVEL || 'info'),
  base: {
    service: 'veyroq-api',
    env: process.env.VEYROQ_ENV || process.env.NODE_ENV || 'development'
  },
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'signature', 'ARC_PRIVATE_KEY', 'DEPLOYER_KEY', 'SESSION_SECRET'],
    censor: '[REDACTED]'
  }
});

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
const rateBuckets = new Map();
const MAX_NONCE_CACHE = 5000;
const DEFAULT_REGISTRY = '0x8A1D55E8E07fa49edF4c0a420b8B033ad03B37B3';
const SESSION_COOKIE_NAME = 'veyroq_session';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PUBLIC_ROOTS = ['landing', 'console', 'docs', 'legal', 'assets'];

export function escapeHtml(val) {
  return String(val ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

export function createSessionToken(payload, ttlMs = 24 * 60 * 60 * 1000) {
  const data = { ...payload, exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed || !parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getSessionFromRequest(req) {
  const rawCookie = req.headers.cookie || '';
  for (const part of rawCookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === SESSION_COOKIE_NAME) {
      return verifySessionToken(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function buildSessionCookieHeader(req, token, maxAgeSec = 86400) {
  const isHttps = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket?.encrypted);
  const sameSite = (process.env.VEYROQ_CROSS_SITE_COOKIES === 'true' && isHttps) ? 'SameSite=None' : 'SameSite=Lax';
  const parts = [`${SESSION_COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', sameSite, `Max-Age=${maxAgeSec}`];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

export function getCorsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (configured.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
  }
  return {};
}

function getSecurityHeaders(req) {
  const headers = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; frame-src 'self' https://auth.privy.io; child-src 'self' https://auth.privy.io; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://auth.privy.io https://arc-testnet.rpc.privy.systems https://rpc.testnet.arc.io https://explorer.testnet.arc.io https://sepolia.base.org https://testnet-rpc.monad.xyz https://sepolia-rollup.arbitrum.io https://ethereum-sepolia-rpc.publicnode.com"
  };
  if (req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

function sendJson(req, res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...getSecurityHeaders(req),
    ...getCorsHeaders(req),
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(key, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    if (rateBuckets.size > 5000) rateBuckets.clear();
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function readJsonBody(req, maxBytes = 16384) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        const err = new Error('Request payload too large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const err = new Error('Malformed JSON request body');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', err => {
      if (!aborted) reject(err);
    });
  });
}

function getRegistryContext() {
  return {
    rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.io',
    registryAddr: process.env.VEYROQ_REGISTRY_ADDRESS || DEFAULT_REGISTRY
  };
}

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

  // Self-pruning when map exceeds 1000 entries, plus strict cap to prevent memory DoS
  if (activeNonces.size > 1000) {
    for (const [key, val] of activeNonces.entries()) {
      if (val.expiresAt < now) activeNonces.delete(key);
    }
    while (activeNonces.size > MAX_NONCE_CACHE) {
      const oldestKey = activeNonces.keys().next().value;
      if (!oldestKey) break;
      activeNonces.delete(oldestKey);
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

function validateSiweEnvelope({ message, signature, expectedAddress, expectedDomain }) {
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

  // 2. Domain Binding (Only allow localhost/127.0.0.1 equivalence when BOTH host and message are local)
  if (expectedDomain) {
    const cleanExpected = expectedDomain.split(':')[0].toLowerCase();
    const cleanMessageDomain = parsed.domain.split(':')[0].toLowerCase();
    const isLocal = cleanExpected === 'localhost' || cleanExpected === '127.0.0.1';
    const isMsgLocal = cleanMessageDomain === 'localhost' || cleanMessageDomain === '127.0.0.1';
    if (cleanExpected !== cleanMessageDomain && !(isLocal && isMsgLocal)) {
      return { valid: false, error: `Domain mismatch: message domain (${parsed.domain}) does not match server host (${expectedDomain})` };
    }
  }

  // 3. Address match (if expectedAddress provided)
  if (expectedAddress && parsed.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    return { valid: false, error: 'Claimed address does not match message address' };
  }

  return { valid: true, parsed };
}

export function verifySiweSignature({ message, signature, expectedAddress, expectedDomain }) {
  const envelope = validateSiweEnvelope({ message, signature, expectedAddress, expectedDomain });
  if (!envelope.valid) return envelope;
  const { parsed } = envelope;

  // 4. Cryptographic ECDSA signature verification
  try {
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== parsed.address.toLowerCase()) {
      return { valid: false, error: 'Cryptographic signature mismatch: recovered signer does not match claimed treasury' };
    }

    return {
      valid: true,
      role: 'eoa',
      address: ethers.getAddress(recovered),
      signer: ethers.getAddress(recovered),
      domain: parsed.domain,
      chainId: parsed.chainId || 5042002,
      verifiedAt: new Date().toISOString()
    };
  } catch (err) {
    return { valid: false, error: `Signature verification error: ${err.message}` };
  }
}

const CHAIN_RPCS = {
  5042002: () => process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.io',
  8453: () => 'https://sepolia.base.org',
  84532: () => 'https://sepolia.base.org',
  421614: () => 'https://sepolia-rollup.arbitrum.io/rpc',
  1: () => 'https://ethereum-sepolia-rpc.publicnode.com',
  11155111: () => 'https://ethereum-sepolia-rpc.publicnode.com',
  10143: () => 'https://testnet-rpc.monad.xyz'
};

// Verifies EOA signature OR Safe Multisig owner (Safe.isOwner) OR EIP-1271 smart contract signature
export async function verifyVaultOwnershipSiwe({ message, signature, expectedAddress, expectedDomain, provider = null }) {
  const envelope = validateSiweEnvelope({ message, signature, expectedAddress, expectedDomain });
  if (!envelope.valid) return envelope;
  const { parsed } = envelope;
  const chainId = parsed.chainId || 5042002;

  let recovered = null;
  let verifyErr = null;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch (err) {
    verifyErr = err;
  }

  if (recovered && recovered.toLowerCase() === parsed.address.toLowerCase()) {
    const addr = ethers.getAddress(recovered);
    return { valid: true, role: 'eoa', address: addr, signer: addr, domain: parsed.domain, chainId, verifiedAt: new Date().toISOString() };
  }

  try {
    const rpcUrl = (CHAIN_RPCS[chainId] || CHAIN_RPCS[5042002])();
    const activeProvider = provider || new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    const vaultAddr = ethers.getAddress(parsed.address);
    const code = await activeProvider.getCode(vaultAddr);

    if (!code || code === '0x') {
      if (verifyErr) return { valid: false, error: `Signature verification error: ${verifyErr.message}` };
      return { valid: false, error: 'Cryptographic signature mismatch: recovered signer does not match claimed treasury' };
    }

    if (recovered) {
      try {
        const safe = new ethers.Contract(vaultAddr, ['function isOwner(address) view returns (bool)'], activeProvider);
        if (await safe.isOwner(recovered)) {
          return {
            valid: true,
            role: 'safe_owner',
            address: vaultAddr,
            signer: ethers.getAddress(recovered),
            domain: parsed.domain,
            chainId,
            verifiedAt: new Date().toISOString()
          };
        }
      } catch {}
    }

    try {
      const eip1271 = new ethers.Contract(vaultAddr, ['function isValidSignature(bytes32,bytes) view returns (bytes4)'], activeProvider);
      const magic = await eip1271.isValidSignature(ethers.hashMessage(message), signature);
      if (String(magic).toLowerCase() === '0x1626ba7e') {
        return {
          valid: true,
          role: 'eip1271',
          address: vaultAddr,
          signer: recovered ? ethers.getAddress(recovered) : vaultAddr,
          domain: parsed.domain,
          chainId,
          verifiedAt: new Date().toISOString()
        };
      }
    } catch {}

    return {
      valid: false,
      error: recovered
        ? `Signer (${recovered.slice(0, 6)}...${recovered.slice(-4)}) is not an active on-chain owner of Safe treasury ${vaultAddr.slice(0, 6)}...${vaultAddr.slice(-4)}`
        : 'Smart-contract signature verification (Safe.isOwner / EIP-1271) failed.'
    };
  } catch (err) {
    return { valid: false, error: `Treasury contract verification error: ${err.message}` };
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
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

function sanitizeOrigin(req) {
  const rawProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const hostHeader = String(req.headers.host || '').trim();
  if (!/^[a-zA-Z0-9.-]+(:[0-9]{1,5})?$/.test(hostHeader)) return null;
  const hostOnly = hostHeader.split(':')[0].toLowerCase();
  const proto = (rawProto === 'http' || rawProto === 'https')
    ? rawProto
    : ((hostOnly === 'localhost' || hostOnly.startsWith('127.')) ? 'http' : 'https');
  return `${proto}://${hostHeader}`;
}

function resolveSafePublicFile(reqPath, rootDir) {
  const rel = reqPath.replace(/^\/+/, '');
  const topSeg = rel.split('/')[0];
  if (!PUBLIC_ROOTS.includes(topSeg)) {
    return null;
  }
  const baseDir = path.resolve(rootDir, topSeg);
  const candidate = path.resolve(rootDir, rel);
  if (candidate !== baseDir && !candidate.startsWith(baseDir + path.sep)) {
    return null;
  }
  return candidate;
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const reqId = crypto.randomBytes(6).toString('hex');
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const isAppSubdomain = host.startsWith('app.');
  const isDocsSubdomain = host.startsWith('docs.');

  const rawPath = (req.url || '/').split('?')[0];
  res.on('finish', () => {
    logger.info({
      event: 'http_request',
      reqId,
      method: req.method,
      path: rawPath,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...getSecurityHeaders(req), ...getCorsHeaders(req) });
    res.end();
    return;
  }

  let reqPath;
  try {
    reqPath = decodeURI(rawPath);
  } catch {
    return sendJson(req, res, 400, { success: false, error: 'Malformed URI path.' });
  }

  // Block null bytes, backslashes, parent traversal, and dotfiles (/.env, /.git, etc.)
  const segments = reqPath.split('/').filter(Boolean);
  if (reqPath.includes('\0') || reqPath.includes('\\') || segments.some(s => s === '..' || s === '.' || s.startsWith('.'))) {
    return sendJson(req, res, 403, { success: false, error: 'Forbidden path.' });
  }

  // Normalize trailing slash (except for root '/')
  if (reqPath.length > 1 && reqPath.endsWith('/')) {
    reqPath = reqPath.slice(0, -1);
  }

  const clientIp = getClientIp(req);

  // Healthcheck & Readiness Endpoint (/health, /healthz, optional ?deep=1 RPC probe)
  if ((reqPath === '/health' || reqPath === '/healthz' || reqPath === '/api/health') && req.method === 'GET') {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const deep = parsedUrl.searchParams.get('deep') === '1';
    const { rpcUrl, registryAddr } = getRegistryContext();
    const checks = {
      privyConfigured: Boolean(process.env.PRIVY_APP_ID),
      sessionSecretConfigured: Boolean(process.env.SESSION_SECRET),
      registryAddress: registryAddr
    };

    let statusCode = 200;
    let status = 'ok';
    if (deep && !isTestMode()) {
      const rpcStart = Date.now();
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl, 5042002, { staticNetwork: true });
        const blockNumber = await Promise.race([
          provider.getBlockNumber(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Arc RPC probe timeout')), 2500))
        ]);
        checks.arcRpc = { ok: true, blockNumber, latencyMs: Date.now() - rpcStart };
      } catch (err) {
        status = 'degraded';
        statusCode = 503;
        checks.arcRpc = { ok: false, error: err.message, latencyMs: Date.now() - rpcStart };
      }
    }

    return sendJson(req, res, statusCode, {
      status,
      service: 'veyroq-api',
      environment: process.env.VEYROQ_ENV || process.env.NODE_ENV || 'development',
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks
    });
  }

  // 0. Session Inspection & Logout Endpoints
  if (reqPath === '/api/auth/session' && req.method === 'GET') {
    const session = getSessionFromRequest(req);
    if (!session) {
      return sendJson(req, res, 200, { authenticated: false, address: null, method: null, verifiedVaults: [] });
    }
    return sendJson(req, res, 200, {
      authenticated: true,
      address: session.address || null,
      method: session.method || null,
      email: session.email || null,
      verifiedVaults: Array.isArray(session.verifiedVaults) ? session.verifiedVaults : []
    });
  }

  if (reqPath === '/api/auth/logout' && req.method === 'POST') {
    return sendJson(req, res, 200, { success: true }, {
      'Set-Cookie': buildSessionCookieHeader(req, '', 0)
    });
  }

  // 0a. Public Privy App ID Config + OTP Auth Endpoints
  if (reqPath === '/api/auth/privy/config' && req.method === 'GET') {
    const cfgLimit = checkRateLimit(`privy-cfg:${clientIp}`, 60, 60_000);
    if (!cfgLimit.allowed) {
      return sendJson(req, res, 429, { success: false, error: 'Too many requests.' }, { 'Retry-After': String(cfgLimit.retryAfterSec) });
    }
    const privyAppId = process.env.PRIVY_APP_ID;
    if (!privyAppId) {
      return sendJson(req, res, 500, { success: false, error: 'Privy authentication is not configured.' });
    }
    return sendJson(req, res, 200, { success: true, appId: privyAppId });
  }

  if (reqPath === '/api/auth/privy/send-code' && req.method === 'POST') {
    const ipLimit = checkRateLimit(`send-code-ip:${clientIp}`, 30, 60_000);
    if (!ipLimit.allowed) {
      return sendJson(req, res, 429, { success: false, error: 'Too many OTP requests. Please wait before retrying.' }, { 'Retry-After': String(ipLimit.retryAfterSec) });
    }
    try {
      const { email } = await readJsonBody(req);
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return sendJson(req, res, 400, { success: false, error: 'A valid email address is required.' });
      }
      const emailLimit = checkRateLimit(`send-code-email:${email.trim().toLowerCase()}`, 5, 60_000);
      if (!emailLimit.allowed) {
        return sendJson(req, res, 429, { success: false, error: 'Too many OTP requests for this email.' }, { 'Retry-After': String(emailLimit.retryAfterSec) });
      }
      const privyAppId = process.env.PRIVY_APP_ID;
      if (!privyAppId) {
        return sendJson(req, res, 500, { success: false, error: 'Privy authentication is not configured.' });
      }
      const privy = getPrivyClient(privyAppId);
      await privy.auth.email.sendCode(email);
      return sendJson(req, res, 200, { success: true, message: 'Authentication code dispatched.' });
    } catch (err) {
      return sendJson(req, res, err.statusCode || 500, { success: false, error: err.message || 'Error sending Privy OTP' });
    }
  }

  if (reqPath === '/api/auth/privy/verify-code' && req.method === 'POST') {
    const verifyLimit = checkRateLimit(`verify-code:${clientIp}`, 30, 60_000);
    if (!verifyLimit.allowed) {
      return sendJson(req, res, 429, { success: false, error: 'Too many verification attempts.' }, { 'Retry-After': String(verifyLimit.retryAfterSec) });
    }
    try {
      const { email, code } = await readJsonBody(req);
      if (!email || typeof email !== 'string' || !code || typeof code !== 'string') {
        return sendJson(req, res, 400, { success: false, error: 'Email and verification code are required.' });
      }
      const privyAppId = process.env.PRIVY_APP_ID;
      if (!privyAppId) {
        return sendJson(req, res, 500, { success: false, error: 'Privy authentication is not configured.' });
      }
      const privy = getPrivyClient(privyAppId);
      const result = await privy.auth.email.loginWithCode(email, code.trim());
      const user = result?.user;
      const address = resolveEvmAddress(user, email);

      const token = createSessionToken({
        address: address.toLowerCase(),
        method: 'privy_email',
        email,
        verifiedVaults: [address.toLowerCase()]
      });

      return sendJson(req, res, 200, { success: true, address, email, user }, {
        'Set-Cookie': buildSessionCookieHeader(req, token)
      });
    } catch (err) {
      return sendJson(req, res, err.statusCode || 400, { success: false, error: err.message || 'Verification failed. Please check the code.' });
    }
  }

  // 0b. SIWE Nonce Generation (GET) & Signature Verification (POST)
  if (reqPath === '/api/auth/siwe/nonce' && req.method === 'GET') {
    const nonceLimit = checkRateLimit(`siwe-nonce:${clientIp}`, 60, 60_000);
    if (!nonceLimit.allowed) {
      return sendJson(req, res, 429, { success: false, error: 'Too many challenge requests.' }, { 'Retry-After': String(nonceLimit.retryAfterSec) });
    }
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
    const address = parsedUrl.searchParams.get('address') || '';
    const domain = (req.headers.host || 'veyroq.xyz').split(':')[0];
    const { nonce, expiresAt } = generateSiweNonce(address, domain);
    return sendJson(req, res, 200, { success: true, nonce, expiresAt, domain });
  }

  if (reqPath === '/api/auth/siwe/verify' && req.method === 'POST') {
    const siweLimit = checkRateLimit(`siwe-verify:${clientIp}`, 40, 60_000);
    if (!siweLimit.allowed) {
      return sendJson(req, res, 429, { success: false, error: 'Too many verification attempts.' }, { 'Retry-After': String(siweLimit.retryAfterSec) });
    }
    try {
      const { message, signature, address } = await readJsonBody(req);
      if (!message || !signature) {
        return sendJson(req, res, 400, { success: false, error: 'Missing message or signature in request body.' });
      }

      const verification = await verifyVaultOwnershipSiwe({
        message,
        signature,
        expectedAddress: address,
        expectedDomain: req.headers.host
      });

      if (!verification.valid) {
        return sendJson(req, res, 400, { success: false, error: verification.error });
      }

      const existingSession = getSessionFromRequest(req);
      const verifiedSet = new Set(Array.isArray(existingSession?.verifiedVaults) ? existingSession.verifiedVaults : []);
      verifiedSet.add(verification.address.toLowerCase());
      const token = createSessionToken({
        address: existingSession?.address || verification.address.toLowerCase(),
        method: existingSession?.method || 'siwe',
        email: existingSession?.email || null,
        verifiedVaults: Array.from(verifiedSet)
      });

      return sendJson(req, res, 200, {
        success: true,
        verified: true,
        role: verification.role,
        signer: verification.signer,
        address: verification.address,
        domain: verification.domain,
        chainId: verification.chainId,
        verifiedAt: verification.verifiedAt
      }, {
        'Set-Cookie': buildSessionCookieHeader(req, token)
      });
    } catch (err) {
      return sendJson(req, res, err.statusCode || 400, { success: false, error: err.message || 'SIWE verification error' });
    }
  }

  // 0c. Retired Relayer Endpoints (Self-custodial signing enforced directly on-chain)
  if (reqPath === '/api/subscription/activate' || reqPath === '/api/audit/commit-proof' || reqPath === '/api/audit/authorize-auditor') {
    return sendJson(req, res, 410, {
      success: false,
      error: 'Relayer execution disabled; sign transactions directly from your Privy or Web3 wallet.'
    });
  }

  // 0d. Arc Testnet Subscription Status Endpoint (Queries VeyroqRegistry on-chain in live mode)
  if (reqPath === '/api/subscription/status' && req.method === 'GET') {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const address = parsedUrl.searchParams.get('address')?.toLowerCase();
    if (!address || !address.startsWith('0x') || address.length !== 42) {
      return sendJson(req, res, 400, { success: false, error: 'Valid wallet address required' });
    }

    if (!isTestMode()) {
      try {
        const { rpcUrl, registryAddr } = getRegistryContext();
        const provider = new ethers.JsonRpcProvider(rpcUrl, 5042002, { staticNetwork: true });
        const cleanAddr = address.replace(/^0x/, '').padStart(64, '0');
        const rawSub = await provider.call({ to: registryAddr, data: '0x0cbebc24' + cleanAddr });
        if (rawSub && rawSub !== '0x') {
          const hex = rawSub.replace(/^0x/, '');
          const tierCode = parseInt(hex.slice(0, 64), 16) || 0;
          const expiresAtSec = parseInt(hex.slice(64, 128), 16) || 0;
          const isActive = parseInt(hex.slice(128, 192), 16) === 1 && tierCode > 0;
          if (isActive) {
            const tierKey = tierCode === 3 ? 'partner' : (tierCode === 2 ? 'enterprise' : 'single_org');
            const tierLabel = tierCode === 3 ? 'Audit Firm Partner' : (tierCode === 2 ? 'Enterprise Treasury' : 'Single Org ($5 USDC)');
            return sendJson(req, res, 200, {
              success: true,
              address,
              tierKey,
              tierCode,
              tier: tierLabel,
              expiresAt: expiresAtSec * 1000,
              isActive: true
            });
          }
        }
        return sendJson(req, res, 200, { success: true, address, tierCode: 0, tier: 'Free', expiresAt: 0, isActive: false });
      } catch (err) {
        logger.warn({ event: 'subscription_status_rpc_error', error: err.message });
      }
    }

    return sendJson(req, res, 200, { success: true, address, tierCode: 0, tier: 'Free', expiresAt: 0, isActive: false });
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
    res.writeHead(301, { 'Location': clean || '/', ...getSecurityHeaders(req) });
    res.end();
    return;
  }

  // 2. Clean alias redirects
  if (reqPath === '/landing' || reqPath === '/landing/index') {
    res.writeHead(301, { 'Location': '/', ...getSecurityHeaders(req) });
    res.end();
    return;
  }
  if (reqPath === '/legal' || reqPath === '/legal/index') {
    res.writeHead(301, { 'Location': '/legal/privacy', ...getSecurityHeaders(req) });
    res.end();
    return;
  }

  // 3. Resolve safe public file path (strict allowlist + root containment; blocks .env, .git, server.js, etc.)
  let filePath = null;

  if (reqPath === '/favicon.ico') {
    filePath = path.join(__dirname, 'assets', 'favicon.ico');
  } else if (reqPath === '/robots.txt') {
    filePath = path.join(__dirname, 'robots.txt');
  } else if (reqPath === '/sitemap.xml') {
    filePath = isAppSubdomain
      ? path.join(__dirname, 'console', 'sitemap.xml')
      : isDocsSubdomain
        ? path.join(__dirname, 'docs', 'sitemap.xml')
        : path.join(__dirname, 'sitemap.xml');
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
    const safeCandidate = resolveSafePublicFile(reqPath, __dirname);
    if (safeCandidate) {
      if (fs.existsSync(safeCandidate) && fs.statSync(safeCandidate).isDirectory()) {
        filePath = path.join(safeCandidate, 'index.html');
      } else if (fs.existsSync(safeCandidate) && fs.statSync(safeCandidate).isFile()) {
        filePath = safeCandidate;
      } else if (fs.existsSync(safeCandidate + '.html')) {
        filePath = safeCandidate + '.html';
      }
    }
  }

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders(req) });
    res.end(`
      <div style="font-family:sans-serif; text-align:center; padding:50px; background:#F8F5EE; color:#151716;">
        <h2>404 - Not Found</h2>
        <p>File <code>${escapeHtml(reqPath)}</code> does not exist.</p>
        <p><a href="/">Go to Landing Page</a> | <a href="/console">Go to Cockpit</a> | <a href="/docs">Go to Docs</a></p>
      </div>
    `);
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...getSecurityHeaders(req) });
        res.end(`
          <div style="font-family:sans-serif; text-align:center; padding:50px; background:#F8F5EE; color:#151716;">
            <h2>404 - Not Found</h2>
            <p>File <code>${escapeHtml(reqPath)}</code> does not exist.</p>
            <p><a href="/">Go to Landing Page</a> | <a href="/console">Go to Cockpit</a> | <a href="/docs">Go to Docs</a></p>
          </div>
        `);
      } else {
        res.writeHead(500, getSecurityHeaders(req));
        res.end('Internal server error');
      }
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      let body = content;
      if (ext === '.html') {
        const origin = sanitizeOrigin(req);
        if (origin) {
          body = Buffer.from(
            content.toString('utf8').replaceAll('content="/assets/og-image.png"', `content="${escapeHtml(origin)}/assets/og-image.png"`)
          );
        }
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        ...getSecurityHeaders(req)
      });
      res.end(body);
    }
  });
});

export { server, PORT };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    logger.warn({ event: 'ephemeral_session_secret', msg: 'SESSION_SECRET is not set in production; sessions reset on restart.' });
  }
  server.listen(PORT, () => {
    logger.info({
      event: 'server_started',
      port: PORT,
      registry: getRegistryContext().registryAddr
    });
    console.log(`\n==================================================`);
    console.log(`🚀 Veyroq Server running at http://localhost:${PORT}`);
    console.log(`--------------------------------------------------`);
    console.log(` • Healthcheck:     http://localhost:${PORT}/health`);
    console.log(` • Landing Page:    http://localhost:${PORT}/`);
    console.log(` • Auditor Cockpit: http://localhost:${PORT}/console`);
    console.log(` • Protocol Docs:   http://localhost:${PORT}/docs`);
    console.log(` • Legal Policies:  http://localhost:${PORT}/legal/privacy`);
    console.log(` • Refund Policy:   http://localhost:${PORT}/legal/refund`);
    console.log(`==================================================\n`);
  });
}
