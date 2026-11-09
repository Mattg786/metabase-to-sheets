'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBaseUrl,
  parseCardId,
  validateApiKey,
  validateSchedule,
  formatSyncTime,
  scrubSecrets,
} = require('../src/Lib');

test('accepts an https Metabase site root and drops a trailing slash', () => {
  const result = validateBaseUrl('https://example.metabaseapp.com/');
  assert.deepEqual(result, { ok: true, baseUrl: 'https://example.metabaseapp.com' });
});

test('keeps a subpath and port on the Metabase site URL', () => {
  const result = validateBaseUrl('https://bi.example.com:8443/metabase/');
  assert.equal(result.ok, true);
  assert.equal(result.baseUrl, 'https://bi.example.com:8443/metabase');
});

test('rejects URLs that are not https', () => {
  assert.equal(validateBaseUrl('http://example.metabaseapp.com').ok, false);
  assert.match(validateBaseUrl('http://example.metabaseapp.com').error, /https/);
  assert.equal(validateBaseUrl('').ok, false);
  assert.equal(validateBaseUrl('not a url').ok, false);
});

test('rejects credentials, queries, hashes, localhost, question URLs, and an /api suffix', () => {
  assert.match(validateBaseUrl('https://user:secret@example.com').error, /username or password/);
  assert.match(validateBaseUrl('https://example.com/metabase?x=1').error, /query or a hash/);
  assert.match(validateBaseUrl('https://example.com/#card').error, /query or a hash/);
  assert.match(validateBaseUrl('https://localhost:3000').error, /localhost/);
  assert.match(validateBaseUrl('https://127.0.0.1').error, /localhost/);
  assert.match(validateBaseUrl('https://example.com/question/42').error, /question URL/);
  assert.match(validateBaseUrl('https://example.com/api').error, /without \/api/);
});

test('collapses dot segments before the site URL is accepted', () => {
  assert.deepEqual(validateBaseUrl('https://example.com/../secret'), {
    ok: true,
    baseUrl: 'https://example.com/secret',
  });
});

test('parses a question id, a slug, and a question URL', () => {
  assert.deepEqual(parseCardId('42'), { ok: true, cardId: 42 });
  assert.deepEqual(parseCardId('42-orders-by-month'), { ok: true, cardId: 42 });
  assert.deepEqual(parseCardId('https://example.com/question/42-orders'), { ok: true, cardId: 42 });
  assert.deepEqual(parseCardId('https://example.com/model/7-orders'), { ok: true, cardId: 7 });
});

test('rejects missing, zero, and non numeric question ids', () => {
  assert.match(parseCardId('').error, /question ID/);
  assert.match(parseCardId('0').error, /positive whole number/);
  assert.match(parseCardId('12.5').error, /positive whole number/);
  assert.match(parseCardId('abc').error, /positive whole number/);
  assert.match(parseCardId('https://example.com/dashboard/1').error, /does not include a question ID/);
});

test('checks the API key without echoing it', () => {
  assert.equal(validateApiKey('mb_test_key_123').apiKey, 'mb_test_key_123');
  assert.match(validateApiKey('short').error, /does not look valid/);
  assert.match(validateApiKey('mb_test key').error, /does not look valid/);
  assert.match(validateApiKey('').error, /Enter an API key/);
  assert.equal(validateApiKey('  mb_test_key_123  ').apiKey, 'mb_test_key_123');
});

test('accepts only the three schedules plus manual', () => {
  assert.equal(validateSchedule('hourly').schedule, 'hourly');
  assert.equal(validateSchedule('every_6_hours').schedule, 'every_6_hours');
  assert.equal(validateSchedule('daily').schedule, 'daily');
  assert.equal(validateSchedule('').schedule, 'manual');
  assert.equal(validateSchedule('weekly').ok, false);
});

test('formats the last sync time in UTC with a day month year order', () => {
  assert.equal(formatSyncTime('2026-11-09T14:05:00.000Z'), '9 Nov 2026, 14:05 UTC');
  assert.equal(formatSyncTime(''), '');
  assert.equal(formatSyncTime('not-a-date'), '');
});

test('removes the API key from text', () => {
  const secret = 'mb_super_secret_value';
  assert.equal(scrubSecrets('failed for ' + secret, [secret]), 'failed for [redacted]');
  assert.equal(scrubSecrets('X-API-Key: ' + secret, []), 'X-API-Key: [redacted]');
});
