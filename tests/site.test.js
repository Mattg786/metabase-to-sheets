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
  for (const page of ['index', 'privacy', 'terms', 'support', 'pricing', 'success']) {
    const html = read(`site/${page}.html`);
    assert.match(html, /<title>/, page);
    assert.match(html, /name="description"/, page);
    assert.match(html, /property="og:image"/, page);
    assert.match(html, /data-canonical/, page);
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

test('Vercel routes keep API functions outside the static rewrites', () => {
  const config = JSON.parse(read('vercel.json'));
  const destinations = config.rewrites.map((item) => item.destination);
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'site');
  assert.equal(destinations.some((destination) => destination.startsWith('/api/')), false);
  assert.equal(destinations.every((destination) => !destination.startsWith('/site/')), true);
  assert.equal(destinations.includes('/index.html'), true);
  assert.equal(destinations.includes('/success.html'), true);
  assert.deepEqual(fs.readdirSync(path.join(root, 'api')).sort(), [
    'licence.js',
    'payment-link.js',
    'success-session.js',
    'webhook.js',
  ]);
});
