'use strict';

const MAX_JSON_BYTES = 16 * 1024;

function sendJson(res, status, body) {
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res, allowed) {
  if (typeof res.setHeader === 'function') res.setHeader('Allow', allowed);
  sendJson(res, 405, { active: false, plan: 'free', reason: 'method not allowed' });
}

function bodyText(req, maxBytes) {
  const bodyLimit = maxBytes || MAX_JSON_BYTES;
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body));
  if (!req || typeof req.on !== 'function') return Promise.resolve('');

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > bodyLimit) {
        reject(new Error('request body too large'));
        if (typeof req.destroy === 'function') req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await bodyText(req);
  if (!raw) return {};
  if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BYTES) throw new Error('request body too large');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid JSON object');
  return parsed;
}

module.exports = { MAX_JSON_BYTES, sendJson, methodNotAllowed, bodyText, readJson };
