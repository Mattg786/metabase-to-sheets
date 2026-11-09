'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const required = [
  'site/index.html',
  'site/privacy.html',
  'site/terms.html',
  'site/support.html',
  'site/pricing.html',
  'site/success.html',
  'site/styles.css',
  'site/site.js',
  'site/site-config.js',
  'site/sitemap.xml',
  'site/robots.txt',
  'site/assets/og.svg',
];

for (const relative of required) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`Missing site file: ${relative}`);
}

console.log(`Site build check passed for ${required.length} files.`);
