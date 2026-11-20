'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/Lib');
const { createProperties } = require('./support/fakes');

const LICENCE_KEY = 'mts_sub_test_1234567890_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const LAST_GOOD = Date.parse('2026-11-07T14:05:00.000Z');
const INSIDE_WEEK = Date.parse('2026-11-09T14:05:00.000Z');
const AFTER_WEEK = Date.parse('2026-11-16T14:05:00.000Z');

function licenceServices(response, nowMs) {
  const store = lib.createStore(createProperties(), createProperties());
  store.setLicenceKey(LICENCE_KEY);
  store.setLicenceCache({
    key: LICENCE_KEY,
    checkedAtMs: LAST_GOOD,
    validActiveAtMs: LAST_GOOD,
    access: { active: true, plan: 'pro', reason: 'active Pro subscription verified' },
  });
  let writes = 0;
  const setLicenceCache = store.setLicenceCache;
  store.setLicenceCache = function setCache(cache) {
    writes += 1;
    return setLicenceCache.call(store, cache);
  };
  return {
    store,
    writes() {
      return writes;
    },
    clock() {
      return new Date(nowMs == null ? INSIDE_WEEK : nowMs);
    },
    fetchLicence() {
      return response;
    },
  };
}

function jsonBody(reason, active) {
  return JSON.stringify({
    active: Boolean(active),
    plan: active ? 'pro' : 'free',
    reason,
  });
}

function check(response, nowMs) {
  const services = licenceServices(response, nowMs);
  const result = lib.getLicenceAccessForKey(LICENCE_KEY, services, { persist: true });
  return { services, result };
}

test('a licence outage keeps last-good Pro inside 7 days and does not write the cache', () => {
  const cases = [
    { status: 200, body: jsonBody('licence check failed') },
    { status: 503, body: jsonBody('licence check failed') },
    { status: 502, body: '<html>bad gateway</html>' },
    { status: 500, body: jsonBody('subscription is not active') },
    { status: 0, body: '', networkError: true },
  ];

  for (const response of cases) {
    const { services, result } = check(response);
    assert.equal(result.access.active, true, JSON.stringify(response));
    assert.equal(result.access.plan, 'pro');
    assert.equal(result.access.stale, true);
    assert.equal(services.writes(), 0);
    const stored = services.store.getLicenceCache();
    assert.equal(stored.validActiveAtMs, LAST_GOOD);
    assert.equal(stored.checkedAtMs, LAST_GOOD);
    assert.equal(stored.access.reason, 'active Pro subscription verified');
  }
});

test('an outage past 7 days does not extend validActiveAtMs', () => {
  const { services, result } = check({ status: 503, body: jsonBody('licence check failed') }, AFTER_WEEK);
  assert.equal(result.access.active, false);
  assert.equal(result.access.unavailable, true);
  assert.equal(services.writes(), 0);
  assert.equal(services.store.getLicenceCache().validActiveAtMs, LAST_GOOD);
});

test('explicit inactive results revoke at once, including 503 licensing not configured', () => {
  const cases = [
    { status: 200, body: jsonBody('subscription is not active'), reason: 'subscription is not active' },
    { status: 200, body: jsonBody('subscription is not for this product'), reason: 'subscription is not for this product' },
    { status: 200, body: jsonBody('invalid licence key'), reason: 'invalid licence key' },
    { status: 503, body: jsonBody('licensing not configured'), reason: 'licensing not configured' },
  ];

  for (const response of cases) {
    const { services, result } = check(response);
    assert.equal(result.access.active, false, response.reason);
    assert.equal(result.access.plan, 'free');
    assert.equal(result.access.reason, response.reason);
    assert.equal(services.writes(), 1);
    assert.equal(services.store.getLicenceCache().validActiveAtMs, 0);
  }
});

test('a later outage does not restore Pro after an explicit revocation', () => {
  const user = createProperties();
  const store = lib.createStore(user, createProperties());
  store.setLicenceKey(LICENCE_KEY);
  store.setLicenceCache({
    key: LICENCE_KEY,
    checkedAtMs: LAST_GOOD,
    validActiveAtMs: LAST_GOOD,
    access: { active: true, plan: 'pro', reason: 'active Pro subscription verified' },
  });
  let nowMs = INSIDE_WEEK;
  let response = { status: 200, body: jsonBody('subscription is not active') };
  const services = {
    store,
    clock() {
      return new Date(nowMs);
    },
    fetchLicence() {
      return response;
    },
  };

  const revoked = lib.getLicenceAccessForKey(LICENCE_KEY, services);
  assert.equal(revoked.access.active, false);
  assert.equal(store.getLicenceCache().validActiveAtMs, 0);

  nowMs = INSIDE_WEEK + (2 * 24 * 60 * 60 * 1000);
  response = { status: 503, body: jsonBody('licence check failed') };
  const duringOutage = lib.getLicenceAccessForKey(LICENCE_KEY, services);
  assert.equal(duringOutage.access.active, false);
  assert.equal(store.getLicenceCache().validActiveAtMs, 0);
  assert.equal(store.getLicenceCache().access.reason, 'subscription is not active');
});
