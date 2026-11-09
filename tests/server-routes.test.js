'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const workerPromise = import('../worker/index.mjs');

const env = {
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_only',
  STRIPE_PRICE_ID: 'price_metabase_pro',
  STRIPE_PAYMENT_LINK_URL: 'https://buy.stripe.com/test_metabase_link',
};

function licenceKey(id = 'sub_123456789') {
  let bytes = '';
  for (let index = 0; index < 32; index += 1) bytes += String.fromCharCode(7);
  return `mts_${id}_${btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

function subscription(id, key, overrides = {}) {
  return Object.assign({
    id,
    status: 'active',
    metadata: { metabase_sheets_licence: key },
    items: { data: [{ price: { id: env.STRIPE_PRICE_ID } }] },
  }, overrides);
}

function stripeFetch(state, fail = false) {
  return async (input, options = {}) => {
    const url = new URL(input);
    if (fail) return Response.json({ error: { message: 'offline' } }, { status: 503 });
    let result;
    if (url.pathname === '/v1/checkout/sessions/cs_test_123') {
      if (options.method === 'POST') {
        const form = new URLSearchParams(options.body);
        state.session.metadata = Object.assign({}, state.session.metadata, {
          metabase_sheets_licence: form.get('metadata[metabase_sheets_licence]'),
        });
      }
      result = state.session;
    } else if (url.pathname === '/v1/payment_links/plink_test_123') {
      result = { id: 'plink_test_123', url: env.STRIPE_PAYMENT_LINK_URL };
    } else if (url.pathname === '/v1/subscriptions/sub_123456789') {
      if (options.method === 'POST') {
        const form = new URLSearchParams(options.body);
        state.subscription.metadata = Object.assign({}, state.subscription.metadata, {
          metabase_sheets_licence: form.get('metadata[metabase_sheets_licence]'),
        });
      }
      result = state.subscription;
    } else {
      return Response.json({ error: { message: 'unexpected Stripe path' } }, { status: 404 });
    }
    return Response.json(result);
  };
}

async function signedHeader(payload, secret = env.STRIPE_WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new TextEncoder().encode(`${timestamp}.${payload}`);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const hex = [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

async function call(path, method = 'GET', body, headers = {}, config = env) {
  const worker = await workerPromise;
  const request = new Request(`https://worker.test${path}`, {
    method,
    headers: Object.assign({}, body === undefined ? {} : { 'Content-Type': 'application/json' }, headers),
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const response = await worker.fetchHandler(request, config);
  return { response, body: await response.json() };
}

test('unconfigured licence response is fail closed and exact', async () => {
  const worker = await workerPromise;
  const { response, body } = await call('/api/licence', 'POST', { key: 'anything' }, {}, {});
  assert.equal(response.status, 503);
  assert.deepEqual(body, { active: false, plan: 'free', reason: 'licensing not configured' });
});

test('licence endpoint validates product and active subscription status', async (t) => {
  const worker = await workerPromise;
  const oldFetch = global.fetch;
  const key = licenceKey();
  const state = { subscription: subscription('sub_123456789', key) };
  global.fetch = stripeFetch(state);
  t.after(() => { global.fetch = oldFetch; });
  assert.equal((await call('/api/licence', 'POST', { key })).body.active, true);
  state.subscription.status = 'canceled';
  assert.equal((await call('/api/licence', 'POST', { key })).body.active, false);
  state.subscription.status = 'active';
  state.subscription.items.data[0].price.id = 'price_other';
  assert.equal((await call('/api/licence', 'POST', { key })).body.active, false);
});

test('licence endpoint fails closed when Stripe is unavailable', async (t) => {
  const worker = await workerPromise;
  const oldFetch = global.fetch;
  global.fetch = stripeFetch({}, true);
  t.after(() => { global.fetch = oldFetch; });
  const { response, body } = await call('/api/licence', 'POST', { key: licenceKey() });
  assert.equal(response.status, 200);
  assert.deepEqual(body, { active: false, plan: 'free', reason: 'licence check failed' });
});

