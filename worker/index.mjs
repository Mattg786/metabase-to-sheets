'use strict';

import licensing from '../server/_lib/licensing.js';
import checkout from '../server/_lib/checkout.js';
import webhookHelpers from '../server/_lib/webhook.js';
import stripeHelpers from '../server/_lib/stripe.js';
import waitlist from '../server/_lib/waitlist.js';

const { checkLicence, MAX_LICENCE_LENGTH, LICENCE_METADATA_KEY, isValidLicenceKey, timingSafeEqual } = licensing;
const { verifyCheckoutSession, isPaymentLinkUrl } = checkout;
const { handleWebhookEvent } = webhookHelpers;
const { getStripeClient } = stripeHelpers;
const {
  normalizeEmail,
  isValidEmail,
  normalizeNote,
  normalizeRef,
  hashIp,
  checkRateLimit,
  addSignup,
  countSignups,
} = waitlist;

const MAX_JSON_BYTES = 16 * 1024;
const MAX_WEBHOOK_BYTES = 512 * 1024;
const WEBHOOK_TOLERANCE_SECONDS = 300;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    }, headers),
  });
}

function methodNotAllowed(allowed) {
  return json({ active: false, plan: 'free', reason: 'method not allowed' }, 405, { Allow: allowed });
}

async function readBounded(request, maximum) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new Error('request body too large');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error('request body too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJson(request) {
  const bytes = await readBounded(request, MAX_JSON_BYTES);
  if (!bytes.length) return {};
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid JSON object');
  return value;
}

function parseSignatureHeader(header) {
  if (typeof header !== 'string' || !header || header.length > 4096) return null;
  let timestamp = '';
  const signatures = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 1) return null;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!value) return null;
    if (name === 't') {
      if (timestamp || !/^\d{1,12}$/.test(value)) return null;
      timestamp = value;
    } else if (name === 'v1') {
      if (!/^[0-9a-f]{64}$/i.test(value)) return null;
      signatures.push(value);
    }
  }
  return timestamp && signatures.length ? { timestamp: Number(timestamp), signatures } : null;
}

async function verifyWebhookSignature(rawBytes, header, secret, now = Date.now()) {
  const parsed = parseSignatureHeader(header);
  if (!parsed || !secret) return false;
  if (Math.abs(Math.floor(now / 1000) - parsed.timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const prefix = new TextEncoder().encode(`${parsed.timestamp}.`);
  const signed = new Uint8Array(prefix.length + rawBytes.length);
  signed.set(prefix);
  signed.set(rawBytes, prefix.length);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let valid = 0;
  for (const signature of parsed.signatures) {
    const candidate = new Uint8Array(signature.match(/.{2}/g).map((byte) => parseInt(byte, 16)));
    valid |= Number(await crypto.subtle.verify('HMAC', key, candidate, signed));
  }
  return valid !== 0;
}

async function licence(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    return json({ active: false, plan: 'free', reason: 'licensing not configured' }, 503);
  }
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ active: false, plan: 'free', reason: 'invalid request body' }, 400);
  }
  const key = typeof body.key === 'string' ? body.key : '';
  if (key.length > MAX_LICENCE_LENGTH) return json({ active: false, plan: 'free', reason: 'invalid licence key' }, 400);
  const result = await checkLicence({ key, stripe: getStripeClient(env), env });
  return json(result, result.reason === 'licensing not configured' ? 503 : 200);
}

async function paymentLink(request, env) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  return json(isPaymentLinkUrl(env.STRIPE_PAYMENT_LINK_URL)
    ? { configured: true, url: env.STRIPE_PAYMENT_LINK_URL }
    : { configured: false, reason: 'payments not configured' });
}

