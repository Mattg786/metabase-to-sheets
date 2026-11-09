'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('static output contains only public site assets and no server secrets or backend source', () => {
  const siteFiles = [
    'index.html', 'privacy.html', 'terms.html', 'support.html', 'pricing.html', 'success.html',
    'styles.css', 'site.js', 'site-config.js', 'sitemap.xml', 'robots.txt', 'assets/og.svg',
  ];
  assert.equal(fs.existsSync(path.join(root, 'site', 'api')), false);
  const siteText = siteFiles
    .filter((file) => fs.statSync(path.join(root, 'site', file)).isFile())
    .map((file) => read(path.join('site', file)))
    .join('\n');
  assert.equal(siteText.includes('STRIPE_SECRET_KEY'), false);
  assert.equal(siteText.includes('X-API-Key'), false);
});

test('public pages expose privacy, terms, support, pricing, and accessible metadata', () => {
  const host = 'https://metabase-to-sheets.example-subdomain.workers.dev';
  for (const page of ['index', 'privacy', 'terms', 'support', 'pricing', 'success']) {
    const html = read(`site/${page}.html`);
    assert.match(html, /<title>/, page);
    assert.match(html, /name="description"/, page);
    assert.match(html, /property="og:image"/, page);
    assert.match(html, /data-canonical/, page);
    const pagePath = page === 'index' ? '/' : `/${page}`;
    assert.ok(html.includes(`href="${host}${pagePath}"`), page);
    assert.ok(html.includes(`content="${host}${pagePath}"`), page);
    assert.ok(html.includes(`content="${host}/assets/og.svg"`), page);
    assert.match(html, /href="\/(privacy|support|terms|pricing)"/, page);
  }
  assert.match(read('site/index.html'), /href="\/privacy"/);
  assert.match(read('site/index.html'), /href="\/support"/);
  assert.match(read('site/index.html'), /Marketplace publication pending/);
  assert.match(read('site/pricing.html'), /One saved sync per spreadsheet/);
  assert.match(read('site/pricing.html'), /Daily syncs are free\. Hourly syncs are Pro/);
  assert.match(read('site/privacy.html'), /only reads and writes the current spreadsheet/);
  assert.match(read('site/privacy.html'), /do not store spreadsheet contents on our servers/);
  assert.match(read('site/privacy.html'), /myaccount\.google\.com\/connections/);
  assert.match(read('site/privacy.html'), /24 hours/);
  assert.match(read('site/privacy.html'), /7 days/);
  assert.match(read('site/pricing.html'), /Price TBC/);
  assert.ok(read('site/robots.txt').includes(`${host}/sitemap.xml`));
  assert.ok(read('site/sitemap.xml').includes(host));
});

test('site design keeps the requested row-and-cell visual system', () => {
  const css = read('site/styles.css').toLowerCase();
  for (const colour of ['#F6F9FC', '#183344', '#0A716F', '#CAD8E1', '#E7F0F7', '#B55218']) {
    assert.match(css, new RegExp(colour.toLowerCase()));
  }
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
  assert.match(read('site/index.html'), /sheet-illustration/);
});

test('Workers Static Assets routes only API paths through the Worker', () => {
  const config = read('wrangler.toml');
  assert.match(config, /compatibility_date = "2026-11-09"/);
  assert.match(config, /directory = "\.\/site\/"/);
  assert.match(config, /binding = "ASSETS"/);
  assert.match(config, /run_worker_first = \["\/api\/\*"\]/);
  assert.match(config, /\[observability\]\nenabled = true/);
  assert.match(config, /\[observability\.traces\]\nenabled = true/);
  assert.doesNotMatch(read('worker/index.mjs'), /console\./);
  assert.equal(fs.existsSync(path.join(root, 'vercel.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'api')), false);
  assert.match(read('src/Lib.js'), /example-subdomain\.workers\.dev\/api\/licence/);
});
