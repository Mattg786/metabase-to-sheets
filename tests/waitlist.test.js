'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail,
  isValidEmail,
  normalizeNote,
  normalizeSource,
  normalizeRef,
  RATE_MAX_HITS,
} = require('../server/_lib/waitlist');

test('email normalisation and validation', () => {
  assert.equal(normalizeEmail('  Matt@Example.COM '), 'matt@example.com');
  assert.equal(isValidEmail('matt@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('a@b.c'), false);
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('a@b..co'), false);
});

test('note and source are truncated and cleaned', () => {
  assert.equal(normalizeNote('  hello  '), 'hello');
  assert.equal(normalizeNote('x'.repeat(600)).length, 500);
  assert.equal(normalizeSource(' Metabase-Forum_1099 '), 'metabase-forum_1099');
  assert.equal(normalizeSource('Weird Ref!!/123').includes('!'), false);
  assert.ok(normalizeSource('a'.repeat(200)).length <= 120);
  assert.equal(normalizeRef('x'), normalizeSource('x'));
});

test('rate limit constant stays on free-tier friendly values', () => {
  assert.equal(RATE_MAX_HITS, 8);
});
