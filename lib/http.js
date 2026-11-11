import { ServiceError } from './service.js';

/** Wraps a service function as a JSON POST endpoint (Vercel's Node handler shape). */
export function endpoint(fn, deps) {
  return async function handler(req, res) {
    res.setHeader('cache-control', 'no-store');
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
