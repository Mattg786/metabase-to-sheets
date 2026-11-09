/**
 * Metabase to Sheets library.
 *
 * The API key is stored only in UserProperties. Document properties hold the
 * site URL, question id, target sheet, schedule, and the last sync status.
 * Nothing in this file writes the key to the spreadsheet or to a log.
 */

var SCHEDULED_SYNC_HANDLER = 'runScheduledSync';
var USER_API_KEY_PROPERTY = 'METABASE_API_KEY';
var MAX_RESULT_ROWS = 100000;
var MAX_RESULT_COLUMNS = 2000;
var WRITE_CHUNK_ROWS = 1000;
var CARD_LIST_LIMIT = 500;
// Conservative guard under the official Google Sheets spreadsheet cell ceiling.
// Official source (checked 2026-11-09): https://support.google.com/drive/answer/37603
// lists up to 20 million cells for Sheets created in or converted to Google Sheets.
var MAX_SPREADSHEET_CELLS = 10000000;

var DOCUMENT_KEYS = {
  baseUrl: 'METABASE_BASE_URL',
  cardId: 'METABASE_CARD_ID',
  sheetName: 'METABASE_SHEET_NAME',
  schedule: 'METABASE_SCHEDULE',
  lastSyncAt: 'METABASE_LAST_SYNC_AT',
  lastError: 'METABASE_LAST_ERROR',
  lastRowCount: 'METABASE_LAST_ROW_COUNT',
  lastRange: 'METABASE_LAST_RANGE'
};

var SCHEDULE_OPTIONS = [
  { id: 'manual', label: 'Manual only' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'every_6_hours', label: 'Every 6 hours' },
  { id: 'daily', label: 'Daily' }
];

function failure(message) {
  return { ok: false, error: message };
}

/**
 * Parse an https site URL without the WHATWG URL global.
 * Apps Script V8 does not provide URL, so this uses a small manual parser.
 */
