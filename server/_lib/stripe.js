'use strict';

const DEFAULT_API_VERSION = '2026-09-30.endive';

function getStripeClient(env) {
  const values = env || {};
  if (!values.STRIPE_SECRET_KEY) return null;
  const headers = {
    Authorization: `Bearer ${values.STRIPE_SECRET_KEY}`,
    'Stripe-Version': values.STRIPE_API_VERSION || DEFAULT_API_VERSION,
  };
  async function request(path, params, method, requestOptions) {
    const url = new URL(`https://api.stripe.com/v1/${path}`);
    const options = { method: method || 'GET', headers };
    if (options.method === 'GET') {
      for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
    } else {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(params || {})) body.set(key, value);
      options.headers = Object.assign({}, headers, { 'Content-Type': 'application/x-www-form-urlencoded' });
      if (requestOptions && requestOptions.idempotencyKey) {
        options.headers['Idempotency-Key'] = requestOptions.idempotencyKey;
      }
      options.body = body;
    }
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      let response;
      try {
        response = await fetch(url, options);
      } catch (error) {
        if (attempt === 2) throw new Error('Stripe request failed');
        continue;
      }
      const result = await response.json();
      if (response.ok) return result;
      if (response.status < 500 || attempt === 2) throw new Error('Stripe request failed');
    }
    throw new Error('Stripe request failed');
  }
  const retrieve = (path, params) => (id, options) => {
    const query = {};
    for (const item of options && options.expand || []) query[`expand[]`] = item;
    return request(`${path}/${encodeURIComponent(id)}`, query);
  };
  const update = (path) => (id, params, options) => {
    const body = Object.assign({}, params);
    if (params && params.metadata) {
      delete body.metadata;
      for (const [key, value] of Object.entries(params.metadata)) body[`metadata[${key}]`] = value;
    }
    const requestOptions = options && options.idempotencyKey
      ? { idempotencyKey: options.idempotencyKey }
      : {};
    return request(`${path}/${encodeURIComponent(id)}`, body, 'POST', requestOptions);
  };
  return {
    checkout: { sessions: { retrieve: retrieve('checkout/sessions'), update: update('checkout/sessions') } },
    paymentLinks: { retrieve: retrieve('payment_links') },
    subscriptions: { retrieve: retrieve('subscriptions'), update: update('subscriptions') },
  };
}

module.exports = { DEFAULT_API_VERSION, getStripeClient };
