'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/Lib');
const {
  createMemorySheet,
  createProperties,
  createScriptApp,
  createSpreadsheet,
  secretIn,
} = require('./support/fakes');

const API_KEY = 'mb_sync_test_key_123';

function harness(options) {
  const initial = options && options.initial;
  const sheet = createMemorySheet('Results', initial || [], { sheetId: 11 });
  const other = createMemorySheet('Notes', [['leave me']], { sheetId: 12 });
  const userProperties = createProperties();
  const documentProperties = createProperties();
  const scriptApp = createScriptApp();
  if (options && options.existingTrigger) {
    scriptApp.newTrigger('runScheduledSync').timeBased().everyHours(1).create();
  }
  if (options && options.otherTrigger) {
    scriptApp.newTrigger('someOtherHandler').timeBased().everyDays(1).create();
  }
  let clockCalls = 0;
  const services = {
    store: lib.createStore(userProperties, documentProperties),
    spreadsheet: createSpreadsheet([sheet, other], 'Results'),
    scriptApp,
    fetchCalls: [],
    fetch(request) {
      services.fetchCalls.push(request);
      if (options && options.fetch) return options.fetch(request, services.fetchCalls.length);
      return { status: 200, body: '[]' };
    },
    clock() {
      clockCalls += 1;
      if (options && options.times) return new Date(options.times[Math.min(clockCalls, options.times.length) - 1]);
      return new Date('2026-11-09T14:05:00.000Z');
    },
    userProperties,
    documentProperties,
    sheet,
    other,
    clockCalls() {
      return clockCalls;
    },
  };
  if (options && options.storedKey) services.store.setApiKey(options.storedKey);
  return services;
}

function form(overrides) {
  return Object.assign({
    baseUrl: 'https://example.metabaseapp.com/',
    apiKey: API_KEY,
    cardId: '42',
    sheetName: 'Results',
    schedule: 'manual',
  }, overrides);
}

test('sync now writes the mocked json export and stores the key only in user properties', () => {
  const services = harness({
    fetch() {
      return {
        status: 200,
        body: JSON.stringify([
          { City: 'London', Total: 3 },
          { City: 'York', Total: 4 },
        ]),
      };
    },
  });

  const result = lib.syncNowForUser(form({ schedule: 'hourly' }), services);
  assert.equal(result.ok, true);
  assert.equal(result.message, 'Synced 2 rows.');
  assert.equal(result.state.hasApiKey, true);
  assert.equal(result.state.lastSyncLabel, 'Last sync: 9 Nov 2026, 14:05 UTC. 2 rows.');
  assert.equal(result.state.lastError, '');
  assert.equal(Object.prototype.hasOwnProperty.call(result.state, 'apiKey'), false);
  assert.equal(secretIn(result, API_KEY), false);

  assert.deepEqual(services.sheet.readGrid(3, 2), [
    ['City', 'Total'],
    ['London', 3],
    ['York', 4],
  ]);
  assert.deepEqual(services.other.readGrid(1, 1), [['leave me']]);

  const request = services.fetchCalls[0];
  assert.equal(request.url, 'https://example.metabaseapp.com/api/card/42/query/json');
  assert.equal(request.method, 'post');
  assert.equal(request.headers['X-API-Key'], API_KEY);

  assert.equal(services.userProperties.getProperty(lib.USER_API_KEY_PROPERTY), API_KEY);
  assert.equal(secretIn(services.documentProperties.getProperties(), API_KEY), false);
  assert.equal(services.documentProperties.getProperty(lib.DOCUMENT_KEYS.baseUrl), 'https://example.metabaseapp.com');
  assert.equal(services.documentProperties.getProperty(lib.DOCUMENT_KEYS.cardId), '42');
  assert.equal(services.scriptApp.triggers().length, 1);
  assert.equal(services.scriptApp.triggers()[0].spec.everyHours, 1);
});

