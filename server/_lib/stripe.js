'use strict';

const Stripe = require('stripe');

const DEFAULT_API_VERSION = '2026-09-30.endive';

function getStripeClient(env) {
  const values = env || process.env;
  if (!values.STRIPE_SECRET_KEY) return null;
  return new Stripe(values.STRIPE_SECRET_KEY, {
    apiVersion: values.STRIPE_API_VERSION || DEFAULT_API_VERSION,
    maxNetworkRetries: 2,
  });
}

module.exports = { DEFAULT_API_VERSION, getStripeClient };
