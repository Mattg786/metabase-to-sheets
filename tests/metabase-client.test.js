'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCardQueryRequest,
  buildCardListRequest,
  parseJsonExport,
  parseCardList,
  interpretQueryResponse,
  interpretListResponse,
  fetchMetabase,
} = require('../src/Lib');

const API_KEY = 'mb_test_key_value';

test('builds a POST json export request and keeps the key out of the URL and body', () => {
  const request = buildCardQueryRequest('https://example.metabaseapp.com', 42, API_KEY);
  assert.equal(request.url, 'https://example.metabaseapp.com/api/card/42/query/json');
  assert.equal(request.method, 'post');
  assert.equal(request.headers['X-API-Key'], API_KEY);
  assert.equal(request.payload, '{"format_rows":false,"pivot_results":false}');
  assert.equal(request.followRedirects, false);
  assert.equal(request.url.includes(API_KEY), false);
  assert.equal(request.payload.includes(API_KEY), false);
});

test('builds a GET request for the question list', () => {
  const request = buildCardListRequest('https://bi.example.com/metabase', API_KEY);
  assert.equal(request.url, 'https://bi.example.com/metabase/api/card');
  assert.equal(request.method, 'get');
  assert.equal(request.payload, undefined);
  assert.equal(request.headers['X-API-Key'], API_KEY);
});

test('parses json rows without inventing columns and keeps numbers', () => {
  const table = parseJsonExport([
    { Count: 2, Name: 'Ada', Active: true, Note: null },
    { Count: 3, Name: 'Grace', Active: false, Extra: 'yes' },
  ]);
  assert.deepEqual(table.headers, ['Count', 'Name', 'Active', 'Note', 'Extra']);
  assert.deepEqual(table.rows, [
    [2, 'Ada', true, '', ''],
    [3, 'Grace', false, '', 'yes'],
  ]);
  assert.equal(table.headers.includes('Last sync'), false);
});

test('preserves the first row key order', () => {
  const table = parseJsonExport([{ b: 1, a: 2 }]);
  assert.deepEqual(table.headers, ['b', 'a']);
  assert.deepEqual(table.rows, [[1, 2]]);
});

test('stringifies object cells and rejects rows that are not objects', () => {
  const table = parseJsonExport([{ Meta: { id: 1 } }]);
  assert.deepEqual(table.rows, [['{"id":1}']]);
  assert.throws(() => parseJsonExport([{ ok: true }, 'bad']), /not an object/);
  assert.throws(() => parseJsonExport({ data: [] }), /not a list of rows/);
});

test('an empty json export has no headers and no rows', () => {
  assert.deepEqual(parseJsonExport('[]'), { headers: [], rows: [] });
});

test('maps 401, 403, 404, redirects, and network failures without copying the key', () => {
  const leaked = '{"message":"bad ' + API_KEY + '"}';
  const unauthorised = interpretQueryResponse({ status: 401, body: leaked }, API_KEY);
  assert.equal(unauthorised.ok, false);
  assert.match(unauthorised.error, /\(401\)/);
  assert.equal(unauthorised.error.includes(API_KEY), false);

  assert.match(interpretQueryResponse({ status: 403, body: '' }, API_KEY).error, /\(403\)/);
  assert.match(interpretQueryResponse({ status: 404, body: '' }, API_KEY).error, /\(404\)/);
  assert.match(interpretQueryResponse({ status: 302, body: '' }, API_KEY).error, /redirected/);
  assert.match(interpretQueryResponse({ status: 0, networkError: true }, API_KEY).error, /could not be reached/);
  assert.match(interpretQueryResponse({ status: 202, body: '' }, API_KEY).error, /not finished/);
});

