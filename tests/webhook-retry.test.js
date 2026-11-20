'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyCheckoutSession } = require('../server/_lib/checkout');
const { handleWebhookEvent } = require('../server/_lib/webhook');
const workerPromise = import('../worker/index.mjs');

const env = {
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_only',
  STRIPE_PRICE_ID: 'price_metabase_pro',
  STRIPE_PAYMENT_LINK_URL: 'https://buy.stripe.com/test_metabase_link',
};

function paidSession(overrides) {
  return Object.assign({
    id: 'cs_test_123',
    payment_status: 'paid',
    mode: 'subscription',
    payment_link: 'plink_test_123',
    subscription: 'sub_123456789',
    line_items: { data: [{ price: { id: env.STRIPE_PRICE_ID } }] },
    metadata: {},
  }, overrides || {});
}

function stripeFor(session, extras) {
  const options = extras || {};
  return {
    checkout: {
      sessions: {
        retrieve: async () => {
          if (options.throwOnSession) throw new Error('Stripe unreachable');
          return session;
        },
      },
    },
    paymentLinks: {
      retrieve: async () => ({ url: options.linkUrl || env.STRIPE_PAYMENT_LINK_URL }),
    },
    subscriptions: {
      retrieve: async () => options.subscription || {
        id: 'sub_123456789',
        status: 'active',
        items: { data: [{ price: { id: env.STRIPE_PRICE_ID } }] },
      },
    },
  };
}

async function signedHeader(payload, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new TextEncoder().encode(`${timestamp}.${payload}`);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const hex = [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

async function postWebhook(payload, fetchImpl) {
  const worker = await workerPromise;
  const oldFetch = global.fetch;
  global.fetch = fetchImpl;
  try {
    const body = JSON.stringify(payload);
    const request = new Request('https://worker.test/api/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': await signedHeader(body),
      },
      body,
    });
    const response = await worker.fetchHandler(request, env);
    return { status: response.status, body: await response.json() };
  } finally {
    global.fetch = oldFetch;
  }
}

async function postSuccess(fetchImpl) {
  const worker = await workerPromise;
  const oldFetch = global.fetch;
  global.fetch = fetchImpl;
  try {
    const request = new Request('https://worker.test/api/success-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'cs_test_123' }),
    });
    const response = await worker.fetchHandler(request, env);
    return { status: response.status, body: await response.json() };
  } finally {
    global.fetch = oldFetch;
  }
}

function stripeHttp(mode) {
  return async (input) => {
    if (mode === 'down') throw new Error('Stripe unreachable');
    const url = new URL(input);
    if (url.pathname === '/v1/checkout/sessions/cs_test_123') {
      if (mode === 'pending') return Response.json(paidSession({ payment_status: 'unpaid' }));
      if (mode === 'wrong-price') {
        return Response.json(paidSession({ line_items: { data: [{ price: { id: 'price_other' } }] } }));
      }
      if (mode === 'no-subscription') return Response.json(paidSession({ subscription: null }));
      return Response.json(paidSession());
    }
    if (url.pathname === '/v1/payment_links/plink_test_123') {
      const link = mode === 'wrong-link' ? 'https://buy.stripe.com/test_other' : env.STRIPE_PAYMENT_LINK_URL;
      return Response.json({ id: 'plink_test_123', url: link });
    }
    if (url.pathname === '/v1/subscriptions/sub_123456789') {
      const price = mode === 'wrong-subscription-price' ? 'price_other' : env.STRIPE_PRICE_ID;
      return Response.json({
        id: 'sub_123456789',
        status: 'active',
        items: { data: [{ price: { id: price } }] },
      });
    }
    return Response.json({ error: { message: 'unexpected Stripe path' } }, { status: 404 });
  };
}

test('a thrown Stripe error is transient and does not change the reason string', async () => {
  const session = paidSession();
  const verified = await verifyCheckoutSession({
    stripe: stripeFor(session, { throwOnSession: true }),
    sessionId: session.id,
    env,
  });
  assert.equal(verified.verified, false);
  assert.equal(verified.pending, false);
  assert.equal(verified.transient, true);
  assert.equal(verified.reason, 'checkout session could not be verified');

  const event = { type: 'checkout.session.completed', data: { object: session } };
  const outcome = await handleWebhookEvent({
    stripe: stripeFor(session, { throwOnSession: true }),
    event,
    env,
  });
  assert.equal(outcome.retry, true);
  assert.equal(outcome.fulfilled, false);
  assert.equal(outcome.reason, 'checkout session could not be verified');
});

test('a paid event whose retrieved session is still pending asks for a retry', async () => {
  const session = paidSession();
  const retrieved = paidSession({ payment_status: 'unpaid' });
  const outcome = await handleWebhookEvent({
    stripe: stripeFor(retrieved),
    event: { type: 'checkout.session.completed', data: { object: session } },
    env,
  });
  assert.equal(outcome.retry, true);
  assert.equal(outcome.reason, 'payment is not complete');
});