function parseHttpsSiteUrl(raw) {
  var match = String(raw).match(/^(https?):\/\/([^\/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i);
  if (!match) return null;

  var authority = match[2];
  if (!authority) return null;

  var userinfo = '';
  var hostPort = authority;
  var at = authority.lastIndexOf('@');
  if (at !== -1) {
    userinfo = authority.slice(0, at);
    hostPort = authority.slice(at + 1);
  }
  if (!hostPort) return null;

  var hostname = '';
  var port = '';
  if (hostPort.charAt(0) === '[') {
    var end = hostPort.indexOf(']');
    if (end === -1) return null;
    hostname = hostPort.slice(0, end + 1);
    var after = hostPort.slice(end + 1);
    if (after) {
      if (after.charAt(0) !== ':') return null;
      port = after.slice(1);
    }
  } else {
    var colon = hostPort.lastIndexOf(':');
    if (colon !== -1 && hostPort.indexOf(':') === colon) {
      hostname = hostPort.slice(0, colon);
      port = hostPort.slice(colon + 1);
    } else {
      hostname = hostPort;
    }
  }

  if (!hostname) return null;
  if (port !== '' && !/^\d{1,5}$/.test(port)) return null;
  if (port !== '') {
    var portNumber = Number(port);
    if (portNumber < 1 || portNumber > 65535) return null;
  }

  var pathname = match[3] || '';
  if (pathname && pathname.charAt(0) !== '/') return null;

  return {
    protocol: match[1].toLowerCase() + ':',
    userinfo: userinfo,
    hostname: hostname.toLowerCase(),
    port: port,
    pathname: pathname || '/',
    search: match[4] || '',
    hash: match[5] || ''
  };
}

function resolvePathSegments(pathname) {
  var rawParts = String(pathname || '/').split('/');
  var parts = [];
  for (var i = 0; i < rawParts.length; i++) {
    var part = rawParts[i];
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts;
}

function buildHttpsHost(hostname, port) {
  var host = hostname;
  if (port && port !== '443') host += ':' + port;
  return host;
}

function validateBaseUrl(input) {
  var raw = String(input == null ? '' : input).trim();
  if (!raw) {
    return failure('Enter the Metabase site URL.');
  }

  var url = parseHttpsSiteUrl(raw);
  if (!url) {
    return failure('Enter a valid Metabase site URL.');
  }

  if (url.protocol !== 'https:') {
    return failure('The Metabase site URL must start with https://.');
  }
  if (url.userinfo) {
    return failure('The Metabase URL must not include a username or password.');
  }
  if (url.search || url.hash) {
    return failure('The Metabase URL should not include a query or a hash.');
  }
  if (!url.hostname) {
    return failure('Enter a valid Metabase site URL.');
  }

  var hostname = url.hostname;
  var bareHost = hostname.charAt(0) === '[' && hostname.charAt(hostname.length - 1) === ']'
    ? hostname.slice(1, -1)
    : hostname;
  if (bareHost === 'localhost' || bareHost === '127.0.0.1' || bareHost === '::1') {
    return failure('Apps Script cannot reach a Metabase on localhost. Use a public https address.');
  }

  var parts = resolvePathSegments(url.pathname);
  if (parts.indexOf('.') !== -1 || parts.indexOf('..') !== -1) {
    return failure('Enter a valid Metabase site URL.');
  }

  var lowerPath = parts.length ? '/' + parts.join('/').toLowerCase() : '/';
  if (lowerPath.indexOf('/question') !== -1 || lowerPath.indexOf('/model') !== -1) {
    return failure('That looks like a question URL. Enter the Metabase site URL, and put the question ID in the question field.');
  }
  if (parts.length && parts[parts.length - 1].toLowerCase() === 'api') {
    return failure('Enter the Metabase site URL without /api.');
  }

  var basePath = '';
  if (parts.length) {
    basePath = '/' + parts.map(function (part) {
      return encodeURIComponent(part);
    }).join('/');
  }

  return { ok: true, baseUrl: 'https://' + buildHttpsHost(hostname, url.port) + basePath };
}

function parseCardId(input) {
  var raw = String(input == null ? '' : input).trim();
  if (!raw) {
    return failure('Enter a question ID.');
  }

  var idText = raw;
  if (/^https?:\/\//i.test(raw)) {
    var pathMatch = raw.match(/^https?:\/\/[^\/?#]+([^?#]*)/i);
    if (!pathMatch) {
      return failure('Enter a question ID (a positive whole number).');
    }
    var match = pathMatch[1].match(/\/(?:question|model)\/(\d+)/);
    if (!match) {
      return failure('That URL does not include a question ID.');
    }
    idText = match[1];
  } else if (!/^\d+$/.test(raw)) {
    var slug = raw.match(/^(\d+)-[A-Za-z0-9-]+$/);
    if (!slug) {
      return failure('Enter a question ID (a positive whole number).');
    }
    idText = slug[1];
  }

  if (idText.length > 15) {
    return failure('That question ID is too large.');
  }

  var cardId = Number(idText);
  if (!Number.isInteger(cardId) || cardId < 1) {
    return failure('Enter a question ID (a positive whole number).');
  }
  return { ok: true, cardId: cardId };
}

function validateApiKey(input) {
  var apiKey = String(input == null ? '' : input).trim();
  if (!apiKey) {
    return failure('Enter an API key.');
  }
  if (apiKey.length < 8 || apiKey.length > 500 || /[\s]/.test(apiKey)) {
    return failure('That API key does not look valid.');
  }
  return { ok: true, apiKey: apiKey };
}

function validateSchedule(input) {
  var schedule = String(input == null ? '' : input).trim() || 'manual';
  for (var i = 0; i < SCHEDULE_OPTIONS.length; i++) {
    if (SCHEDULE_OPTIONS[i].id === schedule) {
      return { ok: true, schedule: schedule };
    }
  }
  return failure('Choose a schedule.');
}

function scrubSecrets(text, secrets) {
  var output = String(text == null ? '' : text);
  var list = secrets || [];
  for (var i = 0; i < list.length; i++) {
    var secret = list[i] == null ? '' : String(list[i]);
    if (secret.length < 8) continue;
    output = output.split(secret).join('[redacted]');
  }
  output = output.replace(/X-API-Key\s*[:=]\s*\S+/gi, 'X-API-Key: [redacted]');
  return output;
}

function safeMetabaseMessage(body, apiKey) {
  if (body == null || body === '') return '';
  var message = '';
  try {
    var parsed = typeof body === 'string' ? JSON.parse(body) : body;
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.message === 'string') message = parsed.message;
      else if (typeof parsed.error === 'string') message = parsed.error;
    }
  } catch (error) {
    return '';
  }

  message = message.replace(/\s+/g, ' ').trim();
  if (!message || message.indexOf('<') !== -1) return '';
  message = scrubSecrets(message, [apiKey]);
  if (message.length > 180) {
    message = message.slice(0, 177) + '...';
  }
  return message;
}

function buildCardQueryRequest(baseUrl, cardId, apiKey) {
  return {
    url: baseUrl + '/api/card/' + cardId + '/query/json',
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-API-Key': apiKey },
    payload: JSON.stringify({ format_rows: false, pivot_results: false }),
    followRedirects: false,
    muteHttpExceptions: true,
    validateHttpsCertificates: true
  };
}

function buildCardListRequest(baseUrl, apiKey) {
  return {
    url: baseUrl + '/api/card',
    method: 'get',
    headers: { 'X-API-Key': apiKey },
    followRedirects: false,
    muteHttpExceptions: true,
    validateHttpsCertificates: true
  };
}

function normaliseCell(value) {
  if (value == null) return '';
  var kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return value;
  if (kind === 'number') return Number.isFinite(value) ? value : '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return '';
  }
}

/**
 * Quote integer literals with 16 or more digits before JSON.parse.
 * JSON numbers above Number.MAX_SAFE_INTEGER lose precision in V8.
 * Quoting keeps the exact digit string as text for the sheet.
 */
function protectLargeIntegersInJson(raw) {
  if (typeof raw !== 'string') return raw;
  return raw.replace(/([\[:,]\s*)(-?\d{16,})(?=\s*[,\}\]])/g, '$1"$2"');
}

function parseJsonExport(payload) {
  var data = payload;
  if (typeof payload === 'string') {
    data = JSON.parse(payload);
  }
  if (!Array.isArray(data)) {
    throw new Error('Metabase returned JSON that is not a list of rows.');
  }

  var headers = [];
  var seen = Object.create(null);
  var rowIndex;
  for (rowIndex = 0; rowIndex < data.length; rowIndex++) {
    var row = data[rowIndex];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Metabase returned a row that is not an object.');
    }
    var keys = Object.keys(row);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      var key = keys[keyIndex];
      if (!seen[key]) {
        seen[key] = true;
        headers.push(key);
      }
    }
  }

  var rows = [];
  for (rowIndex = 0; rowIndex < data.length; rowIndex++) {
    var line = [];
    for (var column = 0; column < headers.length; column++) {
      line.push(normaliseCell(data[rowIndex][headers[column]]));
    }
    rows.push(line);
  }

  return { headers: headers, rows: rows };
}

