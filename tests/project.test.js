'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('the manifest uses only the scopes needed for this add-on', () => {
  const manifest = JSON.parse(read('src/appsscript.json'));
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(manifest.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/script.container.ui',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
  ]);
  const joined = manifest.oauthScopes.join('\n');
  assert.equal(joined.includes('auth/drive'), false);
  assert.equal(joined.includes('auth/gmail'), false);
  assert.equal(joined.includes('auth/spreadsheets\n') || joined.endsWith('auth/spreadsheets'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'urlFetchWhitelist'), false);
});

test('clasp example points at src and is safe to commit', () => {
  const example = JSON.parse(read('.clasp.json.example'));
  assert.equal(example.rootDir, 'src');
  assert.equal(example.scriptId, 'PASTE_YOUR_SCRIPT_ID_HERE');
  assert.match(read('.gitignore'), /^\.clasp\.json$/m);
  assert.equal(fs.existsSync(path.join(root, '.clasp.json')), false);
});

test('user facing copy has no em dashes and the source does not log', () => {
  const files = [
    'README.md',
    'src/Lib.js',
    'src/Main.js',
    'src/Sidebar.html',
    'src/appsscript.json',
    '.clasp.json.example',
  ];
  for (const file of files) {
    const text = read(file);
    assert.equal(text.includes('\u2014'), false, file + ' contains an em dash');
    assert.equal(text.includes('\u2013'), false, file + ' contains an en dash');
    if (file.startsWith('src/') && file.endsWith('.js')) {
      assert.equal(text.includes('console.'), false, file);
      assert.equal(text.includes('Logger'), false, file);
    }
  }
});

test('the sidebar does not render server text as HTML', () => {
  const html = read('src/Sidebar.html');
  assert.equal(html.includes('innerHTML'), false);
  assert.match(html, /textContent/);
  assert.match(html, /id="api-key"/);
  assert.match(html, /type="password"/);
  assert.match(html, /Sync now/);
  assert.match(html, /Load questions/);
});
