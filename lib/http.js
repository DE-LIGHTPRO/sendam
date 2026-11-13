import { ServiceError } from './service.js';

// A light per-visitor limit, so the endpoints cannot be used to hammer the services behind
// them. It is kept in memory per server instance: enough to blunt abuse of a demo, not a
// substitute for a real gateway.
const WINDOW_MS = 60_000;
const hits = new Map();
function overLimit(req, max) {
  const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}

/** Wraps a service function as a JSON POST endpoint (Vercel's Node handler shape). */
export function endpoint(fn, deps, { perMinute = 40 } = {}) {
  return async function handler(req, res) {
    res.setHeader('cache-control', 'no-store');
    if (overLimit(req, perMinute)) {
      res.statusCode = 429;
      res.setHeader('content-type', 'application/json');
      res.setHeader('retry-after', '60');
      return res.end(JSON.stringify({ error: 'Too many requests. Try again in a minute.' }));
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('allow', 'POST');
      return res.end(JSON.stringify({ error: 'Use POST' }));
    }
    let body = req.body;
    try {
      if (body === undefined) body = JSON.parse(await readBody(req) || '{}');
      if (typeof body === 'string') body = JSON.parse(body || '{}');
      let resolved;
      try {
        resolved = typeof deps === 'function' ? deps() : deps;
      } catch (err) {
        // Missing settings are safe to name, and saying which one saves a lot of guessing.
        throw new ServiceError(503, `The verifier is not set up yet: ${err.message}`);
      }
      const result = await fn(body || {}, resolved);
      res.statusCode = result?.state === 'pending' ? 202 : 200;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(result));
    } catch (err) {
      const status = err instanceof ServiceError ? err.status : err instanceof SyntaxError ? 400 : 500;
      if (status === 500) console.error(err);
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      // Unexpected errors are logged, not shown, so no internal detail leaks.
      return res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong on the verifier. Try again shortly.' : err.message }));
    }
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10_000) reject(new SyntaxError('Body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
