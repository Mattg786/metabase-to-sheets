'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { writeTable } = require('../src/Lib');
const { createMemorySheet } = require('./support/fakes');

test('writes headers and rows from the result and no extra columns', () => {
  const sheet = createMemorySheet('Results', [], { sheetId: 9 });
  const written = writeTable(sheet, {
    headers: ['City', 'Total'],
    rows: [['London', 3], ['York', 4]],
  });
  assert.deepEqual(written, {
    rowsWritten: 2,
    columnsWritten: 2,
    range: { sheetId: 9, rows: 3, cols: 2 },
  });
  assert.deepEqual(sheet.readGrid(2, 3), [
    ['City', 'Total', ''],
    ['London', 3, ''],
  ]);
  assert.equal(sheet.readGrid(2, 2)[0].includes('Last sync'), false);
});

test('a smaller sync clears leftover rows and columns from the previous synced block', () => {
  const sheet = createMemorySheet('Results', [
    ['H1', 'H2', 'H3'],
    ['a', 'b', 'c'],
    ['d', 'e', 'f'],
    ['g', 'h', 'i'],
  ], { sheetId: 7 });
  writeTable(sheet, {
    headers: ['H1', 'H2'],
    rows: [['x', 'y']],
  }, { previousRange: { sheetId: 7, rows: 4, cols: 3 } });
  assert.deepEqual(sheet.readGrid(4, 3), [
    ['H1', 'H2', ''],
    ['x', 'y', ''],
    ['', '', ''],
    ['', '', ''],
  ]);
});

test('an empty result clears the previous sync and does not invent headers', () => {
  const sheet = createMemorySheet('Results', [
    ['City', 'Total'],
    ['London', 3],
  ], { sheetId: 3 });
  const written = writeTable(sheet, { headers: [], rows: [] }, {
    previousRange: { sheetId: 3, rows: 2, cols: 2 },
  });
  assert.deepEqual(written, {
    rowsWritten: 0,
    columnsWritten: 0,
    range: { sheetId: 3, rows: 0, cols: 0 },
  });
  assert.deepEqual(sheet.readGrid(2, 2), [
    ['', ''],
    ['', ''],
  ]);
});

test('writes past the current sheet size by adding rows and columns', () => {
  const sheet = createMemorySheet('Results', [], { maxRows: 1, maxColumns: 1 });
  writeTable(sheet, {
    headers: ['A', 'B'],
    rows: [[1, 2]],
  });
  assert.equal(sheet.getMaxRows() >= 2, true);
  assert.equal(sheet.getMaxColumns() >= 2, true);
  assert.deepEqual(sheet.readGrid(2, 2), [
    ['A', 'B'],
    [1, 2],
  ]);
});

test('restores the previous cells when writing fails', () => {
  const sheet = createMemorySheet('Results', [
    ['H1', 'H2'],
    ['a', 'b'],
  ]);
  const originalGetRange = sheet.getRange.bind(sheet);
  sheet.getRange = (row, col, numRows, numCols) => {
    const range = originalGetRange(row, col, numRows, numCols);
    const originalSet = range.setValues.bind(range);
    range.setValues = (values) => {
      if (values[0][0] === 'Only') throw new Error('write failed');
      originalSet(values);
    };
    return range;
  };

  assert.throws(() => writeTable(sheet, { headers: ['Only'], rows: [['x']] }), /write failed/);
  assert.deepEqual(sheet.readGrid(2, 2), [
    ['H1', 'H2'],
    ['a', 'b'],
  ]);
});

test('refuses a result that is too large before clearing the sheet', () => {
  const sheet = createMemorySheet('Results', [['Keep']]);
  assert.throws(
    () => writeTable(sheet, { headers: ['A'], rows: [['1'], ['2']] }, { maxRows: 1 }),
    /too many rows/,
  );
  assert.deepEqual(sheet.readGrid(1, 1), [['Keep']]);
});

test('splits large results into chunks of 1000 rows', () => {
  const rows = [];
  for (let i = 0; i < 1000; i += 1) rows.push([i]);
  const sheet = createMemorySheet('Results', []);
  const written = writeTable(sheet, { headers: ['N'], rows });
  assert.equal(written.rowsWritten, 1000);
  assert.equal(sheet.setValueCalls(), 2);
  assert.equal(sheet.readGrid(1, 1)[0][0], 'N');
  assert.equal(sheet.readGrid(1001, 1)[1000][0], 999);
});