test('a later smaller result clears only the previous synced block', () => {
  const services = harness({
    fetch(request, count) {
      if (count === 1) {
        return {
          status: 200,
          body: JSON.stringify([
            { A: 'one', B: 'two', C: 'three' },
            { A: 'four', B: 'five', C: 'six' },
          ]),
        };
      }
      return { status: 200, body: JSON.stringify([{ A: 'only' }]) };
    },
  });

  assert.equal(lib.syncNowForUser(form(), services).ok, true);
  // User note typed outside the synced block must survive the next sync.
  services.sheet.getRange(1, 5, 1, 1).setValues([['keep me']]);
  const second = lib.syncNowForUser(form({ apiKey: '' }), services);
  assert.equal(second.ok, true);
  assert.equal(second.message, 'Synced 1 row.');
  assert.deepEqual(services.sheet.readGrid(3, 5), [
    ['A', '', '', '', 'keep me'],
    ['only', '', '', '', ''],
    ['', '', '', '', ''],
  ]);
  assert.equal(services.userProperties.getProperty(lib.USER_API_KEY_PROPERTY), API_KEY);
});

test('an empty export clears the previous rows and reports that', () => {
  const services = harness({
    initial: [['Old'], ['note']],
    fetch() { return { status: 200, body: '[]' }; },
  });
  services.store.setLastRange({ sheetId: 11, rows: 1, cols: 1 });
  let dataRangeCalls = 0;
  const original = services.sheet.getDataRange.bind(services.sheet);
  services.sheet.getDataRange = () => {
    dataRangeCalls += 1;
    return original();
  };
  // User text below the previous synced block must survive.
  const result = lib.syncNowForUser(form(), services);
  assert.equal(result.ok, true);
  assert.equal(result.message, 'The question returned no rows. The previous synced cells were cleared.');
  assert.equal(result.state.lastSyncLabel, 'Last sync: 9 Nov 2026, 14:05 UTC. 0 rows.');
  assert.deepEqual(services.sheet.readGrid(2, 1), [[''], ['note']]);
  assert.equal(dataRangeCalls, 0);
});

test('401, 403, 404, and unreachable Metabase leave the sheet unchanged', () => {
  const cases = [
    { status: 401, pattern: /\(401\)/, expectKeySuffix: true },
    { status: 403, pattern: /\(403\)/, expectKeySuffix: false },
    { status: 404, pattern: /\(404\)/, expectKeySuffix: false },
    { status: 0, networkError: true, pattern: /could not be reached/, expectKeySuffix: false },
  ];

  for (const item of cases) {
    const services = harness({
      initial: [['Keep', 'me'], ['a', 'b']],
      storedKey: 'mb_previous_key_999',
      fetch() {
        return { status: item.status, networkError: item.networkError, body: API_KEY };
      },
    });
    const result = lib.syncNowForUser(form(), services);
    assert.equal(result.ok, false);
    assert.match(result.error, item.pattern);
    assert.equal(result.error.includes(API_KEY), false);
    if (item.expectKeySuffix) {
      assert.match(result.error, /previous API key is still saved/);
    } else {
      assert.equal(result.error.includes('previous API key is still saved'), false);
      assert.equal(result.error.includes('API key was not saved'), false);
    }
    assert.deepEqual(services.sheet.readGrid(2, 2), [['Keep', 'me'], ['a', 'b']]);
    assert.equal(services.userProperties.getProperty(lib.USER_API_KEY_PROPERTY), 'mb_previous_key_999');
    assert.equal(secretIn(services.documentProperties.getProperties(), API_KEY), false);
    assert.equal(result.state.lastError.includes(API_KEY), false);
  }
});

test('a 404 with the stored key unchanged does not mention the previous API key', () => {
  const services = harness({
    initial: [['Keep']],
    storedKey: 'mb_previous_key_999',
    fetch() {
      return { status: 404, body: '' };
    },
  });
  const result = lib.syncNowForUser(form({ apiKey: '' }), services);
  assert.equal(result.ok, false);
  assert.match(result.error, /\(404\)/);
  assert.equal(result.error.includes('previous API key is still saved'), false);
  assert.equal(services.userProperties.getProperty(lib.USER_API_KEY_PROPERTY), 'mb_previous_key_999');
});

test('a rejected new key with no prior key says the API key was not saved', () => {
  const services = harness({
    fetch() {
      return { status: 401, body: '' };
    },
  });
  const result = lib.syncNowForUser(form(), services);
  assert.equal(result.ok, false);
  assert.match(result.error, /\(401\)/);
  assert.match(result.error, /API key was not saved/);
  assert.equal(services.userProperties.getProperty(lib.USER_API_KEY_PROPERTY), null);
});

