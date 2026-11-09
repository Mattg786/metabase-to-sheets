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
    'styles.css', 'site.js', 'site-config.js', 'sitemap.xml', 'robots.txt',
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
  const host = 'https://metabase-to-sheets.matthew-k-galea.workers.dev';
  for (const page of ['index', 'privacy', 'terms', 'support', 'pricing', 'success']) {
    const html = read(`site/${page}.html`);
    assert.match(html, /<title>/, page);
    assert.match(html, /name="description"/, page);
    assert.match(html, /property="og:image"/, page);
    assert.match(html, /data-canonical/, page);
    const pagePath = page === 'index' ? '/' : `/${page}`;
    assert.ok(html.includes(`href="${host}${pagePath}"`), page);
    assert.ok(html.includes(`content="${host}${pagePath}"`), page);
    assert.ok(html.includes(`content="${host}/assets/og.png"`), page);
    assert.equal(html.includes('og.svg'), false, page);
    assert.match(html, /href="\/(privacy|support|terms|pricing)"/, page);
  }
  assert.match(read('site/index.html'), /href="\/privacy"/);
  assert.match(read('site/index.html'), /href="\/support"/);
  assert.match(read('site/pricing.html'), /one saved sync per spreadsheet/);
  assert.match(read('site/privacy.html'), /only reads and writes the current spreadsheet/);
  assert.match(read('site/privacy.html'), /do not store spreadsheet contents on our servers/);
  assert.match(read('site/privacy.html'), /myaccount\.google\.com\/connections/);
  assert.match(read('site/privacy.html'), /24 hours/);
  assert.match(read('site/privacy.html'), /7 days/);
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
  assert.match(read('site/index.html'), /<table class="cells">/);
  assert.match(read('site/index.html'), /class="active-cell"/);
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
  assert.match(read('src/Lib.js'), /metabase-to-sheets\.matthew-k-galea\.workers\.dev\/api\/licence/);
});

const PAGES = ['index', 'privacy', 'terms', 'support', 'pricing', 'success'];
const between = (html, start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)) + end.length);

test('every page shares one nav, one status line, and one complete footer', () => {
  const footers = new Set();
  const statusLines = new Set();
  for (const page of PAGES) {
    const html = read(`site/${page}.html`);
    footers.add(between(html, '<footer', '</footer>'));
    statusLines.add(between(html, '<p class="status-line">', '</p>'));
    const nav = between(html, '<nav class="site-nav"', '</nav>');
    const labels = [...nav.matchAll(/>([^<]+)<\/a>/g)].map((match) => match[1]);
    assert.deepEqual(labels, ['Pricing', 'Support', 'Privacy', 'Terms'], page);
    const current = [...html.matchAll(/aria-current="page"/g)].length;
    assert.equal(current, page === 'success' ? 0 : 1, page);
    if (page !== 'index' && page !== 'success') assert.match(nav, new RegExp(`href="/${page}" aria-current="page"`), page);
    assert.doesNotMatch(html, /class="eyebrow"/, page);
    assert.equal(html.includes('—'), false, `${page} contains an em dash`);
    assert.doesNotMatch(html, /\bplanned\b/i, page);
  }
  assert.equal(footers.size, 1);
  assert.equal(statusLines.size, 1);
  const footer = [...footers][0];
  for (const link of ['/pricing', '/support', '/privacy', '/terms', 'github.com/Mattg786/metabase-to-sheets', 'mailto:']) {
    assert.ok(footer.includes(link), link);
  }
  assert.match([...statusLines][0], /Not on the Google Workspace Marketplace yet/);
});

test('pricing shows the Pro price as not yet available and fetches no payment link', () => {
  const pricing = read('site/pricing.html');
  assert.match(pricing, /\$9 <span class="price-unit">per month, USD<\/span>/);
  assert.match(pricing, /Not yet available to buy\./);
  assert.match(pricing, /Hourly schedule/);
  assert.match(pricing, /Every 6 hours schedule/);
  assert.doesNotMatch(pricing, /Continue to Stripe|data-payment-link|buy\.stripe\.com|Price TBC/);
  const js = read('site/site.js');
  assert.equal(js.includes('/api/payment-link'), false);
  assert.match(read('worker/index.mjs'), /'\/api\/payment-link': paymentLink/);
});

test('home has a setup guide CTA, no install link, and factual Pro schedules', () => {
  const home = read('site/index.html');
  assert.match(home, /<a class="button" href="https:\/\/github\.com\/Mattg786\/metabase-to-sheets#test-install">Read the setup guide<\/a>/);
  assert.match(read('README.md'), /^## Test install$/m);
  assert.doesNotMatch(home, /workspace\.google\.com\/marketplace/);
  assert.match(home, /Pro adds Hourly and Every 6 hours/);
  assert.match(home, /TODO\(dev\): replace this example with a real screenshot/);
  assert.doesNotMatch(css(), /position:\s*absolute;[^}]*top:\s*-28px/);
});

test('privacy states the real host and avoids implementation jargon', () => {
  const privacy = read('site/privacy.html');
  assert.match(privacy, /run on Cloudflare Workers/);
  assert.doesNotMatch(privacy, /prepared for Cloudflare|not yet live|UserProperties|cache/);
  for (const page of PAGES) assert.doesNotMatch(read(`site/${page}.html`), /UserProperties/, page);
});

test('support gives least-privilege key advice and what to send', () => {
  const support = read('site/support.html');
  assert.match(support, /Do not use a key in the Administrators group/);
  assert.match(support, /Never send your API key or licence key/);
  assert.match(support, /github\.com\/Mattg786\/metabase-to-sheets#test-install/);
});

test('the Open Graph image is a real 1200 by 630 PNG', () => {
  const png = fs.readFileSync(path.join(root, 'site', 'assets', 'og.png'));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.equal(fs.existsSync(path.join(root, 'site', 'assets', 'og.svg')), false);
});

test('the success page maps each API outcome to a clear state', () => {
  const { describeSession } = require('../site/site.js');
  assert.equal(describeSession('').tone, 'error');
  assert.match(describeSession('').message, /no payment reference/);
  assert.equal(describeSession('cs_test_1', null).retry, true);
  const pending = describeSession('cs_test_1', { verified: false, pending: true, reason: 'payment is not complete' });
  assert.equal(pending.tone, 'pending');
  assert.equal(pending.licenceKey, undefined);
  const success = describeSession('cs_test_1', { verified: true, licenceKey: 'mts_sub_key' });
  assert.equal(success.tone, 'success');
  assert.equal(success.licenceKey, 'mts_sub_key');
  assert.match(describeSession('cs_x', { verified: false, pending: false, reason: 'invalid checkout session' }).message, /does not recognise/);
  assert.match(describeSession('cs_x', { verified: false, pending: false, reason: 'payments not configured' }).message, /not on sale yet/);
  const other = describeSession('cs_x', { verified: false, pending: false, reason: 'checkout session could not be verified' });
  assert.equal(other.tone, 'error');
  assert.equal(other.message.includes('checkout session could not be verified'), false);
  const success_html = read('site/success.html');
  assert.match(success_html, /<h1>Your Pro licence key<\/h1>/);
  assert.match(success_html, /class="key-panel hidden" data-key-panel/);
  assert.match(success_html, /data-copy-key>Copy key</);
  assert.match(success_html, /href="\/pricing"/);
});

function css() {
  return read('site/styles.css');
}
