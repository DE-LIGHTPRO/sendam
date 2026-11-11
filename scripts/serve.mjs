// Local server: the static site plus the /api endpoints, the same layout Vercel uses.
// Reads secrets from a .env file if there is one (see .env.example).
//   npm run serve, then open http://localhost:4300
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 4300);

const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};
const security = {};
for (const h of JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).headers[0].headers) {
  security[h.key] = h.key === 'Content-Security-Policy' ? h.value.replace(/;\s*frame-ancestors [^;]*/, '') : h.value;
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [k, v] of Object.entries(security)) res.setHeader(k, v);
  const api = path.match(/^\/api\/([a-z-]+)$/);
  if (api && existsSync(join(root, 'api', `${api[1]}.js`))) {
    const mod = await import(pathToFileURL(join(root, 'api', `${api[1]}.js`)).href);
    return mod.default(req, res);
  }
  if (path.endsWith('.html') && path !== '/404.html') {
    res.writeHead(308, { location: path === '/index.html' ? '/' : path.slice(0, -5) + new URL(req.url, 'http://x').search }).end();
    return;
  }
  let file = path.endsWith('/') ? path + 'index.html' : extname(path) ? path : path + '.html';
  const full = normalize(join(root, file));
  const hidden = file.split('/').some((p) => p.startsWith('.') || ['node_modules', 'contracts', 'lib', 'test', 'test-e2e', 'scripts', 'src'].includes(p));
  if (hidden || !full.startsWith(root + sep)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    if (!(await stat(full)).isFile()) throw new Error();
    res.writeHead(200, { 'content-type': types[extname(full)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(await readFile(full));
  } catch {
    res.writeHead(404, { 'content-type': types['.html'] }).end(await readFile(join(root, '404.html')).catch(() => 'Not found'));
  }
}).listen(port, () => console.log(`Sendam on http://localhost:${port}`));