test('webhook signatures preserve raw whitespace and accept any matching v1 signature', async (t) => {
  const worker = await workerPromise;
  const payload = '{\n  "id": "evt_test",\n  "type": "customer.updated",\n  "data": { "object": {} }\n}\n';
  const header = await signedHeader(payload);
  const [, signature] = header.split(',');
  const mixed = `${header},v1=${'0'.repeat(64)},${signature}`;
  const raw = new TextEncoder().encode(payload);
  assert.equal(await worker.verifyWebhookSignature(raw, mixed, env.STRIPE_WEBHOOK_SECRET), true);
  const { response, body } = await call('/api/webhook', 'POST', payload, { 'stripe-signature': header });
  assert.equal(response.status, 200);
  assert.deepEqual(body, { received: true, fulfilled: false, reason: 'event ignored' });
});

test('webhook rejects malformed, invalid, and stale signatures', async () => {
  const worker = await workerPromise;
  const raw = new TextEncoder().encode('{}');
  assert.equal(await worker.verifyWebhookSignature(raw, 'not-a-signature', env.STRIPE_WEBHOOK_SECRET), false);
  assert.equal(await worker.verifyWebhookSignature(raw, 't=1,v1=' + '0'.repeat(64), env.STRIPE_WEBHOOK_SECRET), false);
  const fresh = await signedHeader('{}');
  assert.equal(await worker.verifyWebhookSignature(raw, fresh.replace(/v1=.*/, `v1=${'0'.repeat(64)}`), env.STRIPE_WEBHOOK_SECRET), false);
});

test('duplicate paid webhook delivery reuses subscription-bound licence metadata', async (t) => {
  const worker = await workerPromise;
  const oldFetch = global.fetch;
  const session = {
    id: 'cs_test_123', payment_status: 'paid', mode: 'subscription', payment_link: 'plink_test_123',
    subscription: 'sub_123456789',
    line_items: { data: [{ price: { id: env.STRIPE_PRICE_ID } }] }, metadata: {},
  };
  const state = { session, subscription: subscription('sub_123456789', '') };
  delete state.subscription.metadata.metabase_sheets_licence;
  global.fetch = stripeFetch(state);
  t.after(() => { global.fetch = oldFetch; });
  const payload = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed', data: { object: session } });
  const headers = { 'stripe-signature': await signedHeader(payload) };
  const first = await call('/api/webhook', 'POST', payload, headers);
  const second = await call('/api/webhook', 'POST', payload, headers);
  assert.equal(first.body.fulfilled, true);
  assert.equal(first.body.licenceKey, second.body.licenceKey);
  assert.equal(state.subscription.metadata.metabase_sheets_licence, first.body.licenceKey);
});

test('success API verifies hosted checkout session and exposes only the licence key', async (t) => {
  const worker = await workerPromise;
  const oldFetch = global.fetch;
  const key = licenceKey();
  const state = {
    session: {
      id: 'cs_test_123', payment_status: 'paid', mode: 'subscription', payment_link: 'plink_test_123',
      subscription: 'sub_123456789', line_items: { data: [{ price: { id: env.STRIPE_PRICE_ID } }] },
      metadata: { metabase_sheets_licence: key },
    },
    subscription: subscription('sub_123456789', key),
  };
  global.fetch = stripeFetch(state);
  t.after(() => { global.fetch = oldFetch; });
  const { response, body } = await call('/api/success-session', 'POST', { session_id: 'cs_test_123' });
  assert.equal(response.status, 200);
  assert.equal(body.verified, true);
  assert.equal(body.licenceKey, key);
});

test('routes enforce methods and unknown API paths return 404', async () => {
  const worker = await workerPromise;
  assert.equal((await call('/api/licence')).response.status, 405);
  assert.equal((await call('/api/webhook')).response.status, 405);
  assert.equal((await call('/api/missing')).response.status, 404);
});
