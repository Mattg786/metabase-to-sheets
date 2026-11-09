'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkLicence,
  generateLicenceKey,
  isValidLicenceKey,
  subscriptionIdFromLicenceKey,
} = require('../server/_lib/licensing');
const { isPaymentLinkUrl, verifyCheckoutSession, fulfilCheckoutSession } = require('../server/_lib/checkout');
const { handleWebhookEvent } = require('../server/_lib/webhook');

const env = {
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_PRICE_ID: 'price_metabase_pro',
  STRIPE_PAYMENT_LINK_URL: 'https://buy.stripe.com/test_metabase_link',
};

function fixedRandomBytes() {
  return Buffer.alloc(32, 7);
}

function keyFor(id) {
  return generateLicenceKey(id, fixedRandomBytes);
}

function subscription(id, key, overrides) {
  return Object.assign({
    id,
    status: 'active',
    metadata: { metabase_sheets_licence: key },
    items: { data: [{ price: { id: env.STRIPE_PRICE_ID } }] },
  }, overrides || {});
}

function checkoutStripe(session, sub, linkUrl) {
  return {
    checkout: {
      sessions: {
        retrieve: async () => session,
        update: async () => session,
      },
    },
    paymentLinks: {
      retrieve: async () => ({ url: linkUrl || env.STRIPE_PAYMENT_LINK_URL }),
    },
    subscriptions: {
      retrieve: async () => sub,
      update: async (_id, params, options) => {
        sub.metadata = Object.assign({}, sub.metadata, params.metadata);
        sub.updateOptions = options;
        return sub;
      },
    },
  };
}

test('licence lookup retrieves the subscription encoded in the key and checks product status', async () => {
  const id = 'sub_123456789';
  const key = keyFor(id);
  assert.equal(isValidLicenceKey(key), true);
  assert.equal(subscriptionIdFromLicenceKey(key), id);
  let retrievedId = '';
  const stripe = {
    subscriptions: {
      retrieve: async (retrieved) => {
        retrievedId = retrieved;
        return subscription(id, key);
      },
    },
  };

  const result = await checkLicence({ key, stripe, env });
  assert.equal(result.active, true);
  assert.equal(result.plan, 'pro');
  assert.equal(retrievedId, id);
  assert.equal(result.reason, 'active Pro subscription verified');
});

test('licence lookup fails closed for missing config, invalid, wrong, inactive, and wrong-product keys', async () => {
  const id = 'sub_123456789';
  const key = keyFor(id);
  const stripe = {
    subscriptions: {
      retrieve: async () => subscription(id, key),
    },
  };
  assert.match((await checkLicence({ key, stripe, env: {} })).reason, /not configured/);
  assert.match((await checkLicence({ key: '', stripe, env })).reason, /invalid/);
  assert.match((await checkLicence({ key: 'mts_sub_123456789_wrong', stripe, env })).reason, /invalid/);
  assert.match((await checkLicence({ key: 'x'.repeat(161), stripe, env })).reason, /invalid/);
  assert.match((await checkLicence({ key: keyFor('sub_987654321'), stripe, env })).reason, /match/);
  assert.match((await checkLicence({ key, stripe: { subscriptions: { retrieve: async () => subscription(id, key, { status: 'canceled' }) } }, env })).reason, /not active/);
  assert.match((await checkLicence({ key, stripe: { subscriptions: { retrieve: async () => subscription(id, key, { items: { data: [{ price: { id: 'price_other' } }] } }) } }, env })).reason, /not for this product/);
  assert.match((await checkLicence({ key, stripe: { subscriptions: { retrieve: async () => { throw new Error('Stripe unavailable'); } } }, env })).reason, /failed/);
});

test('checkout verification requires paid matching session, link, price, and subscription', async () => {
  assert.equal(isPaymentLinkUrl(env.STRIPE_PAYMENT_LINK_URL), true);
  assert.equal(isPaymentLinkUrl('https://example.com/stripe-link'), false);
  assert.equal(isPaymentLinkUrl('javascript:alert(1)'), false);
  const id = 'sub_123456789';
  const key = keyFor(id);
  const session = {
    id: 'cs_test_123',
    payment_status: 'paid',
    mode: 'subscription',
    payment_link: 'plink_test_123',
    subscription: id,
    line_items: { data: [{ price: { id: env.STRIPE_PRICE_ID } }] },
    metadata: {},
  };
  const verified = await verifyCheckoutSession({
    stripe: checkoutStripe(session, subscription(id, key)),
    sessionId: session.id,
    env,
  });
  assert.equal(verified.verified, true);

  const pending = await verifyCheckoutSession({
    stripe: checkoutStripe(Object.assign({}, session, { payment_status: 'unpaid' }), subscription(id, key)),
    sessionId: session.id,
    env,
  });
  assert.equal(pending.pending, true);

  const wrongLink = await verifyCheckoutSession({
    stripe: checkoutStripe(session, subscription(id, key), 'https://buy.stripe.com/other'),
    sessionId: session.id,
    env,
  });
  assert.match(wrongLink.reason, /configured payment link/);
});

test('webhook fulfilment is idempotent and uses stable Stripe idempotency keys', async () => {
  const id = 'sub_123456789';
  const session = {
    id: 'cs_test_123',
    payment_status: 'paid',
    mode: 'subscription',
    payment_link: 'plink_test_123',
    subscription: id,
    line_items: { data: [{ price: { id: env.STRIPE_PRICE_ID } }] },
    metadata: {},
  };
  const sub = subscription(id, '');
  delete sub.metadata.metabase_sheets_licence;
  const stripe = checkoutStripe(session, sub);
  const event = { type: 'checkout.session.completed', data: { object: session } };
  const first = await handleWebhookEvent({ stripe, event, env, randomBytes: fixedRandomBytes });
  assert.equal(first.fulfilled, true);
  assert.equal(isValidLicenceKey(first.licenceKey), true);
  assert.equal(sub.updateOptions.idempotencyKey, 'metabase-sheets-licence-sub_123456789');
  const second = await handleWebhookEvent({ stripe, event, env, randomBytes: fixedRandomBytes });
  assert.equal(second.licenceKey, first.licenceKey);
});

test('webhook ignores unpaid and unrelated events without provisioning', async () => {
  const id = 'sub_123456789';
  const key = keyFor(id);
  const session = { id: 'cs_test_123', payment_status: 'unpaid' };
  const stripe = checkoutStripe(session, subscription(id, key));
  const unpaid = await handleWebhookEvent({
    stripe,
    event: { type: 'checkout.session.completed', data: { object: session } },
    env,
  });
  assert.equal(unpaid.fulfilled, false);
  assert.match(unpaid.reason, /not complete/);
  const ignored = await handleWebhookEvent({ stripe, event: { type: 'customer.updated', data: { object: {} } }, env });
  assert.equal(ignored.reason, 'event ignored');
});
