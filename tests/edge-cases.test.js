'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/Lib');
const { writeTable, protectLargeIntegersInJson, parseJsonExport, interpretQueryResponse } = lib;
const {
  createMemorySheet,
  createProperties,
  createScriptApp,
  createSpreadsheet,
} = require('./support/fakes');

test('string cells that look like formulas stay literal text with @ number format', () => {
  const sheet = createMemorySheet('Results', [], { sheetId: 21 });
  writeTable(sheet, {
    headers: ['Label', 'Code'],
    rows: [
      ['=1+1', '00123'],
      ['+hello', '00456'],
      ['-456', 'text'],
      ['@mention', 'ok'],
    ],
  });
  assert.deepEqual(sheet.readGrid(5, 2), [
    ['Label', 'Code'],
    ['=1+1', '00123'],
    ['+hello', '00456'],
    ['-456', 'text'],
    ['@mention', 'ok'],
  ]);
  assert.equal(sheet.readNumberFormat(2, 1), '@');
  assert.equal(sheet.readNumberFormat(2, 2), '@');
  assert.equal(sheet.readNumberFormat(1, 1), '@');

  const ops = sheet.writeOps();
  const firstFormat = ops.findIndex((item) => item.op === 'setNumberFormat');
  const firstWrite = ops.findIndex((item) => item.op === 'setValues');
  assert.notEqual(firstFormat, -1);
  assert.notEqual(firstWrite, -1);
  assert.ok(firstFormat < firstWrite, 'text format must be applied before setValues');

  const written = ops.find((item) => item.op === 'setValues');
  assert.equal(written.values[1][0], "'=1+1");
  assert.equal(written.values[2][0], "'+hello");
  assert.equal(written.values[3][0], "'-456");
  assert.equal(written.values[4][0], "'@mention");
});

test('mixed-type columns keep string cells literal and numbers as numbers', () => {
  const sheet = createMemorySheet('Results', [], { sheetId: 23 });
  writeTable(sheet, {
    headers: ['Value'],
    rows: [
      ['=1+1'],
      [2],
      ['-456'],
      ['00123'],
    ],
  });
  assert.deepEqual(sheet.readGrid(5, 1), [
    ['Value'],
    ['=1+1'],
    [2],
    ['-456'],
    ['00123'],
  ]);
  assert.equal(typeof sheet.readGrid(5, 1)[2][0], 'number');
  assert.equal(sheet.readNumberFormat(2, 1), '@');
  assert.equal(sheet.readNumberFormat(3, 1), '');
  assert.equal(sheet.readNumberFormat(4, 1), '@');
  assert.equal(sheet.readNumberFormat(5, 1), '@');

  const ops = sheet.writeOps();
  const firstFormat = ops.findIndex((item) => item.op === 'setNumberFormat');
  const firstWrite = ops.findIndex((item) => item.op === 'setValues');
  assert.ok(firstFormat < firstWrite);
  const written = ops.find((item) => item.op === 'setValues');
  assert.equal(written.values[1][0], "'=1+1");
  assert.equal(written.values[2][0], 2);
  assert.equal(written.values[3][0], "'-456");
  assert.equal(written.values[4][0], '00123');
});

test('needsLiteralPrefix covers = + - @ only', () => {
  assert.equal(lib.needsLiteralPrefix('=1+1'), true);
  assert.equal(lib.needsLiteralPrefix('+hello'), true);
  assert.equal(lib.needsLiteralPrefix('-456'), true);
  assert.equal(lib.needsLiteralPrefix('@x'), true);
  assert.equal(lib.needsLiteralPrefix('00123'), false);
  assert.equal(lib.needsLiteralPrefix(''), false);
  assert.equal(lib.toLiteralSheetValue('=1+1'), "'=1+1");
  assert.equal(lib.toLiteralSheetValue('plain'), 'plain');
});

test('number columns stay numbers and are not forced to text format', () => {
  const sheet = createMemorySheet('Results', [], { sheetId: 22 });
  writeTable(sheet, {
    headers: ['City', 'Total'],
    rows: [['London', 3], ['York', 4]],
  });
  assert.equal(typeof sheet.readGrid(2, 2)[1][1], 'number');
  assert.equal(sheet.readNumberFormat(2, 2), '');
  assert.equal(sheet.readNumberFormat(2, 1), '@');
});

