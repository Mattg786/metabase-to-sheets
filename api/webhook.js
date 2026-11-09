'use strict';

const Stripe = require('stripe');
const { bodyText, methodNotAllowed, sendJson } = require('./_lib/http');
const { getStripeClient } = require('./_lib/stripe');
const { handleWebhookEvent } = require('./_lib/webhook');

async function webhook(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return sendJson(res, 503, { received: false, reason: 'payments not configured' });
  }

  const signature = req.headers && (req.headers['stripe-signature'] || req.headers['Stripe-Signature']);
  if (!signature) return sendJson(res, 400, { received: false, reason: 'missing webhook signature' });

  let event;
  try {
    const rawBody = await bodyText(req, 512 * 1024);
    event = Stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return sendJson(res, 400, { received: false, reason: 'invalid webhook signature' });
  }

  try {
    const result = await handleWebhookEvent({
      stripe: getStripeClient(),
      event,
      env: process.env,
    });
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, 500, { received: false, reason: 'webhook fulfilment failed' });
  }
}

webhook.config = { api: { bodyParser: false } };
module.exports = webhook;
