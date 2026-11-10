import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDatabase } from './sqlite.mjs';
import { handleApi } from './app.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
export function createServer(env) {
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || 'localhost';
      if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host)) { res.writeHead(400); res.end(); return; }
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) { res.writeHead(413, securityHeaders); res.end(); return; }
          chunks.push(chunk);
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        headers.set('x-client-ip', req.socket.remoteAddress || 'local');
        const request = new Request(url, { method: req.method, headers,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
        const response = await handleApi(request, env);
        res.writeHead(response.status, { ...securityHeaders, ...Object.fromEntries(response.headers) });
        res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      const file = path.resolve(PUBLIC, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
      if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { ...securityHeaders, 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(readFileSync(file));
    } catch { res.writeHead(500); res.end('Server error'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = path.resolve(ROOT, process.env.DATA_DIR || 'data');
  mkdirSync(data, { recursive: true });
  let password = process.env.ADMIN_PASSWORD;
  if (!password && process.env.NODE_ENV === 'production') throw new Error('Set ADMIN_PASSWORD before starting in production.');
  if (!password) {
    const file = path.join(data, 'organizer-key.txt');
    password = existsSync(file) ? readFileSync(file, 'utf8').trim() : randomBytes(18).toString('base64url');
    if (!existsSync(file)) writeFileSync(file, password + '\n', { mode: 0o600 });
    console.log(`Organizer password is in ${file} (do not commit or share publicly).`);
  }
  const env = { ...process.env, ADMIN_PASSWORD: password, DB: openDatabase(path.join(data, 'event.sqlite')) };
  const server = createServer(env);
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Study Break is ready at http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { env.DB.close(); process.exit(0); }));
}
