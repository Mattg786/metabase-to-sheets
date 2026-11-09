'use strict';

function createMemorySheet(name, initialValues, options) {
  const opts = options || {};
  let maxRows = opts.maxRows || 1000;
  let maxColumns = opts.maxColumns || 26;
  const cells = Object.create(null);
  let setValueCalls = 0;

  function key(row, col) {
    return row + ':' + col;
  }

  function writeValuesAt(row, col, values) {
    for (let r = 0; r < values.length; r += 1) {
      for (let c = 0; c < values[r].length; c += 1) {
        const value = values[r][c];
        const id = key(row + r, col + c);
        if (value === '' || value == null) delete cells[id];
        else cells[id] = value;
      }
    }
  }

  function readGrid(rows, cols) {
    const grid = [];
    for (let r = 1; r <= rows; r += 1) {
      const line = [];
      for (let c = 1; c <= cols; c += 1) {
        const id = key(r, c);
        line.push(Object.prototype.hasOwnProperty.call(cells, id) ? cells[id] : '');
      }
      grid.push(line);
    }
    return grid;
  }

  function bounds() {
    let maxR = 0;
    let maxC = 0;
    Object.keys(cells).forEach((id) => {
      const parts = id.split(':');
      const r = Number(parts[0]);
      const c = Number(parts[1]);
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    });
    if (maxR === 0) return { rows: 1, cols: 1 };
    return { rows: maxR, cols: maxC };
  }

  if (initialValues && initialValues.length) writeValuesAt(1, 1, initialValues);

  return {
    getName() {
      return name;
    },
    getMaxRows() {
      return maxRows;
    },
    getMaxColumns() {
      return maxColumns;
    },
    insertRowsAfter(after, howMany) {
      maxRows += howMany;
    },
    insertColumnsAfter(after, howMany) {
      maxColumns += howMany;
    },
    readGrid,
    setValueCalls() {
      return setValueCalls;
    },
    getDataRange() {
      const box = bounds();
      return {
        getNumRows() {
          return box.rows;
        },
        getNumColumns() {
          return box.cols;
        },
        getValues() {
          return readGrid(box.rows, box.cols);
        },
        clearContent() {
          for (let r = 1; r <= box.rows; r += 1) {
            for (let c = 1; c <= box.cols; c += 1) delete cells[key(r, c)];
          }
        },
      };
    },
    getRange(row, col, numRows, numCols) {
      return {
        setValues(values) {
          setValueCalls += 1;
          if (!values || values.length !== numRows) {
            throw new Error('Range size does not match values.');
          }
          for (let i = 0; i < values.length; i += 1) {
            if (values[i].length !== numCols) throw new Error('Range size does not match values.');
          }
          if (row < 1 || col < 1 || row + numRows - 1 > maxRows || col + numCols - 1 > maxColumns) {
            throw new Error('Range exceeds sheet size.');
          }
          writeValuesAt(row, col, values);
        },
        clearContent() {
          for (let r = row; r < row + numRows; r += 1) {
            for (let c = col; c < col + numCols; c += 1) delete cells[key(r, c)];
          }
        },
      };
    },
  };
}

function createProperties() {
  const data = Object.create(null);
  return {
    getProperty(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setProperty(key, value) {
      if (typeof value !== 'string') throw new Error('Property values must be strings.');
      data[key] = value;
    },
    deleteProperty(key) {
      delete data[key];
    },
    getProperties() {
      return { ...data };
    },
  };
}

function createScriptApp() {
  let triggers = [];
  let nextId = 1;
  return {
    getProjectTriggers() {
      return triggers.slice();
    },
    deleteTrigger(trigger) {
      triggers = triggers.filter((item) => item !== trigger);
    },
    newTrigger(handler) {
      return {
        timeBased() {
          const spec = { handler };
          const builder = {
            everyHours(hours) {
              spec.everyHours = hours;
              return builder;
            },
            everyDays(days) {
              spec.everyDays = days;
              return builder;
            },
            atHour(hour) {
              spec.atHour = hour;
              return builder;
            },
            create() {
              const trigger = {
                spec,
                getHandlerFunction() {
                  return handler;
                },
                getUniqueId() {
                  return String(nextId);
                },
              };
              nextId += 1;
              triggers.push(trigger);
              return trigger;
            },
          };
          return builder;
        },
      };
    },
    triggers() {
      return triggers.slice();
    },
  };
}

function createSpreadsheet(sheets, activeName) {
  return {
    getSheets() {
      return sheets;
    },
    getActiveSheet() {
      return sheets.find((sheet) => sheet.getName() === activeName) || sheets[0];
    },
  };
}

function secretIn(value, secret) {
  return JSON.stringify(value).includes(secret);
}

module.exports = {
  createMemorySheet,
  createProperties,
  createScriptApp,
  createSpreadsheet,
  secretIn,
};
