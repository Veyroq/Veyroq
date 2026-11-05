import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

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