function parseCardList(payload) {
  var data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!Array.isArray(data)) {
    throw new Error('Metabase did not return a list of questions.');
  }

  var questions = [];
  for (var i = 0; i < data.length; i++) {
    var card = data[i];
    if (!card || typeof card !== 'object' || Array.isArray(card)) continue;
    if (card.archived === true) continue;
    if (typeof card.id !== 'number' || !Number.isInteger(card.id) || card.id < 1) continue;
    var name = typeof card.name === 'string' && card.name.trim()
      ? card.name.trim()
      : 'Question ' + card.id;
    var type = card.type === 'model' || card.dataset === true ? 'model' : 'question';
    questions.push({ id: card.id, name: name, type: type });
  }

  questions.sort(function (left, right) {
    var byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return left.id - right.id;
  });

  var truncated = false;
  if (questions.length > CARD_LIST_LIMIT) {
    questions = questions.slice(0, CARD_LIST_LIMIT);
    truncated = true;
  }
  return { questions: questions, truncated: truncated };
}

function statusError(status, apiKey, body, messages) {
  if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
    return failure('Metabase redirected the request. Check that the site URL is the https address of your Metabase.');
  }
  if (status === 401) {
    return failure('Metabase rejected the API key (401).');
  }
  if (status === 403) {
    return failure(messages.forbidden);
  }
  if (status === 404) {
    return failure(messages.notFound);
  }
  if (status === 202) {
    return failure('Metabase has not finished running this question. Try Sync now again in a moment.');
  }

  var detail = safeMetabaseMessage(body, apiKey);
  var summary;
  if (status === 400) summary = 'Metabase rejected the query (400).';
  else if (status >= 500 && status <= 599) summary = 'Metabase could not run the query (' + status + ').';
  else summary = 'Metabase returned an error (' + status + ').';

  if (detail) summary += ' ' + detail;
  return failure(summary);
}

function responseStatus(response) {
  if (!response || response.networkError || response.status == null) return 0;
  var status = Number(response.status);
  if (!Number.isFinite(status)) return 0;
  return status;
}

function interpretQueryResponse(response, apiKey) {
  var status = responseStatus(response);
  if (status === 0) {
    return failure('Metabase could not be reached. Check the site URL and try again.');
  }
  // 200 is the completed JSON export. 202 means Metabase has not finished.
  if (status !== 200) {
    return statusError(status, apiKey, response.body, {
      notFound: 'Metabase could not find that question (404).',
      forbidden: 'The API key does not have access to this question (403).'
    });
  }

  var parsed;
  try {
    if (typeof response.body === 'string') {
      parsed = JSON.parse(protectLargeIntegersInJson(response.body));
    } else {
      parsed = response.body;
    }
  } catch (error) {
    return failure('Metabase returned a response that was not JSON.');
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.error || parsed.status === 'failed') {
      var message = safeMetabaseMessage(parsed, apiKey);
      return failure(message || 'Metabase could not run that question.');
    }
  }

  try {
    return { ok: true, table: parseJsonExport(parsed) };
  } catch (error) {
    return failure(scrubSecrets(error.message, [apiKey]));
  }
}

function interpretListResponse(response, apiKey) {
  var status = responseStatus(response);
  if (status === 0) {
    return failure('Metabase could not be reached. Check the site URL and try again.');
  }
  if (status !== 200) {
    return statusError(status, apiKey, response.body, {
      notFound: 'Metabase could not find the API at that site URL (404). Check the site URL.',
      forbidden: 'The API key does not have access to the question list (403).'
    });
  }

  try {
    var parsed = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
    var list = parseCardList(parsed);
    return { ok: true, questions: list.questions, truncated: list.truncated };
  } catch (error) {
    return failure('Metabase did not return a list of questions.');
  }
}

