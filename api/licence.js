'use strict';

const { methodNotAllowed, readJson, sendJson } = require('./_lib/http');
const { getStripeClient } = require('./_lib/stripe');
const { checkLicence, MAX_LICENCE_LENGTH } = require('./_lib/licensing');

module.exports = async function licence(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, 400, { active: false, plan: 'free', reason: 'invalid request body' });
  }

  const key = typeof body.key === 'string' ? body.key : '';
  if (key.length > MAX_LICENCE_LENGTH) {
    return sendJson(res, 400, { active: false, plan: 'free', reason: 'invalid licence key' });
  }
  const result = await checkLicence({
    key,
    stripe: getStripeClient(),
    env: process.env,
  });
  return sendJson(res, result.reason === 'licensing not configured' ? 503 : 200, result);
};