test('a failed sync keeps the previous last sync time and a success clears the error', () => {
  const services = harness({
    times: ['2026-11-09T14:05:00.000Z', '2026-11-09T18:00:00.000Z'],
    fetch(request, count) {
      if (count === 1) return { status: 200, body: JSON.stringify([{ City: 'London' }]) };
      return { status: 404, body: '{"message":"missing ' + API_KEY + '"}' };
    },
  });

  const first = lib.syncNowForUser(form(), services);
  assert.equal(first.state.lastSyncLabel, 'Last sync: 9 Nov 2026, 14:05 UTC. 1 row.');

  const second = lib.syncNowForUser(form({ apiKey: '' }), services);
  assert.equal(second.ok, false);
  assert.match(second.error, /\(404\)/);
  assert.equal(second.state.lastSyncLabel, 'Last sync: 9 Nov 2026, 14:05 UTC. 1 row.');
  assert.match(second.state.lastError, /\(404\)/);
  assert.deepEqual(services.sheet.readGrid(2, 1), [['City'], ['London']]);

  services.fetch = (request) => {
    services.fetchCalls.push(request);
    return { status: 200, body: JSON.stringify([{ City: 'York' }]) };
  };
  const third = lib.syncNowForUser(form({ apiKey: '' }), services);
  assert.equal(third.ok, true);
  assert.equal(third.state.lastError, '');
  assert.match(third.state.lastSyncLabel, /18:00 UTC/);
});

test('a redirect is not treated as data', () => {
  const services = harness({
    initial: [['Stay']],
    fetch() { return { status: 302, body: '' }; },
  });
  const result = lib.syncNowForUser(form(), services);
  assert.match(result.error, /redirected/);
  assert.deepEqual(services.sheet.readGrid(1, 1), [['Stay']]);
  assert.equal(services.userProperties.getProperty(lib.USER_API_KEY_PROPERTY), null);
});

test('sidebar state never returns the API key', () => {
  const services = harness({ storedKey: API_KEY });
  services.store.setConfig({
    baseUrl: 'https://example.metabaseapp.com',
    cardId: '42',
    sheetName: 'Results',
    schedule: 'daily',
  });
  services.store.setStatus({
    lastSyncAt: '2026-11-09T14:05:00.000Z',
    lastError: '',
    lastRowCount: 4,
  });
  const state = lib.buildSidebarState(services);
  assert.equal(state.hasApiKey, true);
  assert.equal(secretIn(state, API_KEY), false);
  assert.equal(state.lastSyncLabel, 'Last sync: 9 Nov 2026, 14:05 UTC. 4 rows.');
  assert.deepEqual(state.schedules.map((item) => item.id), ['manual', 'hourly', 'every_6_hours', 'daily']);
});

test('save stores settings and replaces the previous schedule trigger', () => {
  const services = harness({ existingTrigger: true, otherTrigger: true, storedKey: API_KEY });
  const saved = lib.saveSettingsForUser(form({ apiKey: '', schedule: 'every_6_hours' }), services);
  assert.equal(saved.ok, true);
  assert.equal(saved.message, 'Saved.');
  const ours = services.scriptApp.triggers().filter((trigger) => trigger.getHandlerFunction() === 'runScheduledSync');
  const others = services.scriptApp.triggers().filter((trigger) => trigger.getHandlerFunction() === 'someOtherHandler');
  assert.equal(ours.length, 1);
  assert.equal(ours[0].spec.everyHours, 6);
  assert.equal(others.length, 1);

  const daily = lib.saveSettingsForUser(form({ apiKey: '', schedule: 'daily' }), services);
  assert.equal(daily.ok, true);
  const dailyTriggers = services.scriptApp.triggers().filter((trigger) => trigger.getHandlerFunction() === 'runScheduledSync');
  assert.equal(dailyTriggers.length, 1);
  assert.equal(dailyTriggers[0].spec.everyDays, 1);
  assert.equal(dailyTriggers[0].spec.everyHours, undefined);

  const manual = lib.saveSettingsForUser(form({ apiKey: '', schedule: 'manual' }), services);
  assert.equal(manual.ok, true);
  assert.equal(
    services.scriptApp.triggers().some((trigger) => trigger.getHandlerFunction() === 'runScheduledSync'),
    false,
  );
});