function tableToValues(table) {
  if (!table || !table.headers || !table.headers.length) return [];
  var width = table.headers.length;
  var values = [table.headers.slice()];
  var rows = table.rows || [];
  for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    var source = rows[rowIndex] || [];
    var line = new Array(width);
    for (var column = 0; column < width; column++) {
      line[column] = column < source.length ? source[column] : '';
    }
    values.push(line);
  }
  return values;
}

function rangeHasContent(values) {
  for (var row = 0; row < values.length; row++) {
    for (var column = 0; column < values[row].length; column++) {
      if (values[row][column] !== '' && values[row][column] != null) return true;
    }
  }
  return false;
}

function ensureSheetSize(sheet, rows, columns) {
  if (typeof sheet.getMaxRows === 'function' && typeof sheet.insertRowsAfter === 'function') {
    var maxRows = sheet.getMaxRows();
    if (maxRows < rows) sheet.insertRowsAfter(maxRows, rows - maxRows);
  }
  if (typeof sheet.getMaxColumns === 'function' && typeof sheet.insertColumnsAfter === 'function') {
    var maxColumns = sheet.getMaxColumns();
    if (maxColumns < columns) sheet.insertColumnsAfter(maxColumns, columns - maxColumns);
  }
}

/**
 * Sheets parses leading = + - @ as formulas or signed numbers unless the cell
 * is already text. Prefix those strings with an apostrophe so they stay literal.
 */
function needsLiteralPrefix(value) {
  if (typeof value !== 'string' || !value) return false;
  var ch = value.charAt(0);
  return ch === '=' || ch === '+' || ch === '-' || ch === '@';
}

function toLiteralSheetValue(value) {
  return needsLiteralPrefix(value) ? "'" + value : value;
}

function columnIsAllText(values, columnIndex) {
  for (var row = 0; row < values.length; row++) {
    var value = values[row][columnIndex];
    if (value === '' || value == null) continue;
    if (typeof value !== 'string') return false;
  }
  return true;
}

function setCellTextFormat(sheet, row, column) {
  if (typeof sheet.getRange !== 'function') return;
  var range = sheet.getRange(row, column, 1, 1);
  if (typeof range.setNumberFormat === 'function') {
    range.setNumberFormat('@');
  }
}

/**
 * Apply "@" text format BEFORE writing values.
 * All-string columns are formatted as a column. Mixed columns format each
 * string cell so numbers stay numbers and strings stay literal.
 */
function applyTextNumberFormats(sheet, values) {
  if (!values.length || typeof sheet.getRange !== 'function') return;
  var width = values[0].length;
  var height = values.length;
  for (var column = 0; column < width; column++) {
    if (columnIsAllText(values, column)) {
      var range = sheet.getRange(1, column + 1, height, 1);
      if (typeof range.setNumberFormat === 'function') {
        range.setNumberFormat('@');
      }
      continue;
    }
    for (var row = 0; row < height; row++) {
      var value = values[row][column];
      if (typeof value !== 'string' || value === '') continue;
      setCellTextFormat(sheet, row + 1, column + 1);
    }
  }
}

function prepareChunkForSheet(slice) {
  var prepared = [];
  for (var row = 0; row < slice.length; row++) {
    var line = [];
    for (var column = 0; column < slice[row].length; column++) {
      line.push(toLiteralSheetValue(slice[row][column]));
    }
    prepared.push(line);
  }
  return prepared;
}

function writeValuesInChunks(sheet, values) {
  // Format first. setValues after that still parses =/+/-/@ unless escaped.
  applyTextNumberFormats(sheet, values);
  var width = values[0].length;
  for (var start = 0; start < values.length; start += WRITE_CHUNK_ROWS) {
    var slice = values.slice(start, start + WRITE_CHUNK_ROWS);
    var prepared = prepareChunkForSheet(slice);
    var range = sheet.getRange(start + 1, 1, prepared.length, width);
    range.setValues(prepared);
  }
}

function countSpreadsheetCells(spreadsheet) {
  if (!spreadsheet || typeof spreadsheet.getSheets !== 'function') return 0;
  var sheets = spreadsheet.getSheets();
  var total = 0;
  for (var i = 0; i < sheets.length; i++) {
    total += sheets[i].getMaxRows() * sheets[i].getMaxColumns();
  }
  return total;
}

function assertWithinCellBudget(spreadsheet, sheet, neededRows, neededCols) {
  if (!spreadsheet || !sheet) return;
  var currentRows = sheet.getMaxRows();
  var currentCols = sheet.getMaxColumns();
  var currentSheetCells = currentRows * currentCols;
  var nextRows = Math.max(currentRows, neededRows || 1);
  var nextCols = Math.max(currentCols, neededCols || 1);
  var nextSheetCells = nextRows * nextCols;
  var others = countSpreadsheetCells(spreadsheet) - currentSheetCells;
  if (others + nextSheetCells > MAX_SPREADSHEET_CELLS) {
    throw new Error('This sync would push the spreadsheet past Google Sheets\' cell limit.');
  }
}

function sheetIdOf(sheet) {
  if (sheet && typeof sheet.getSheetId === 'function') return sheet.getSheetId();
  return 0;
}

