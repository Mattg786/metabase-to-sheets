'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Stripe = require('stripe');
const licenceRoute = require('../api/licence');
const paymentLinkRoute = require('../api/payment-link');
const successRoute = require('../api/success-session');
const webhookRoute = require('../api/webhook');

function response() {
  let finish;
  const complete = new Promise((resolve) => { finish = resolve; });
  return {
    promise: complete,
    res: {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { finish({ status: this.statusCode, headers: this.headers, body: body ? JSON.parse(body) : null }); },
    },
  };
}

async function withEnv(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('licence and success routes reject bad input without caching', async () => {
  await withEnv({ STRIPE_SECRET_KEY: null, STRIPE_PRICE_ID: null }, async () => {
    const licence = response();
    await licenceRoute({ method: 'POST', body: { key: 'x'.repeat(161) } }, licence.res);
    const licenceResult = await licence.promise;
    assert.equal(licenceResult.status, 400);
    assert.equal(licenceResult.body.active, false);
    assert.match(licenceResult.body.reason, /invalid/);
    assert.equal(licenceResult.headers['Cache-Control'], 'no-store, max-age=0');

    const success = response();
    await successRoute({ method: 'POST', body: { session_id: 'not-a-session' } }, success.res);
    const successResult = await success.promise;
    assert.equal(successResult.status, 400);
    assert.equal(successResult.body.verified, false);
  });
});

test('payment link endpoint is configuration-only and exposes no secret', async () => {
  await withEnv({ STRIPE_PAYMENT_LINK_URL: null }, async () => {
    const result = response();
    await paymentLinkRoute({ method: 'GET' }, result.res);
    const body = await result.promise;
    assert.deepEqual(body.body, { configured: false, reason: 'payments not configured' });
  });
});

test('webhook uses raw request bytes and Vercel body-parser opt-out', async () => {
  assert.deepEqual(webhookRoute.config, { api: { bodyParser: false } });
  const payload = JSON.stringify({ id: 'evt_test', type: 'customer.updated', data: { object: {} } });
  const secret = 'whsec_test_only';
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  await withEnv({
    STRIPE_SECRET_KEY: 'test-only-placeholder',
    STRIPE_PRICE_ID: 'price_test_only',
    STRIPE_WEBHOOK_SECRET: secret,
  }, async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.headers = { 'stripe-signature': signature };
    const result = response();
    const running = webhookRoute(req, result.res);
    req.emit('data', Buffer.from(payload, 'utf8'));
    req.emit('end');
    await running;
    const body = await result.promise;
    assert.equal(body.status, 200);
    assert.deepEqual(body.body, { received: true, fulfilled: false, reason: 'event ignored' });
  });
});
