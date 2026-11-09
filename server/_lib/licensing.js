'use strict';

const LICENCE_METADATA_KEY = 'metabase_sheets_licence';
const LICENCE_PREFIX = 'mts_';
const TOKEN_BYTES = 32;
const MAX_LICENCE_LENGTH = 160;

function generateLicenceKey(subscriptionId, randomBytes) {
  const bytes = (randomBytes || ((size) => crypto.getRandomValues(new Uint8Array(size))))(TOKEN_BYTES);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${LICENCE_PREFIX}${subscriptionId}_${encoded}`;
}

function isValidLicenceKey(value) {
  return typeof value === 'string'
    && value.length > LICENCE_PREFIX.length + 3
    && value.length <= MAX_LICENCE_LENGTH
    && /^mts_sub_[A-Za-z0-9]+_[A-Za-z0-9_-]{43}$/.test(value);
}

function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ''));
  const b = new TextEncoder().encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

function subscriptionIdFromLicenceKey(key) {
  if (!isValidLicenceKey(key)) return '';
  const first = key.indexOf('_', LICENCE_PREFIX.length);
  const second = key.indexOf('_', first + 1);
  if (first === -1 || second === -1) return '';
  return key.slice(LICENCE_PREFIX.length, second);
}

function hasPrice(subscription, priceId) {
  const items = subscription && subscription.items && subscription.items.data;
  return Array.isArray(items) && items.some((item) => {
    const price = item && item.price;
    return price && (typeof price === 'string' ? price : price.id) === priceId;
  });
}

function inactive(reason, extra) {
  return Object.assign({ active: false, plan: 'free', reason }, extra || {});
}

async function checkLicence({ key, stripe, env }) {
  const values = env || {};
  if (!values.STRIPE_SECRET_KEY || !values.STRIPE_PRICE_ID) {
    return inactive('licensing not configured');
  }
  if (!isValidLicenceKey(key)) return inactive('invalid licence key');
  if (!stripe) return inactive('licensing not configured');

  const subscriptionId = subscriptionIdFromLicenceKey(key);
  if (!subscriptionId) return inactive('invalid licence key');

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    });
    const stored = subscription && subscription.metadata && subscription.metadata[LICENCE_METADATA_KEY];
    if (!timingSafeEqual(stored, key)) return inactive('licence key does not match the subscription');
    if (subscription.status !== 'active') return inactive('subscription is not active');
    if (!hasPrice(subscription, values.STRIPE_PRICE_ID)) {
      return inactive('subscription is not for this product');
    }
    return {
      active: true,
      plan: 'pro',
      reason: 'active Pro subscription verified',
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return inactive('licence check failed');
  }
}

module.exports = {
  LICENCE_METADATA_KEY,
  LICENCE_PREFIX,
  TOKEN_BYTES,
  MAX_LICENCE_LENGTH,
  generateLicenceKey,
  isValidLicenceKey,
  timingSafeEqual,
  subscriptionIdFromLicenceKey,
  hasPrice,
  checkLicence,
};