function readBackupBlock(sheet, previousRange) {
  if (!previousRange) return null;
  if (sheetIdOf(sheet) !== previousRange.sheetId) return null;
  if (!previousRange.rows || !previousRange.cols) return null;
  var range = sheet.getRange(1, 1, previousRange.rows, previousRange.cols);
  return {
    rows: previousRange.rows,
    cols: previousRange.cols,
    values: range.getValues()
  };
}

function clearBackupBlock(sheet, backup) {
  if (!backup) return;
  sheet.getRange(1, 1, backup.rows, backup.cols).clearContent();
}

/**
 * Write the table starting at A1.
 * Clears only the previously synced block for this configuration, not the whole data range.
 * Headers come only from the result. No extra columns are added.
 * String cells are formatted as text before writing, and strings that start
 * with = + - or @ are apostrophe-prefixed so Sheets keeps them literal.
 * Empty results clear only the previously synced block, never getDataRange.
 */

function writeTable(sheet, table, limits) {
  var maxRows = limits && limits.maxRows ? limits.maxRows : MAX_RESULT_ROWS;
  var maxColumns = limits && limits.maxColumns ? limits.maxColumns : MAX_RESULT_COLUMNS;
  var previousRange = limits && limits.previousRange ? limits.previousRange : null;
  var spreadsheet = limits && limits.spreadsheet ? limits.spreadsheet : null;
  var rowCount = table && table.rows ? table.rows.length : 0;
  var columnCount = table && table.headers ? table.headers.length : 0;
  if (rowCount > maxRows) {
    throw new Error('This question returned too many rows to write into the sheet in one sync.');
  }
  if (columnCount > maxColumns) {
    throw new Error('This question returned too many columns to write into the sheet in one sync.');
  }

  var values = tableToValues(table);
  if (values.length) {
    assertWithinCellBudget(spreadsheet, sheet, values.length, values[0].length);
    ensureSheetSize(sheet, values.length, values[0].length);
  }

  var backup = readBackupBlock(sheet, previousRange);

  try {
    clearBackupBlock(sheet, backup);
    if (!values.length) {
      return {
        rowsWritten: 0,
        columnsWritten: 0,
        range: { sheetId: sheetIdOf(sheet), rows: 0, cols: 0 }
      };
    }
    writeValuesInChunks(sheet, values);
    return {
      rowsWritten: values.length - 1,
      columnsWritten: values[0].length,
      range: {
        sheetId: sheetIdOf(sheet),
        rows: values.length,
        cols: values[0].length
      }
    };
  } catch (error) {
    if (backup) {
      try {
        sheet.getRange(1, 1, backup.rows, backup.cols).setValues(backup.values);
      } catch (restoreError) {
        // Keep the original write error. The previous values could not be restored.
      }
    }
    throw error;
  }
}

function formatSyncTime(iso) {
  if (!iso) return '';
  var date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var hours = String(date.getUTCHours()).padStart(2, '0');
  var minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return date.getUTCDate() + ' ' + months[date.getUTCMonth()] + ' ' + date.getUTCFullYear() + ', ' + hours + ':' + minutes + ' UTC';
}

function buildStatusLabel(config) {
  if (!config.lastSyncAt) return 'Not synced yet.';
  var when = formatSyncTime(config.lastSyncAt);
  if (config.lastRowCount === '' || config.lastRowCount == null) {
    return 'Last sync: ' + when + '.';
  }
  var count = Number(config.lastRowCount);
  if (!Number.isFinite(count)) return 'Last sync: ' + when + '.';
  var noun = count === 1 ? 'row' : 'rows';
  return 'Last sync: ' + when + '. ' + count + ' ' + noun + '.';
}

