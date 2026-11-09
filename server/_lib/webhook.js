'use strict';

const { fulfilCheckoutSession, verifyCheckoutSession } = require('./checkout');

async function handleWebhookEvent({ stripe, event, env, randomBytes }) {
  if (!event || !event.type) return { received: false, reason: 'invalid event' };
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return { received: true, fulfilled: false, reason: 'event ignored' };
  }

  const session = event.data && event.data.object;
  if (!session || session.payment_status !== 'paid') {
    return { received: true, fulfilled: false, reason: 'payment is not complete' };
  }

  const verification = await verifyCheckoutSession({
    stripe,
    sessionId: session.id,
    env,
  });
  if (!verification.verified) {
    return { received: true, fulfilled: false, reason: verification.reason };
  }

  const licenceKey = await fulfilCheckoutSession({ stripe, verification, randomBytes });
  return { received: true, fulfilled: true, licenceKey };
}

module.exports = { handleWebhookEvent };