async function successSession(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ verified: false, reason: 'invalid request body' }, 400);
  }
  const verification = await verifyCheckoutSession({ stripe: getStripeClient(env), sessionId: body.session_id, env });
  if (!verification.verified) {
    return json({ verified: false, pending: Boolean(verification.pending), reason: verification.reason }, verification.pending ? 202 : 400);
  }
  const key = verification.subscription.metadata && verification.subscription.metadata[LICENCE_METADATA_KEY];
  if (!isValidLicenceKey(key)) {
    return json({ verified: false, pending: true, reason: 'payment received, licence fulfilment is pending' }, 202);
  }
  return json({ verified: true, active: true, plan: 'pro', licenceKey: key, reason: 'paid subscription and webhook fulfilment verified' });
}

async function webhook(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    return json({ received: false, reason: 'payments not configured' }, 503);
  }
  const signature = request.headers.get('stripe-signature');
  let raw;
  try {
    raw = await readBounded(request, MAX_WEBHOOK_BYTES);
  } catch {
    return json({ received: false, reason: 'invalid webhook signature' }, 400);
  }
  if (!await verifyWebhookSignature(raw, signature, env.STRIPE_WEBHOOK_SECRET)) {
    return json({ received: false, reason: 'invalid webhook signature' }, 400);
  }
  let event;
  try {
    event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return json({ received: false, reason: 'invalid webhook event' }, 400);
  }
  try {
    return json(await handleWebhookEvent({ stripe: getStripeClient(env), event, env }));
  } catch {
    return json({ received: false, reason: 'webhook fulfilment failed' }, 500);
  }
}

function clientIp(request) {
  const forwarded = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim();
}

async function waitlistSignup(request, env) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (!env.DB) return json({ ok: false, reason: 'waitlist not configured' }, 503);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false, reason: 'invalid request body' }, 400);
  }
  // Honeypot: bots fill hidden fields. Humans leave them empty.
  if (typeof body.company === 'string' && body.company.trim()) {
    return json({ ok: true, message: 'Thanks. We will email you when the add-on is on the Marketplace.' });
  }
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return json({ ok: false, reason: 'Enter a valid email address.' }, 400);
  }
  const note = normalizeNote(body.note);
  const ref = normalizeRef(body.ref);
  const ipHash = await hashIp(clientIp(request));
  const rate = await checkRateLimit(env.DB, ipHash || `email:${email}`);
  if (!rate.ok) {
    return json({ ok: false, reason: 'Too many signups from this connection. Try again in an hour.' }, 429);
  }
  try {
    const result = await addSignup(env.DB, { email, note, ref, ipHash });
    if (result.duplicate) {
      return json({ ok: true, duplicate: true, message: 'You are already on the list. We will email you when it launches.' });
    }
    return json({ ok: true, message: 'Thanks. We will email you when the add-on is on the Marketplace.' });
  } catch {
    return json({ ok: false, reason: 'Could not save your email. Try again in a minute.' }, 500);
  }
}

async function waitlistCount(request, env) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  if (!env.DB) return json({ ok: false, reason: 'waitlist not configured' }, 503);
  const expected = env.WAITLIST_ADMIN_TOKEN;
  if (!expected) return json({ ok: false, reason: 'admin not configured' }, 503);
  const auth = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  const token = match ? match[1].trim() : '';
  if (!token || !timingSafeEqual(token, expected)) {
    return json({ ok: false, reason: 'unauthorized' }, 401);
  }
  try {
    const count = await countSignups(env.DB);
    return json({ ok: true, count });
  } catch {
    return json({ ok: false, reason: 'count failed' }, 500);
  }
}

const apiRoutes = {
  '/api/licence': licence,
  '/api/webhook': webhook,
  '/api/payment-link': paymentLink,
  '/api/success-session': successSession,
  '/api/waitlist': waitlistSignup,
  '/api/waitlist/count': waitlistCount,
};

async function fetchHandler(request, env) {
  const url = new URL(request.url);
  const handler = apiRoutes[url.pathname];
  if (handler) return handler(request, env);
  if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { fetchHandler, parseSignatureHeader, verifyWebhookSignature };
export default { fetch: fetchHandler };
