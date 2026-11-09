'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HOURLY_ERROR = 'Hourly and Every 6 hours require an active Pro licence. Manual sync and Daily remain available.';
const PRO_HINT = 'Pro plan. Active Pro subscription verified.';
const FREE_HINT = 'Free plan. Manual sync and Daily are available.';
const INVALID_HINT = 'Free plan. Unrecognised licence key.';

function createNode(id, tag, hidden) {
  const node = {
    id,
    tag,
    textContent: '',
    value: '',
    checked: false,
    placeholder: '',
    disabled: false,
    selected: false,
    children: [],
    listeners: {},
    firstChild: null,
    appendChild(child) {
      this.children.push(child);
      this.firstChild = this.children[0];
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
  node.classList = {
    names: new Set(hidden ? ['hidden'] : []),
    add(name) { this.names.add(name); },
    remove(name) { this.names.delete(name); },
    contains(name) { return this.names.has(name); },
  };
  return node;
}

function loadSidebar() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Sidebar.html'), 'utf8');
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  const ids = [
    ['base-url', 'input'],
    ['api-key', 'input'],
    ['remove-key', 'input'],
    ['licence-key', 'input'],
    ['remove-licence', 'input'],
    ['card-id', 'input'],
    ['remove-key-row', 'label', true],
    ['remove-licence-row', 'label', true],
    ['licence-status', 'p'],
    ['sheet-name', 'select'],
    ['schedule', 'select'],
    ['question-select', 'select'],
    ['question-picker', 'div', true],
    ['question-note', 'p', true],
    ['save', 'button'],
    ['sync', 'button'],
    ['load-questions', 'button'],
    ['notice', 'p', true],
    ['last-sync', 'p'],
    ['error', 'p', true],
    ['settings-form', 'form'],
  ];
  const nodes = {};
  for (const [id, tag, hidden] of ids) nodes[id] = createNode(id, tag, hidden);
  nodes['licence-status'].textContent = FREE_HINT;
  nodes['last-sync'].textContent = 'Not synced yet.';
  const calls = [];
  const elements = Object.values(nodes);
  const document = {
    getElementById(id) { return nodes[id]; },
    querySelectorAll() { return elements.filter((node) => node.tag === 'button' || node.tag === 'input' || node.tag === 'select'); },
    createElement() { return createNode('', 'option'); },
  };
  const context = { document, calls, console };
  vm.createContext(context);
  vm.runInContext(`
    var google = {
      script: {
        get run() {
          var call = {};
          function track(method) {
            return function (form) {
              call.method = method;
              call.form = form;
              calls.push(call);
            };
          }
          var api = {
            withSuccessHandler: function (fn) { call.success = fn; return api; },
            withFailureHandler: function (fn) { call.failure = fn; return api; },
            getSidebarState: track('getSidebarState'),
            saveSettings: track('saveSettings'),
            syncNow: track('syncNow'),
            loadQuestions: track('loadQuestions')
          };
          return api;
        }
      }
    };
  ` + script, context, { filename: 'Sidebar.html' });
  return { nodes, calls };
}

function savedState(overrides) {
  return Object.assign({
    baseUrl: 'https://example.metabaseapp.com',
    cardId: '42',
    sheetName: 'Results',
    activeSheetName: 'Results',
    sheets: ['Results'],
    schedules: [
      { id: 'manual', label: 'Manual only' },
      { id: 'hourly', label: 'Hourly' },
      { id: 'every_6_hours', label: 'Every 6 hours' },
      { id: 'daily', label: 'Daily' },
    ],
    schedule: 'daily',
    hasApiKey: true,
    hasLicenceKey: false,
    licencePlan: 'free',
    licenceStatus: FREE_HINT,
    lastSyncLabel: 'Not synced yet.',
    lastError: '',
  }, overrides);
}

function openSidebar() {
  const ui = loadSidebar();
  assert.equal(ui.calls[0].method, 'getSidebarState');
  ui.calls[0].success(savedState());
  return ui;
}

test('save and sync clear a stale Pro error on the next attempt and on success', () => {
  const ui = openSidebar();
  ui.nodes['licence-key'].value = 'kept-typed-key';
  ui.nodes.save.listeners.click();
  const failed = ui.calls.at(-1);
  failed.success({
    ok: false,
    error: HOURLY_ERROR,
    state: {
      lastSyncLabel: 'Not synced yet.',
      licencePlan: 'free',
      licenceStatus: FREE_HINT,
    },
  });
  assert.equal(ui.nodes.error.textContent, 'Error: ' + HOURLY_ERROR);
  assert.equal(ui.nodes.error.classList.contains('hidden'), false);
  assert.equal(ui.nodes['licence-key'].value, 'kept-typed-key');

  for (const button of [ui.nodes.save, ui.nodes.sync]) {
    button.listeners.click();
    assert.equal(ui.nodes.error.textContent, '');
    assert.equal(ui.nodes.error.classList.contains('hidden'), true);
    const pending = ui.calls.at(-1);
    pending.success({
      ok: false,
      error: HOURLY_ERROR,
      state: { lastSyncLabel: 'Not synced yet.', licenceStatus: FREE_HINT },
    });
  }

  ui.nodes.save.listeners.click();
  assert.equal(ui.nodes.error.textContent, '');
  const succeeded = ui.calls.at(-1);
  succeeded.success({
    ok: true,
    message: 'Saved.',
    state: savedState({
      licencePlan: 'pro',
      licenceStatus: PRO_HINT,
      hasLicenceKey: true,
      schedule: 'hourly',
      lastError: HOURLY_ERROR,
    }),
  });
  assert.equal(ui.nodes.error.textContent, '');
  assert.equal(ui.nodes.error.classList.contains('hidden'), true);
  assert.equal(ui.nodes.notice.textContent, 'Saved.');
  assert.equal(ui.nodes['licence-status'].textContent, PRO_HINT);

  failed.success({
    ok: false,
    error: HOURLY_ERROR,
    state: { lastSyncLabel: 'Not synced yet.', licenceStatus: FREE_HINT },
  });
  assert.equal(ui.nodes.error.textContent, '');
  assert.equal(ui.nodes['licence-status'].textContent, PRO_HINT);
  assert.equal(ui.nodes.notice.textContent, 'Saved.');
});

test('a failed licence save refreshes the hint and ignores an older success', () => {
  const ui = openSidebar();
  ui.calls[0].success(savedState({
    licencePlan: 'pro',
    licenceStatus: PRO_HINT,
    hasLicenceKey: true,
    schedule: 'hourly',
  }));
  assert.equal(ui.nodes['licence-status'].textContent, PRO_HINT);

  ui.nodes.save.listeners.click();
  const first = ui.calls.at(-1);
  ui.nodes.save.listeners.click();
  assert.equal(ui.calls.at(-1), first);

  first.success({
    ok: false,
    error: 'Unrecognised licence key.',
    state: {
      lastSyncLabel: 'Not synced yet.',
      licencePlan: 'free',
      licenceStatus: INVALID_HINT,
    },
  });
  assert.equal(ui.nodes.error.textContent, 'Error: Unrecognised licence key.');
  assert.equal(ui.nodes.error.textContent.includes('Hourly'), false);
  assert.equal(ui.nodes['licence-status'].textContent, INVALID_HINT);

  ui.nodes.sync.listeners.click();
  const newer = ui.calls.at(-1);
  newer.success({
    ok: true,
    message: 'Saved.',
    state: savedState({ licencePlan: 'pro', licenceStatus: PRO_HINT, hasLicenceKey: true }),
  });
  first.success({
    ok: true,
    message: 'Saved.',
    state: savedState({ licencePlan: 'pro', licenceStatus: PRO_HINT, lastError: HOURLY_ERROR }),
  });
  assert.equal(ui.nodes.error.textContent, '');
  assert.equal(ui.nodes['licence-status'].textContent, PRO_HINT);
});
