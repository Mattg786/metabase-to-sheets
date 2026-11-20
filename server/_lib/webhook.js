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
    const outcome = { received: true, fulfilled: false, reason: verification.reason };
    // Pending here means the event said paid but Stripe still has the session unpaid.
    // A thrown Stripe call is transient. Both must be retried. A definite reject is not.
    if (verification.pending || verification.transient) outcome.retry = true;
    return outcome;
  }

  const licenceKey = await fulfilCheckoutSession({ stripe, verification, randomBytes });
  return { received: true, fulfilled: true, licenceKey };
}

module.exports = { handleWebhookEvent };