test('includes a scrubbed Metabase message for other errors', () => {
  const result = interpretQueryResponse({
    status: 400,
    body: JSON.stringify({ message: 'Missing parameter ' + API_KEY }),
  }, API_KEY);
  assert.match(result.error, /rejected the query \(400\)/);
  assert.match(result.error, /Missing parameter \[redacted\]/);
  assert.equal(result.error.includes(API_KEY), false);

  const server = interpretQueryResponse({
    status: 500,
    body: JSON.stringify({ error: 'database offline' }),
  }, API_KEY);
  assert.match(server.error, /could not run the query \(500\)/);
  assert.match(server.error, /database offline/);
});

test('rejects a successful response that is not a json row list', () => {
  const result = interpretQueryResponse({ status: 200, body: '{"status":"failed","error":"bad query"}' }, API_KEY);
  assert.equal(result.ok, false);
  assert.match(result.error, /bad query/);

  const html = interpretQueryResponse({ status: 200, body: '<html>nope</html>' }, API_KEY);
  assert.match(html.error, /not JSON/);
});

test('parses the question list and skips archived cards and extra fields', () => {
  const parsed = parseCardList([
    { id: 2, name: 'Alpha', type: 'question', dataset_query: { type: 'native', native: { query: 'select 1' } } },
    { id: 1, name: 'Alpha', archived: false },
    { id: 3, name: 'Bravo', type: 'model' },
    { id: 4, name: 'Old', archived: true },
    { id: '5', name: 'String id' },
    { id: 9 },
  ]);
  assert.deepEqual(parsed.questions, [
    { id: 1, name: 'Alpha', type: 'question' },
    { id: 2, name: 'Alpha', type: 'question' },
    { id: 3, name: 'Bravo', type: 'model' },
    { id: 9, name: 'Question 9', type: 'question' },
  ]);
  assert.equal(JSON.stringify(parsed).includes('select 1'), false);
  assert.equal(parsed.truncated, false);
});

test('caps the optional question list at 500 names', () => {
  const cards = [];
  for (let i = 1; i <= 501; i += 1) {
    cards.push({ id: i, name: 'Q' + String(i).padStart(4, '0') });
  }
  const parsed = parseCardList(cards);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.questions.length, 500);
  assert.equal(parsed.questions[0].name, 'Q0001');
  assert.equal(parsed.questions[499].name, 'Q0500');
});

test('the list endpoint reports auth and transport errors', () => {
  assert.match(interpretListResponse({ status: 401, body: API_KEY }, API_KEY).error, /\(401\)/);
  assert.equal(interpretListResponse({ status: 401, body: API_KEY }, API_KEY).error.includes(API_KEY), false);
  assert.match(interpretListResponse({ status: 404, body: '' }, API_KEY).error, /site URL/);
  assert.match(interpretListResponse({ status: 403, body: '' }, API_KEY).error, /question list/);
  assert.equal(interpretListResponse({ status: 200, body: '[]' }, API_KEY).questions.length, 0);
});

test('UrlFetchApp calls do not follow redirects and network errors stay generic', () => {
  const calls = [];
  const ok = fetchMetabase({
    fetch(url, options) {
      calls.push({ url, options });
      return {
        getResponseCode() { return 200; },
        getContentText() { return '[]'; },
      };
    },
  }, buildCardQueryRequest('https://example.metabaseapp.com', 7, API_KEY));

  assert.equal(ok.status, 200);
  assert.equal(calls[0].options.followRedirects, false);
  assert.equal(calls[0].options.muteHttpExceptions, true);
  assert.equal(calls[0].options.validateHttpsCertificates, true);
  assert.equal(calls[0].options.headers['X-API-Key'], API_KEY);
  assert.equal(calls[0].options.payload.includes(API_KEY), false);
  assert.equal(JSON.stringify(calls[0].options).includes('Logger'), false);

  const failed = fetchMetabase({
    fetch() {
      throw new Error('DNS error for ' + API_KEY);
    },
  }, buildCardQueryRequest('https://example.metabaseapp.com', 7, API_KEY));
  assert.equal(failed.networkError, true);
  assert.equal(failed.body, '');
});