function createStore(userProperties, documentProperties) {
  function read(key) {
    var value = documentProperties.getProperty(key);
    return value == null ? '' : String(value);
  }

  return {
    getApiKey: function () {
      var value = userProperties.getProperty(USER_API_KEY_PROPERTY);
      return value == null ? '' : String(value);
    },
    setApiKey: function (apiKey) {
      if (!apiKey) {
        userProperties.deleteProperty(USER_API_KEY_PROPERTY);
        return;
      }
      userProperties.setProperty(USER_API_KEY_PROPERTY, apiKey);
    },
    getConfig: function () {
      var schedule = read(DOCUMENT_KEYS.schedule);
      return {
        baseUrl: read(DOCUMENT_KEYS.baseUrl),
        cardId: read(DOCUMENT_KEYS.cardId),
        sheetName: read(DOCUMENT_KEYS.sheetName),
        schedule: schedule || 'manual',
        lastSyncAt: read(DOCUMENT_KEYS.lastSyncAt),
        lastError: read(DOCUMENT_KEYS.lastError),
        lastRowCount: read(DOCUMENT_KEYS.lastRowCount)
      };
    },
    setConfig: function (config) {
      documentProperties.setProperty(DOCUMENT_KEYS.baseUrl, config.baseUrl);
      documentProperties.setProperty(DOCUMENT_KEYS.cardId, String(config.cardId));
      documentProperties.setProperty(DOCUMENT_KEYS.sheetName, config.sheetName);
      documentProperties.setProperty(DOCUMENT_KEYS.schedule, config.schedule);
    },
    setStatus: function (status) {
      if (status.lastSyncAt) {
        documentProperties.setProperty(DOCUMENT_KEYS.lastSyncAt, status.lastSyncAt);
      }
      if (status.lastRowCount === 0 || status.lastRowCount) {
        documentProperties.setProperty(DOCUMENT_KEYS.lastRowCount, String(status.lastRowCount));
      }
      if (status.lastError) {
        documentProperties.setProperty(DOCUMENT_KEYS.lastError, status.lastError);
      } else if (Object.prototype.hasOwnProperty.call(status, 'lastError')) {
        documentProperties.deleteProperty(DOCUMENT_KEYS.lastError);
      }
    },
    getLastRange: function () {
      var raw = read(DOCUMENT_KEYS.lastRange);
      if (!raw) return null;
      try {
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.sheetId !== 'number') return null;
        var rows = Number(parsed.rows);
        var cols = Number(parsed.cols);
        if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 0 || cols < 0) return null;
        return { sheetId: parsed.sheetId, rows: rows, cols: cols };
      } catch (error) {
        return null;
      }
    },
    setLastRange: function (range) {
      if (!range || (!range.rows && !range.cols)) {
        documentProperties.deleteProperty(DOCUMENT_KEYS.lastRange);
        return;
      }
      documentProperties.setProperty(DOCUMENT_KEYS.lastRange, JSON.stringify({
        sheetId: range.sheetId,
        rows: range.rows,
        cols: range.cols
      }));
    }
  };
}

function applySchedule(scriptApp, schedule) {
  var triggers = scriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === SCHEDULED_SYNC_HANDLER) {
      scriptApp.deleteTrigger(triggers[i]);
    }
  }

  if (!schedule || schedule === 'manual') {
    return { created: false };
  }

  var builder = scriptApp.newTrigger(SCHEDULED_SYNC_HANDLER).timeBased();
  if (schedule === 'hourly') {
    builder.everyHours(1).create();
  } else if (schedule === 'every_6_hours') {
    builder.everyHours(6).create();
  } else if (schedule === 'daily') {
    builder.everyDays(1).create();
  } else {
    throw new Error('Unknown schedule.');
  }
  return { created: true };
}

function findSheet(spreadsheet, sheetName) {
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === sheetName) return sheets[i];
  }
  return null;
}

function validateSettingsForm(form, spreadsheet) {
  var base = validateBaseUrl(form.baseUrl);
  if (!base.ok) return base;
  var card = parseCardId(form.cardId);
  if (!card.ok) return card;
  var schedule = validateSchedule(form.schedule);
  if (!schedule.ok) return schedule;

  var sheetName = form.sheetName == null ? '' : String(form.sheetName);
  if (!sheetName) return failure('Choose a sheet.');
  var sheet = findSheet(spreadsheet, sheetName);
  if (!sheet) {
    return failure('That sheet is not in this spreadsheet. Choose another sheet.');
  }

  return {
    ok: true,
    sheet: sheet,
    settings: {
      baseUrl: base.baseUrl,
      cardId: card.cardId,
      sheetName: sheet.getName(),
      schedule: schedule.schedule
    }
  };
}

function resolveApiKey(form, store) {
  var typed = String(form.apiKey == null ? '' : form.apiKey).trim();
  if (typed) {
    var validated = validateApiKey(typed);
    if (!validated.ok) return validated;
    return { ok: true, apiKey: validated.apiKey, replace: true, remove: false };
  }
  if (form.removeApiKey) {
    return { ok: true, apiKey: '', replace: false, remove: true };
  }
  var stored = store.getApiKey();
  if (!stored) return failure('Enter an API key.');
  return { ok: true, apiKey: stored, replace: false, remove: false };
}

function sheetNames(spreadsheet, savedName) {
  var sheets = spreadsheet.getSheets();
  var names = [];
  for (var i = 0; i < sheets.length; i++) names.push(sheets[i].getName());
  if (savedName && names.indexOf(savedName) === -1) names.push(savedName);
  return names;
}

function activeSheetName(spreadsheet, names) {
  if (typeof spreadsheet.getActiveSheet === 'function') {
    var active = spreadsheet.getActiveSheet();
    if (active && active.getName()) return active.getName();
  }
  return names.length ? names[0] : '';
}

function buildSidebarState(services) {
  var config = services.store.getConfig();
  var names = sheetNames(services.spreadsheet, config.sheetName);
  return {
    ok: true,
    baseUrl: config.baseUrl,
    cardId: config.cardId,
    sheetName: config.sheetName,
    activeSheetName: activeSheetName(services.spreadsheet, names),
    schedule: config.schedule || 'manual',
    hasApiKey: services.store.getApiKey() !== '',
    sheets: names,
    schedules: SCHEDULE_OPTIONS,
    lastSyncAt: config.lastSyncAt,
    lastSyncLabel: buildStatusLabel(config),
    lastError: config.lastError,
    lastRowCount: config.lastRowCount === '' ? null : Number(config.lastRowCount)
  };
}

