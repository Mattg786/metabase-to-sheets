'use strict';

const { methodNotAllowed, readJson, sendJson } = require('./_lib/http');
const { getStripeClient } = require('./_lib/stripe');
const { verifyCheckoutSession } = require('./_lib/checkout');
const { LICENCE_METADATA_KEY, isValidLicenceKey } = require('./_lib/licensing');

module.exports = async function successSession(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, 400, { verified: false, reason: 'invalid request body' });
  }

  const verification = await verifyCheckoutSession({
    stripe: getStripeClient(),
    sessionId: body.session_id,
    env: process.env,
  });
  if (!verification.verified) {
    return sendJson(res, verification.pending ? 202 : 400, {
      verified: false,
      pending: Boolean(verification.pending),
      reason: verification.reason,
    });
  }

  const key = verification.subscription.metadata && verification.subscription.metadata[LICENCE_METADATA_KEY];
  if (!isValidLicenceKey(key)) {
    return sendJson(res, 202, {
      verified: false,
      pending: true,
      reason: 'payment received, licence fulfilment is pending',
    });
  }

  return sendJson(res, 200, {
    verified: true,
    active: true,
    plan: 'pro',
    licenceKey: key,
    reason: 'paid subscription and webhook fulfilment verified',
  });
};
