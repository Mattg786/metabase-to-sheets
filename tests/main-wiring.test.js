'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  createMemorySheet,
  createProperties,
  createScriptApp,
  createSpreadsheet,
} = require('./support/fakes');

test('the sheet menu and Sync now call the mocked Metabase API', () => {
  const sheet = createMemorySheet('Results', []);
  const userProperties = createProperties();
  const documentProperties = createProperties();
  const scriptApp = createScriptApp();
  const fetchCalls = [];
  const ui = {
    menu: null,
    sidebar: null,
    createMenu(name) {
      return {
        name,
        items: [],
        addItem(label, handler) {
          this.items.push({ label, handler });
          return this;
        },
        addToUi() {
          ui.menu = this;
          return this;
        },
      };
    },
    showSidebar(html) {
      ui.sidebar = html;
    },
  };

  const context = {
    URL,
    SpreadsheetApp: {
      getUi() {
        return ui;
      },
      getActiveSpreadsheet() {
        return createSpreadsheet([sheet], 'Results');
      },
    },
    HtmlService: {
      createHtmlOutputFromFile(filename) {
        return {
          filename,
          title: '',
          width: 0,
          setTitle(title) {
            this.title = title;
            return this;
          },
          setWidth(width) {
            this.width = width;
            return this;
          },
        };
      },
    },
    PropertiesService: {
      getUserProperties() {
        return userProperties;
      },
      getDocumentProperties() {
        return documentProperties;
      },
    },
    ScriptApp: scriptApp,
    UrlFetchApp: {
      fetch(url, options) {
        fetchCalls.push({ url, options });
        return {
          getResponseCode() {
            return 200;
          },
          getContentText() {
            return JSON.stringify([{ City: 'Paris', Total: 1 }]);
          },
        };
      },
    },
  };

  vm.createContext(context);
  for (const file of ['Lib.js', 'Main.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  }

  context.onOpen();
  assert.equal(ui.menu.name, 'Metabase to Sheets');
  assert.deepEqual(ui.menu.items, [{ label: 'Open', handler: 'showSidebar' }]);

  context.showSidebar();
  assert.equal(ui.sidebar.filename, 'Sidebar');
  assert.equal(ui.sidebar.title, 'Metabase to Sheets');

  const apiKey = 'mb_wire_test_key_123';
  const result = context.syncNow({
    baseUrl: 'https://example.metabaseapp.com',
    apiKey,
    cardId: '5',
    sheetName: 'Results',
    schedule: 'manual',
  });

  assert.equal(result.ok, true);
  assert.equal(result.message, 'Synced 1 row.');
  assert.deepEqual(sheet.readGrid(2, 2), [
    ['City', 'Total'],
    ['Paris', 1],
  ]);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://example.metabaseapp.com/api/card/5/query/json');
  assert.equal(fetchCalls[0].options.method, 'post');
  assert.equal(fetchCalls[0].options.followRedirects, false);
  assert.equal(fetchCalls[0].options.muteHttpExceptions, true);
  assert.equal(fetchCalls[0].options.headers['X-API-Key'], apiKey);
  assert.equal(fetchCalls[0].options.payload.includes(apiKey), false);
  assert.equal(userProperties.getProperty('METABASE_API_KEY'), apiKey);
  assert.equal(JSON.stringify(documentProperties.getProperties()).includes(apiKey), false);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  assert.equal(typeof context.runScheduledSync, 'function');
  assert.equal(typeof context.getSidebarState, 'function');
  assert.equal(typeof context.loadQuestions, 'function');

  const hydrated = context.getSidebarState();
  assert.equal(hydrated.hasLicenceKey, false);
  assert.equal(hydrated.licencePlan, 'free');
  assert.equal(JSON.stringify(hydrated.schedules.map((item) => item.id)), JSON.stringify(['manual', 'hourly', 'every_6_hours', 'daily']));

  const saved = context.saveSettings({
    baseUrl: 'https://example.metabaseapp.com',
    apiKey,
    cardId: '5',
    sheetName: 'Results',
    schedule: 'daily',
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.state.schedule, 'daily');

  const secondKey = 'mb_second_key_999999';
  userProperties.setProperty = function () {
    throw new Error('store failed for ' + apiKey + ' and ' + secondKey);
  };
  const failed = context.syncNow({
    baseUrl: 'https://example.metabaseapp.com',
    apiKey: secondKey,
    cardId: '5',
    sheetName: 'Results',
    schedule: 'manual',
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.includes(apiKey), false);
  assert.equal(failed.error.includes(secondKey), false);
  assert.match(failed.error, /\[redacted\]/);

  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'src', 'Sidebar.html'), 'utf8');
  assert.match(sidebar, /applyState/);
  assert.match(sidebar, /withFailureHandler/);
  assert.match(sidebar, /saveSettings/);
  assert.match(sidebar, /licence-status/);
});