test('integers beyond Number.MAX_SAFE_INTEGER are kept as exact text', () => {
  const raw = '[{"id":9007199254740993,"ok":1}]';
  const protectedRaw = protectLargeIntegersInJson(raw);
  assert.match(protectedRaw, /"9007199254740993"/);
  const parsed = JSON.parse(protectedRaw);
  assert.equal(parsed[0].id, '9007199254740993');
  const table = parseJsonExport(parsed);
  assert.equal(table.rows[0][0], '9007199254740993');

  const interpreted = interpretQueryResponse({ status: 200, body: raw }, 'key');
  assert.equal(interpreted.ok, true);
  assert.equal(interpreted.table.rows[0][0], '9007199254740993');
  assert.equal(interpreted.table.rows[0][1], 1);
});

test('a later sync does not wipe cells typed outside the synced block', () => {
  const sheet = createMemorySheet('Results', [
    ['A', 'B'],
    ['1', '2'],
    ['user note', ''],
  ], { sheetId: 30, maxColumns: 10 });
  // Pretend only the 2x2 block was previously synced; row 3 is user data.
  writeTable(sheet, {
    headers: ['A'],
    rows: [['only']],
  }, { previousRange: { sheetId: 30, rows: 2, cols: 2 } });
  assert.deepEqual(sheet.readGrid(3, 2), [
    ['A', ''],
    ['only', ''],
    ['user note', ''],
  ]);
});

test('a zero-row sync clears only the last synced block and never calls getDataRange', () => {
  const sheet = createMemorySheet('Results', [
    ['City', 'Total'],
    ['London', 3],
    ['keep below', 'keep'],
  ], { sheetId: 31, maxColumns: 10 });
  let dataRangeCalls = 0;
  const original = sheet.getDataRange.bind(sheet);
  sheet.getDataRange = () => {
    dataRangeCalls += 1;
    return original();
  };
  const written = writeTable(sheet, { headers: [], rows: [] }, {
    previousRange: { sheetId: 31, rows: 2, cols: 2 },
  });
  assert.deepEqual(written.range, { sheetId: 31, rows: 0, cols: 0 });
  assert.deepEqual(sheet.readGrid(3, 2), [
    ['', ''],
    ['', ''],
    ['keep below', 'keep'],
  ]);
  assert.equal(dataRangeCalls, 0);
});

test('refuses a sync that would push the spreadsheet past the cell budget', () => {
  const sheet = createMemorySheet('Results', [], {
    sheetId: 40,
    maxRows: 5_000_000,
    maxColumns: 2,
  });
  const other = createMemorySheet('Notes', [], {
    sheetId: 41,
    maxRows: 1,
    maxColumns: 1,
  });
  const spreadsheet = createSpreadsheet([sheet, other], 'Results');
  assert.throws(
    () => writeTable(sheet, {
      headers: ['A', 'B', 'C'],
      rows: [[1, 2, 3]],
    }, { spreadsheet }),
    /cell limit/,
  );
  assert.deepEqual(sheet.readGrid(1, 1), [['']]);
});

test('JSON object keys collapse duplicate column names; documented limitation', () => {
  const table = parseJsonExport([
    { A: 1, B: 2 },
  ]);
  // A second "A" cannot appear in a JSON object. This documents the format limit.
  assert.deepEqual(table.headers, ['A', 'B']);
  const collapsed = JSON.parse('[{"A":1,"A":9,"B":2}]');
  assert.equal(collapsed[0].A, 9);
  assert.deepEqual(Object.keys(collapsed[0]), ['A', 'B']);
});

test('store remembers the last written range per configuration', () => {
  const userProperties = createProperties();
  const documentProperties = createProperties();
  const store = lib.createStore(userProperties, documentProperties);
  assert.equal(store.getLastRange(), null);
  store.setLastRange({ sheetId: 11, rows: 21, cols: 3 });
  assert.deepEqual(store.getLastRange(), { sheetId: 11, rows: 21, cols: 3 });
  store.setLastRange({ sheetId: 11, rows: 0, cols: 0 });
  assert.equal(store.getLastRange(), null);
});
