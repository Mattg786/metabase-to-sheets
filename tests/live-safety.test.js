'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// adding a live link is a deliberate payment change that needs Matt
const LIVE_STRIPE_ALLOWLIST = [];

const ORIGIN = 'https://metabase-to-sheets.matthew-k-galea.workers.dev';

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.html', '.css', '.md', '.toml', '.json',
  '.xml', '.txt', '.yml', '.yaml', '.example',
]);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function workersDevUrls(text) {
  return [...text.matchAll(/https:\/\/[a-z0-9.-]*workers\.dev[^\s"'<>)]*/g)].map((match) => match[0]);
}

test('production worker, waitlist, and site URLs stay on the committed host', () => {
  const config = read('site/site-config.js');
  assert.equal(config.match(/baseUrl:\s*'([^']+)'/)[1], ORIGIN);

  const licenceEndpoint = read('src/Lib.js').match(/endpoint:\s*'([^']+)'/)[1];
  assert.equal(licenceEndpoint, `${ORIGIN}/api/licence`);

  const sidebarLinks = workersDevUrls(read('src/Sidebar.html'));
  assert.deepEqual(sidebarLinks, [`${ORIGIN}/pricing`, `${ORIGIN}/pricing`]);

  const pages = {
    'site/index.html': `${ORIGIN}/`,
    'site/privacy.html': `${ORIGIN}/privacy`,
    'site/terms.html': `${ORIGIN}/terms`,
    'site/support.html': `${ORIGIN}/support`,
    'site/pricing.html': `${ORIGIN}/pricing`,
    'site/success.html': `${ORIGIN}/success`,
  };
  for (const [file, pageUrl] of Object.entries(pages)) {
    const html = read(file);
    assert.ok(html.includes(`href="${pageUrl}"`), file);
    assert.ok(html.includes(`content="${pageUrl}"`), file);
    assert.ok(html.includes(`content="${ORIGIN}/assets/og.png"`), file);
    for (const url of workersDevUrls(html)) {
      assert.ok(url === pageUrl || url === `${ORIGIN}/assets/og.png`, `${file} has ${url}`);
    }
  }

  assert.equal(read('site/robots.txt').trim().endsWith(`Sitemap: ${ORIGIN}/sitemap.xml`), true);
  assert.deepEqual(
    [...read('site/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
    [
      `${ORIGIN}/`,
      `${ORIGIN}/privacy`,
      `${ORIGIN}/terms`,
      `${ORIGIN}/support`,
      `${ORIGIN}/pricing`,
    ],
  );

  const siteJs = read('site/site.js');
  assert.match(siteJs, /fetch\('\/api\/waitlist'/);
  assert.equal(siteJs.includes('workers.dev'), false);

  const worker = read('worker/index.mjs');
  assert.match(worker, /'\/api\/waitlist': waitlistSignup/);
  assert.match(worker, /'\/api\/licence': licence/);
  assert.equal(worker.includes('workers.dev'), false);

  const wrangler = read('wrangler.toml');
  const name = wrangler.match(/^name = "([^"]+)"$/m)[1];
  assert.equal(name, 'metabase-to-sheets');
  assert.equal(ORIGIN, `https://${name}.matthew-k-galea.workers.dev`);
  assert.equal(wrangler.includes('workers.dev'), false);
  assert.doesNotMatch(wrangler, /(^|\n)\s*routes?\s*=/);
  assert.doesNotMatch(wrangler, /custom_domain|workers_dev/);

  const runtimeDirs = ['site', 'src', 'server', 'worker', 'scripts'];
  for (const relative of trackedFiles()) {
    if (!TEXT_EXT.has(path.extname(relative))) continue;
    const inRuntime = runtimeDirs.some((dir) => relative.startsWith(`${dir}/`)) || relative === 'wrangler.toml';
    if (!inRuntime) continue;
    for (const url of workersDevUrls(read(relative))) {
      assert.ok(url.startsWith(ORIGIN), `${relative} has ${url}`);
    }
  }
});

function buyLinks(text) {
  const needle = 'https://' + 'buy.' + 'stripe.com/';
  const links = [];
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(needle, from);
    if (at === -1) break;
    let end = at + needle.length;
    while (end < text.length && !/[\s'"`<>)]/.test(text[end])) end += 1;
    links.push(text.slice(at, end));
    from = end;
  }
  return links;
}

function liveKeyHits(text) {
  const markers = ['pk_', 'sk_', 'rk_'].map((prefix) => prefix + 'live_');
  const hits = [];
  for (const marker of markers) {
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(marker, from);
      if (at === -1) break;
      let end = at;
      while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end += 1;
      hits.push(text.slice(at, end));
      from = end;
    }
  }
  return hits;
}

function redact(value) {
  const text = String(value);
  if (text.length <= 8) return `${text.slice(0, 3)}…`;
  return `${text.slice(0, 7)}…${text.slice(-4)}`;
}

test('committed source has no live Stripe keys or live Payment Links', () => {
  const problems = [];
  for (const relative of trackedFiles()) {
    const ext = path.extname(relative);
    if (!TEXT_EXT.has(ext)) continue;
    const text = read(relative);
    for (const link of buyLinks(text)) {
      const pathStart = link.split('buy.' + 'stripe.com/')[1] || '';
      if (pathStart.startsWith('test_')) continue;
      if (LIVE_STRIPE_ALLOWLIST.includes(link)) continue;
      problems.push(`${relative}: payment link ${redact(link)}`);
    }
    for (const hit of liveKeyHits(text)) {
      if (LIVE_STRIPE_ALLOWLIST.includes(hit)) continue;
      problems.push(`${relative}: live key ${redact(hit)}`);
    }
  }
  assert.deepEqual(problems, []);
});