function withState(services, result) {
  result.state = buildSidebarState(services);
  return result;
}

function currentIso(services) {
  var now = services.clock ? services.clock() : new Date();
  if (typeof now === 'string') return now;
  return now.toISOString();
}

function callMetabase(services, request) {
  try {
    return services.fetch(request);
  } catch (error) {
    return { status: 0, body: '', networkError: true };
  }
}

function safeWriteError(error, apiKey) {
  var message = scrubSecrets(error && error.message ? error.message : '', [apiKey]);
  if (
    message.indexOf('too many rows') !== -1 ||
    message.indexOf('too many columns') !== -1 ||
    message.indexOf('cell limit') !== -1
  ) {
    return message;
  }
  return 'The result could not be written to the sheet.';
}

function executeSync(settings, sheet, apiKey, services) {
  var request = buildCardQueryRequest(settings.baseUrl, settings.cardId, apiKey);
  var response = callMetabase(services, request);
  var interpreted = interpretQueryResponse(response, apiKey);
  if (!interpreted.ok) {
    services.store.setStatus({ lastError: scrubSecrets(interpreted.error, [apiKey]) });
    return interpreted;
  }

  var written;
  try {
    written = writeTable(sheet, interpreted.table, {
      previousRange: services.store.getLastRange ? services.store.getLastRange() : null,
      spreadsheet: services.spreadsheet
    });
  } catch (error) {
    var writeError = safeWriteError(error, apiKey);
    services.store.setStatus({ lastError: writeError });
    return failure(writeError);
  }

  if (services.store.setLastRange) {
    services.store.setLastRange(written.range);
  }

  var syncedAt = currentIso(services);
  services.store.setStatus({
    lastSyncAt: syncedAt,
    lastError: '',
    lastRowCount: written.rowsWritten
  });
  return {
    ok: true,
    rowsWritten: written.rowsWritten,
    columnsWritten: written.columnsWritten,
    lastSyncAt: syncedAt
  };
}

function syncMessage(outcome) {
  if (!outcome.ok) return '';
  if (!outcome.rowsWritten && !outcome.columnsWritten) {
    return 'The question returned no rows. The previous synced cells were cleared.';
  }
  var noun = outcome.rowsWritten === 1 ? 'row' : 'rows';
  return 'Synced ' + outcome.rowsWritten + ' ' + noun + '.';
}

function saveSettingsForUser(form, services) {
  var validated = validateSettingsForm(form, services.spreadsheet);
  if (!validated.ok) return withState(services, validated);

  var typed = String(form.apiKey == null ? '' : form.apiKey).trim();
  if (form.removeApiKey && !typed) {
    validated.settings.schedule = 'manual';
    services.store.setApiKey('');
    services.store.setConfig(validated.settings);
    applySchedule(services.scriptApp, 'manual');
    return withState(services, {
      ok: true,
      message: 'The API key was removed and the schedule was turned off.'
    });
  }

  if (typed) {
    var validatedKey = validateApiKey(typed);
    if (!validatedKey.ok) return withState(services, validatedKey);
    services.store.setApiKey(validatedKey.apiKey);
  }

  if (validated.settings.schedule !== 'manual' && !services.store.getApiKey()) {
    return withState(services, failure('Save an API key before turning on a schedule. The schedule runs as you, using your key.'));
  }

  services.store.setConfig(validated.settings);
  applySchedule(services.scriptApp, validated.settings.schedule);
  return withState(services, { ok: true, message: 'Saved.' });
}

function isApiKeyRejectedError(message) {
  return /\(401\)/.test(String(message || ''));
}

function syncNowForUser(form, services) {
  var validated = validateSettingsForm(form, services.spreadsheet);
  if (!validated.ok) return withState(services, validated);

  var hadStoredKey = services.store.getApiKey() !== '';
  var key = resolveApiKey(form, services.store);
  if (!key.ok) return withState(services, key);
  if (key.remove || !key.apiKey) {
    return withState(services, failure('Enter an API key before syncing.'));
  }

  var outcome = executeSync(validated.settings, validated.sheet, key.apiKey, services);
  if (outcome.ok && key.replace) {
    services.store.setApiKey(key.apiKey);
  } else if (!outcome.ok && key.replace && isApiKeyRejectedError(outcome.error)) {
    // Only when Metabase rejected a newly typed key (401). A 404 for a missing
    // question must not claim the previous key is still saved.
    outcome = failure(outcome.error + (hadStoredKey
      ? ' The previous API key is still saved.'
      : ' The API key was not saved.'));
  }

  if (!outcome.ok && !services.store.getApiKey()) {
    validated.settings.schedule = 'manual';
  }
  services.store.setConfig(validated.settings);
  if (services.store.getApiKey()) {
    applySchedule(services.scriptApp, validated.settings.schedule);
  } else {
    applySchedule(services.scriptApp, 'manual');
  }

  if (!outcome.ok) return withState(services, outcome);
  return withState(services, {
    ok: true,
    rowsWritten: outcome.rowsWritten,
    columnsWritten: outcome.columnsWritten,
    message: syncMessage(outcome)
  });
}

