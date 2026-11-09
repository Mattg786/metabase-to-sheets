'use strict';

const {
  LICENCE_METADATA_KEY,
  generateLicenceKey,
  hasPrice,
  isValidLicenceKey,
} = require('./licensing');

function configured(values) {
  return Boolean(values && values.STRIPE_SECRET_KEY && values.STRIPE_PRICE_ID && isPaymentLinkUrl(values.STRIPE_PAYMENT_LINK_URL));
}

function isPaymentLinkUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname === 'buy.stripe.com'
      && !url.username
      && !url.password
      && url.pathname.length > 1
      && !url.search
      && !url.hash;
  } catch (error) {
    return false;
  }
}

function normaliseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function pending(reason) {
  return { verified: false, pending: true, reason };
}

function rejected(reason) {
  return { verified: false, pending: false, reason };
}

async function retrieveSubscription(stripe, id) {
  return stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] });
}

async function verifyCheckoutSession({ stripe, sessionId, env }) {
  const values = env || {};
  if (!configured(values)) return rejected('payments not configured');
  if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 200) {
    return rejected('invalid checkout session');
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price'],
    });
    if (session.payment_status !== 'paid') return pending('payment is not complete');
    if (session.mode !== 'subscription') return rejected('checkout session is not a subscription');
    if (!session.payment_link) return rejected('checkout session is not the configured payment link');

    const paymentLink = await stripe.paymentLinks.retrieve(session.payment_link, {
      expand: ['line_items.data.price'],
    });
    if (normaliseUrl(paymentLink.url) !== normaliseUrl(values.STRIPE_PAYMENT_LINK_URL)) {
      return rejected('checkout session is not the configured payment link');
    }

    const lineItems = session.line_items && session.line_items.data;
    const hasSessionPrice = Array.isArray(lineItems) && lineItems.some((item) => {
      const price = item && item.price;
      return price && (typeof price === 'string' ? price : price.id) === values.STRIPE_PRICE_ID;
    });
    if (!hasSessionPrice) return rejected('checkout session is not for this product');

    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription && session.subscription.id;
    if (!subscriptionId) return rejected('checkout session has no subscription');
    const subscription = await retrieveSubscription(stripe, subscriptionId);
    if (!hasPrice(subscription, values.STRIPE_PRICE_ID)) {
      return rejected('subscription is not for this product');
    }
    return { verified: true, pending: false, session, subscription, paymentLink };
  } catch (error) {
    return rejected('checkout session could not be verified');
  }
}

async function fulfilCheckoutSession({ stripe, verification, randomBytes }) {
  const subscription = verification.subscription;
  const subscriptionId = subscription.id;
  const existing = subscription.metadata && subscription.metadata[LICENCE_METADATA_KEY];
  const key = isValidLicenceKey(existing)
    ? existing
    : generateLicenceKey(subscriptionId, randomBytes);

  if (!isValidLicenceKey(existing) || existing !== key) {
    await stripe.subscriptions.update(
      subscriptionId,
      { metadata: { [LICENCE_METADATA_KEY]: key } },
      { idempotencyKey: `metabase-sheets-licence-${subscriptionId}` },
    );
  }

  const sessionMetadata = verification.session.metadata || {};
  if (!isValidLicenceKey(sessionMetadata[LICENCE_METADATA_KEY])) {
    await stripe.checkout.sessions.update(
      verification.session.id,
      { metadata: { [LICENCE_METADATA_KEY]: key } },
      { idempotencyKey: `metabase-sheets-session-licence-${verification.session.id}` },
    );
  }

  return key;
}

module.exports = {
  configured,
  isPaymentLinkUrl,
  normaliseUrl,
  verifyCheckoutSession,
  fulfilCheckoutSession,
};
