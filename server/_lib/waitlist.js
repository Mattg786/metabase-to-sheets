'use strict';

const EMAIL_MAX = 254;
const NOTE_MAX = 500;
const REF_MAX = 120;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_HITS = 8;

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || email.length > EMAIL_MAX) return false;
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email) && !email.includes('..');
}

function normalizeNote(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, NOTE_MAX);
}

function normalizeRef(value) {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, REF_MAX);
}

async function hashIp(ip) {
  if (!ip) return '';
  const bytes = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function checkRateLimit(db, bucket, now = Date.now()) {
  if (!db || !bucket) return { ok: true };
  const row = await db.prepare('SELECT hits, window_start FROM waitlist_rate WHERE bucket = ?').bind(bucket).first();
  if (!row || now - Number(row.window_start) >= RATE_WINDOW_MS) {
    await db.prepare(
      'INSERT INTO waitlist_rate (bucket, hits, window_start) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET hits = 1, window_start = excluded.window_start',
    ).bind(bucket, now).run();
    return { ok: true };
  }
  if (Number(row.hits) >= RATE_MAX_HITS) return { ok: false };
  await db.prepare('UPDATE waitlist_rate SET hits = hits + 1 WHERE bucket = ?').bind(bucket).run();
  return { ok: true };
}

async function addSignup(db, { email, note, ref, ipHash }) {
  const existing = await db.prepare('SELECT email FROM waitlist WHERE email = ?').bind(email).first();
  if (existing) return { ok: true, duplicate: true };
  await db.prepare(
    "INSERT INTO waitlist (email, note, ref, ip_hash, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
  ).bind(email, note || '', ref || '', ipHash || '').run();
  return { ok: true, duplicate: false };
}

async function countSignups(db) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM waitlist').first();
  return Number(row && row.n) || 0;
}

module.exports = {
  EMAIL_MAX,
  NOTE_MAX,
  REF_MAX,
  RATE_WINDOW_MS,
  RATE_MAX_HITS,
  normalizeEmail,
  isValidEmail,
  normalizeNote,
  normalizeRef,
  hashIp,
  checkRateLimit,
  addSignup,
  countSignups,
};