test('definite checkout rejects do not ask Stripe to retry', async () => {
  const session = paidSession();
  const event = { type: 'checkout.session.completed', data: { object: session } };
  const wrongLink = await handleWebhookEvent({
    stripe: stripeFor(session, { linkUrl: 'https://buy.stripe.com/test_other' }),
    event,
    env,
  });
  assert.equal(wrongLink.retry, undefined);
  assert.match(wrongLink.reason, /configured payment link/);

  const wrongPrice = await handleWebhookEvent({
    stripe: stripeFor(paidSession({ line_items: { data: [{ price: { id: 'price_other' } }] } })),
    event,
    env,
  });
  assert.equal(wrongPrice.retry, undefined);
  assert.match(wrongPrice.reason, /not for this product/);

  const noSubscription = await handleWebhookEvent({
    stripe: stripeFor(paidSession({ subscription: null })),
    event,
    env,
  });
  assert.equal(noSubscription.retry, undefined);
  assert.match(noSubscription.reason, /no subscription/);

  const wrongSubscription = await handleWebhookEvent({
    stripe: stripeFor(session, {
      subscription: {
        id: 'sub_123456789',
        items: { data: [{ price: { id: 'price_other' } }] },
      },
    }),
    event,
    env,
  });
  assert.equal(wrongSubscription.retry, undefined);
  assert.match(wrongSubscription.reason, /not for this product/);

  const unpaidEvent = await handleWebhookEvent({
    stripe: stripeFor(session, { throwOnSession: true }),
    event: { type: 'checkout.session.completed', data: { object: paidSession({ payment_status: 'unpaid' }) } },
    env,
  });
  assert.equal(unpaidEvent.retry, undefined);
  assert.equal(unpaidEvent.reason, 'payment is not complete');

  const ignored = await handleWebhookEvent({
    stripe: stripeFor(session, { throwOnSession: true }),
    event: { type: 'customer.updated', data: { object: {} } },
    env,
  });
  assert.equal(ignored.retry, undefined);
  assert.equal(ignored.reason, 'event ignored');
});

test('the webhook returns 500 when Stripe throws so Stripe retries', async () => {
  const result = await postWebhook(
    { id: 'evt_down', type: 'checkout.session.completed', data: { object: paidSession() } },
    stripeHttp('down'),
  );
  assert.equal(result.status, 500);
  assert.equal(result.body.received, false);
  assert.equal(result.body.fulfilled, false);
  assert.equal(result.body.reason, 'checkout session could not be verified');
});

test('the webhook returns 500 when the retrieved session is still pending', async () => {
  const result = await postWebhook(
    { id: 'evt_pending', type: 'checkout.session.completed', data: { object: paidSession() } },
    stripeHttp('pending'),
  );
  assert.equal(result.status, 500);
  assert.equal(result.body.reason, 'payment is not complete');
});

test('definite webhook rejects stay HTTP 200', async () => {
  const paid = { id: 'evt_paid', type: 'checkout.session.completed', data: { object: paidSession() } };
  const wrongPrice = await postWebhook(paid, stripeHttp('wrong-price'));
  assert.equal(wrongPrice.status, 200);
  assert.equal(wrongPrice.body.received, true);
  assert.equal(wrongPrice.body.fulfilled, false);
  assert.match(wrongPrice.body.reason, /not for this product/);
  assert.equal(Object.prototype.hasOwnProperty.call(wrongPrice.body, 'retry'), false);

  const wrongLink = await postWebhook(paid, stripeHttp('wrong-link'));
  assert.equal(wrongLink.status, 200);
  assert.match(wrongLink.body.reason, /configured payment link/);

  const noSubscription = await postWebhook(paid, stripeHttp('no-subscription'));
  assert.equal(noSubscription.status, 200);
  assert.match(noSubscription.body.reason, /no subscription/);

  const wrongSubscription = await postWebhook(paid, stripeHttp('wrong-subscription-price'));
  assert.equal(wrongSubscription.status, 200);
  assert.match(wrongSubscription.body.reason, /not for this product/);

  const unpaid = await postWebhook(
    { id: 'evt_unpaid', type: 'checkout.session.completed', data: { object: paidSession({ payment_status: 'unpaid' }) } },
    stripeHttp('down'),
  );
  assert.equal(unpaid.status, 200);
  assert.equal(unpaid.body.reason, 'payment is not complete');

  const ignored = await postWebhook(
    { id: 'evt_ignore', type: 'customer.updated', data: { object: {} } },
    stripeHttp('down'),
  );
  assert.equal(ignored.status, 200);
  assert.equal(ignored.body.reason, 'event ignored');
});

test('the success endpoint still shows pending and error states', async () => {
  const pending = await postSuccess(stripeHttp('pending'));
  assert.equal(pending.status, 202);
  assert.equal(pending.body.verified, false);
  assert.equal(pending.body.pending, true);
  assert.equal(pending.body.reason, 'payment is not complete');
  assert.equal(Object.prototype.hasOwnProperty.call(pending.body, 'transient'), false);

  const failed = await postSuccess(stripeHttp('down'));
  assert.equal(failed.status, 400);
  assert.equal(failed.body.verified, false);
  assert.equal(failed.body.pending, false);
  assert.equal(failed.body.reason, 'checkout session could not be verified');
  assert.equal(Object.prototype.hasOwnProperty.call(failed.body, 'transient'), false);
});