function loadQuestionsForUser(form, services) {
  var base = validateBaseUrl(form.baseUrl);
  if (!base.ok) return base;
  var key = resolveApiKey(form || {}, services.store);
  if (!key.ok) return key;
  if (key.remove || !key.apiKey) return failure('Enter an API key.');

  var response = callMetabase(services, buildCardListRequest(base.baseUrl, key.apiKey));
  var interpreted = interpretListResponse(response, key.apiKey);
  if (!interpreted.ok) {
    return failure(scrubSecrets(interpreted.error, [key.apiKey]));
  }
  return {
    ok: true,
    questions: interpreted.questions,
    truncated: interpreted.truncated
  };
}

function runScheduledSyncForUser(services) {
  var config = services.store.getConfig();
  var apiKey = services.store.getApiKey();
  if (!apiKey) {
    var missingKey = 'The scheduled sync could not run because no API key is saved for this Google account.';
    services.store.setStatus({ lastError: missingKey });
    throw new Error(missingKey);
  }

  var validated = validateSettingsForm({
    baseUrl: config.baseUrl,
    cardId: config.cardId,
    sheetName: config.sheetName,
    schedule: config.schedule || 'manual',
    apiKey: ''
  }, services.spreadsheet);

  if (!validated.ok) {
    var validationError = scrubSecrets(validated.error, [apiKey]);
    services.store.setStatus({ lastError: validationError });
    throw new Error(validationError);
  }

  var outcome = executeSync(validated.settings, validated.sheet, apiKey, services);
  if (!outcome.ok) {
    throw new Error(scrubSecrets(outcome.error, [apiKey]));
  }
  return outcome;
}

function fetchMetabase(urlFetchApp, request) {
  try {
    var options = {
      method: request.method,
      headers: request.headers,
      muteHttpExceptions: true,
      followRedirects: false,
      validateHttpsCertificates: true
    };
    if (request.contentType) options.contentType = request.contentType;
    if (request.payload != null) options.payload = request.payload;

    var response = urlFetchApp.fetch(request.url, options);
    return {
      status: response.getResponseCode(),
      body: response.getContentText()
    };
  } catch (error) {
    return { status: 0, body: '', networkError: true };
  }
}

function createGoogleServices() {
  return {
    store: createStore(
      PropertiesService.getUserProperties(),
      PropertiesService.getDocumentProperties()
    ),
    spreadsheet: SpreadsheetApp.getActiveSpreadsheet(),
    scriptApp: ScriptApp,
    fetch: function (request) {
      return fetchMetabase(UrlFetchApp, request);
    },
    clock: function () {
      return new Date();
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEDULED_SYNC_HANDLER: SCHEDULED_SYNC_HANDLER,
    USER_API_KEY_PROPERTY: USER_API_KEY_PROPERTY,
    DOCUMENT_KEYS: DOCUMENT_KEYS,
    SCHEDULE_OPTIONS: SCHEDULE_OPTIONS,
    MAX_RESULT_ROWS: MAX_RESULT_ROWS,
    MAX_RESULT_COLUMNS: MAX_RESULT_COLUMNS,
    MAX_SPREADSHEET_CELLS: MAX_SPREADSHEET_CELLS,
    parseHttpsSiteUrl: parseHttpsSiteUrl,
    resolvePathSegments: resolvePathSegments,
    validateBaseUrl: validateBaseUrl,
    parseCardId: parseCardId,
    validateApiKey: validateApiKey,
    validateSchedule: validateSchedule,
    scrubSecrets: scrubSecrets,
    buildCardQueryRequest: buildCardQueryRequest,
    buildCardListRequest: buildCardListRequest,
    protectLargeIntegersInJson: protectLargeIntegersInJson,
    parseJsonExport: parseJsonExport,
    parseCardList: parseCardList,
    interpretQueryResponse: interpretQueryResponse,
    interpretListResponse: interpretListResponse,
    needsLiteralPrefix: needsLiteralPrefix,
    toLiteralSheetValue: toLiteralSheetValue,
    isApiKeyRejectedError: isApiKeyRejectedError,
    writeTable: writeTable,
    formatSyncTime: formatSyncTime,
    buildStatusLabel: buildStatusLabel,
    createStore: createStore,
    applySchedule: applySchedule,
    buildSidebarState: buildSidebarState,
    saveSettingsForUser: saveSettingsForUser,
    syncNowForUser: syncNowForUser,
    loadQuestionsForUser: loadQuestionsForUser,
    runScheduledSyncForUser: runScheduledSyncForUser,
    fetchMetabase: fetchMetabase,
    createGoogleServices: createGoogleServices
  };
}