test('a schedule cannot be turned on without an API key', () => {
  const services = harness();
  const result = lib.saveSettingsForUser(form({ apiKey: '', schedule: 'hourly' }), services);
  assert.equal(result.ok, false);
  assert.match(result.error, /API key/);
  assert.equal(services.scriptApp.triggers().length, 0);
  assert.equal(services.documentProperties.getProperty(lib.DOCUMENT_KEYS.schedule), null);
});

test('removing the API key turns the schedule off', () => {
  const services = harness({ storedKey: API_KEY, existingTrigger: true });
  const result = lib.saveSettingsForUser(form({
    apiKey: '',
    removeApiKey: true,
    schedule: 'hourly',
  }), services);
  assert.equal(result.ok, true);
  assert.match(result.message, /removed/);
  assert.equal(result.state.hasApiKey, false);
  assert.equal(result.state.schedule, 'manual');
  assert.equal(services.userProperties.getProperty(lib.USER_API_KEY_PROPERTY), null);
  assert.equal(services.scriptApp.triggers().length, 0);
});

test('load questions calls the list endpoint and does not save a new key', () => {
  const services = harness({
    fetch(request) {
      assert.equal(request.method, 'get');
      assert.equal(request.url, 'https://example.metabaseapp.com/api/card');
      assert.equal(request.headers['X-API-Key'], API_KEY);
      return {
        status: 200,
        body: JSON.stringify([
          { id: 8, name: 'Revenue', dataset_query: { native: { query: 'secret sql' } } },
          { id: 2, name: 'Archived', archived: true },
        ]),
      };
    },
  });
  const result = lib.loadQuestionsForUser(form(), services);
  assert.equal(result.ok, true);
  assert.deepEqual(result.questions, [{ id: 8, name: 'Revenue', type: 'question' }]);
  assert.equal(secretIn(result, 'secret sql'), false);
  assert.equal(secretIn(result, API_KEY), false);
  assert.equal(services.userProperties.getProperty(lib.USER_API_KEY_PROPERTY), null);
  assert.equal(services.sheet.readGrid(1, 1)[0][0], '');
});

test('the scheduled sync uses the saved key and records a scrubbed error', () => {
  const services = harness({
    storedKey: API_KEY,
    fetch() {
      return { status: 500, body: JSON.stringify({ error: 'boom ' + API_KEY }) };
    },
  });
  services.store.setConfig({
    baseUrl: 'https://example.metabaseapp.com',
    cardId: '42',
    sheetName: 'Results',
    schedule: 'hourly',
  });

  assert.throws(() => lib.runScheduledSyncForUser(services), (error) => {
    assert.match(error.message, /\(500\)/);
    assert.match(error.message, /\[redacted\]/);
    assert.equal(error.message.includes(API_KEY), false);
    return true;
  });
  assert.match(services.store.getConfig().lastError, /\[redacted\]/);
  assert.equal(services.store.getConfig().lastError.includes(API_KEY), false);
  assert.equal(services.sheet.readGrid(1, 1)[0][0], '');
});

test('the scheduled sync writes rows when Metabase responds', () => {
  const services = harness({
    storedKey: API_KEY,
    fetch(request) {
      assert.equal(request.headers['X-API-Key'], API_KEY);
      assert.equal(request.url, 'https://example.metabaseapp.com/api/card/15/query/json');
      return { status: 200, body: JSON.stringify([{ Orders: 10 }]) };
    },
  });
  services.store.setConfig({
    baseUrl: 'https://example.metabaseapp.com',
    cardId: '15-orders',
    sheetName: 'Results',
    schedule: 'daily',
  });
  const result = lib.runScheduledSyncForUser(services);
  assert.equal(result.rowsWritten, 1);
  assert.deepEqual(services.sheet.readGrid(2, 1), [['Orders'], [10]]);
  assert.equal(services.store.getConfig().lastError, '');
});

test('http URLs and missing sheets fail before any request', () => {
  const services = harness();
  const http = lib.syncNowForUser(form({ baseUrl: 'http://example.metabaseapp.com' }), services);
  assert.match(http.error, /https/);
  assert.equal(services.fetchCalls.length, 0);

  const missing = lib.syncNowForUser(form({ sheetName: 'Missing' }), services);
  assert.match(missing.error, /not in this spreadsheet/);
  assert.equal(services.fetchCalls.length, 0);
});
