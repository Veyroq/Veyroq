import { server } from '../server.js';

const HOP_BY_HOP_REQ = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-connection',
  'te',
  'trailer',
]);

const HOP_BY_HOP_RES = new Set([
  'connection',
  'transfer-encoding',
  'keep-alive',
  'content-encoding',
  'content-length',
  'set-cookie',
]);

async function readRawBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.readableEnded && req.body !== undefined) {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxyToBackend(req, res, backendBase) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const target = new URL(req.url || '/', backendBase.replace(/\/+$/, '') + '/');
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers || {})) {
      if (!v || HOP_BY_HOP_REQ.has(k.toLowerCase())) continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    if (req.headers?.host) {
      headers.set('x-forwarded-host', req.headers.host);
      headers.set('x-veyroq-host', req.headers.host);
    }

    const body = await readRawBody(req);
    const upstream = await fetch(target.toString(), {
      method: req.method || 'GET',
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    });

    res.statusCode = upstream.status;
    for (const [k, v] of upstream.headers.entries()) {
      if (!HOP_BY_HOP_RES.has(k.toLowerCase())) res.setHeader(k, v);
    }
    const cookies = upstream.headers.getSetCookie?.() || [];
    if (cookies.length) res.setHeader('set-cookie', cookies);

    const payload = Buffer.from(await upstream.arrayBuffer());
    res.end(payload);
  } catch {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Upstream backend unavailable' }));
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  const backendUrl = String(process.env.VEYROQ_BACKEND_URL || '').trim();
  if (backendUrl) {
    return proxyToBackend(req, res, backendUrl);
  }
  server.emit('request', req, res);
}

