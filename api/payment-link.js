'use strict';

const { isPaymentLinkUrl } = require('./_lib/checkout');
const { methodNotAllowed, sendJson } = require('./_lib/http');

module.exports = function paymentLink(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  const url = process.env.STRIPE_PAYMENT_LINK_URL;
  return sendJson(res, 200, isPaymentLinkUrl(url)
    ? { configured: true, url }
    : { configured: false, reason: 'payments not configured' });
};
