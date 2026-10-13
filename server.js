'use strict';

// Paila Pilates server. No dependencies: run with `node server.js` (Node 18 or newer).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const cfg = require('./config');
const payments = require('./payments');
const mailer = require('./mailer');
const emails = require('./emails');

const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1'; // set to 1 when served over HTTPS
const TRUST_PROXY = process.env.TRUST_PROXY === '1';     // set to 1 behind a reverse proxy
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';       // enables /admin and /api/admin/*
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || ''; // enables /api/webhooks/payment
const ALLOW_DEMO = process.env.ALLOW_DEMO_PAYMENTS === '1';       // testing only: pay without paying
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const NOTIFY_STUDIO = process.env.NOTIFY_STUDIO !== '0'; // also email the studio when a booking is confirmed
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DATA_FILE), 'backups');
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 30)); // how many daily copies to keep
const SESSION_DAYS = 30;
const HOLD_MS = cfg.holdMinutes * 60 * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DUMMY_SALT = crypto.randomBytes(16);

// ---------- Storage (a JSON file, written atomically) ----------
let db = { users: [], sessions: {}, bookings: [], cancelledSessions: {} };

function loadDb() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db = { users: raw.users || [], sessions: raw.sessions || {}, bookings: raw.bookings || [], cancelledSessions: raw.cancelledSessions || {} };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
function saveDb() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}
function purgeSessions() {
  const now = Date.now();
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].expires < now) delete db.sessions[k];
}

// ---------- Backups ----------
// Saves a dated copy of the data file (one per day, refreshed every few hours) and deletes the oldest.
// This protects against mistakes and corruption. Also copy the backups folder off this server.
function runBackup() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(BACKUP_DIR, `db-${day}.json`);
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    fs.copyFileSync(DATA_FILE, target);
    fs.chmodSync(target, 0o600);
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    files.slice(0, Math.max(0, files.length - BACKUP_KEEP)).forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch (e) {
    console.error('Backup failed:', e.message);
  }
}

// ---------- Small helpers ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// Short codes added to error replies so the website can show them in the visitor's language.
const ERROR_CODES = {
  'Request blocked.': 'blocked',
  'Unsupported content type.': 'content_type',
  'Too many attempts. Please try again later.': 'rate_limited',
  'Invalid request.': 'invalid_request',
  'Enter your name.': 'name_required',
  'Enter a valid email address.': 'email_invalid',
  'Use a password of 8 to 128 characters.': 'password_length',
  'An account with this email already exists. Log in instead.': 'email_taken',
  'Incorrect email or password.': 'bad_login',
  'Please log in to continue.': 'login_required',
  'That session is no longer available.': 'session_gone',
  'That class has been cancelled.': 'session_cancelled',
  'That session is full.': 'session_full',
  'You have several unpaid bookings. Please pay for or cancel one first.': 'too_many_unpaid',
  'Booking not found.': 'not_found',
  'This booking is paid. Please contact the studio to change it.': 'paid_contact',
  'This booking has expired. Please book again.': 'expired',
  'Something went wrong. Please try again.': 'server_error'
};

function sendJson(res, status, obj) {
  if (obj && obj.error && !obj.code && ERROR_CODES[obj.error]) obj.code = ERROR_CODES[obj.error];
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; frame-src https://www.google.com; connect-src 'self'; " +
    "form-action 'self'; base-uri 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (COOKIE_SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function readBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) tooBig = true; else chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(Object.assign(new Error('Request too large'), { status: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

function parseJson(raw) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || 'unknown';
}

// Simple in-memory attempt counter (resets on restart)
const attempts = new Map();
function tooMany(key, max, windowMs) {
  const now = Date.now();
  const arr = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  attempts.set(key, arr);
  return arr.length >= max;
}
function record(key) {
  const arr = attempts.get(key) || [];
  arr.push(Date.now());
  attempts.set(key, arr);
}
const FIFTEEN_MIN = 15 * 60 * 1000;

function originOk(origin, req) {
  try {
    return new URL(origin).host === req.headers.host || (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN);
  } catch (e) {
    return false;
  }
}

// ---------- Sessions (login) ----------
function setCookie(res, token, maxAgeSec) {
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${COOKIE_SECURE ? '; Secure' : ''}`);
}
function createSession(userId) {
  purgeSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions[sha256(token)] = { userId, expires: Date.now() + SESSION_DAYS * 86400000 };
  return token;
}
function currentUser(req) {
  const tok = parseCookies(req).sid;
  if (!tok) return null;
  const rec = db.sessions[sha256(tok)];
  if (!rec || rec.expires < Date.now()) return null;
  return db.users.find((u) => u.id === rec.userId) || null;
}
const publicUser = (u) => ({ name: u.name, email: u.email, firstClassOffer: firstClassOffer(u) });

// ---------- Timetable ----------
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function studioToday() {
  const d = new Date(Date.now() + cfg.utcOffsetMinutes * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}
function buildSession(y, m, d, time, cid) {
  const [hh, mm] = time.split(':').map(Number);
  return {
    id: `${dateStr(y, m, d)}|${time}|${cid}`,
    date: dateStr(y, m, d),
    time,
    cid,
    startMs: Date.UTC(y, m, d, hh, mm) - cfg.utcOffsetMinutes * 60000
  };
}
function allSessions() {
  const t = studioToday();
  const out = [];
  for (let i = 0; i < cfg.windowDays; i++) {
    const dt = new Date(Date.UTC(t.y, t.m, t.d + i));
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth(), d = dt.getUTCDate();
    const sessions = (cfg.week[dt.getUTCDay()] || [])
      .map(([time, cid]) => buildSession(y, m, d, time, cid))
      .map((s) => Object.assign(s, { cancelled: Boolean(db.cancelledSessions[s.id]) }))
      .filter((s) => s.startMs > Date.now());
    if (sessions.length) out.push({ date: dateStr(y, m, d), sessions });
  }
  return out;
}
function findSession(id) {
  for (const day of allSessions()) {
    const s = day.sessions.find((x) => x.id === id);
    if (s) return s;
  }
  return null;
}

// ---------- Bookings ----------
const isHeld = (b) => b.status === 'pending' && Date.now() - b.created < HOLD_MS;
const isActive = (b) => b.status === 'paid' || isHeld(b);

function activeQty(sid) {
  return db.bookings.filter((b) => b.sid === sid && isActive(b)).reduce((a, b) => a + b.qty, 0);
}
function spotsLeft(s) {
  if (s.cancelled) return 0;
  return Math.max(0, cfg.classes[s.cid].cap - activeQty(s.id));
}
function publicBooking(b) {
  const [date, time] = b.sid.split('|');
  const status = b.status === 'pending' && !isHeld(b) ? 'expired' : b.status;
  return {
    id: b.id, ref: b.ref, sid: b.sid, cid: b.cid, date, time,
    start: new Date(b.startMs).toISOString(),
    qty: b.qty, amount: b.amount, discount: b.discount || 0, status, created: b.created,
    expiresAt: b.status === 'pending' ? b.created + HOLD_MS : null
  };
}
// Marks a booking paid and emails the customer (and the studio). Email problems never block the booking.
const sending = new Set();
async function sendConfirmation(b, force) {
  if (!force && b.emailSent) return false;
  if (sending.has(b.id)) return false;
  const user = db.users.find((u) => u.id === b.userId);
  if (!user) return false;
  if (!mailer.configured()) {
    console.log(`[mail] SMTP is not configured, so no email was sent for ${b.ref}.`);
    return false;
  }
  sending.add(b.id);
  try {
    await mailer.sendMail(Object.assign({ to: user.email }, emails.customerConfirmation(b, user, cfg)));
    b.emailSent = true;
    delete b.emailError;
    saveDb();
    if (NOTIFY_STUDIO && cfg.contactEmail) {
      try {
        await mailer.sendMail(Object.assign({ to: cfg.contactEmail }, emails.studioNotice(b, user, cfg)));
      } catch (e) {
        console.error('[mail] studio notice failed:', e.message);
      }
    }
    return true;
  } catch (e) {
    b.emailError = String(e.message).slice(0, 200);
    saveDb();
    console.error(`[mail] confirmation for ${b.ref} failed:`, e.message);
    return false;
  } finally {
    sending.delete(b.id);
  }
}
function markPaid(b, method) {
  if (b.status !== 'paid') { b.status = 'paid'; b.paidAt = Date.now(); b.method = b.method || method; }
  saveDb();
  sendConfirmation(b).catch((e) => console.error('[mail]', e.message));
}

const money = (n) => Math.round(n * 100) / 100;

// The first-class offer: one discounted spot per customer. It counts as used once a discounted booking is
// paid, or while one is waiting for payment. If that booking is cancelled it becomes available again.
// (Anyone can register several email addresses, so turn on email verification if this is abused.)
function firstClassOffer(user) {
  if (!(cfg.firstClassDiscount > 0)) return false;
  return !db.bookings.some((b) => b.userId === user.id && b.discount > 0 && (b.status === 'paid' || isHeld(b)));
}

// Emails a customer that the studio cancelled their class. Never blocks the cancellation itself.
async function sendCancellation(b, force) {
  if (!force && b.cancelEmailSent) return false;
  const key = 'c:' + b.id;
  if (sending.has(key)) return false;
  const user = db.users.find((u) => u.id === b.userId);
  if (!user) return false;
  if (!mailer.configured()) {
    console.log(`[mail] SMTP is not configured, so no cancellation email was sent for ${b.ref}.`);
    return false;
  }
  sending.add(key);
  try {
    await mailer.sendMail(Object.assign({ to: user.email }, emails.cancellation(b, user, cfg, b.cancelReason)));
    b.cancelEmailSent = true;
    delete b.cancelEmailError;
    saveDb();
    return true;
  } catch (e) {
    b.cancelEmailError = String(e.message).slice(0, 200);
    saveDb();
    console.error(`[mail] cancellation for ${b.ref} failed:`, e.message);
    return false;
  } finally {
    sending.delete(key);
  }
}

function newRef() {
  return 'PA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ---------- Validation ----------
const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- API ----------
async function api(req, res, url, p) {
  const method = req.method;
  const ip = clientIp(req);

  // Block cross-site and non-JSON writes (cookie auth routes only)
  if (method === 'POST' && p !== '/api/webhooks/payment' && !p.startsWith('/api/admin/')) {
    const origin = req.headers.origin;
    if (origin && !originOk(origin, req)) return sendJson(res, 403, { error: 'Request blocked.' });
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return sendJson(res, 415, { error: 'Unsupported content type.' });
    }
  }

  // Public
  if (method === 'GET' && p === '/api/config') {
    return sendJson(res, 200, {
      studio: cfg.studioName, currency: cfg.currency, price: cfg.price, timezone: cfg.timezone,
      maxSpots: cfg.maxSpots, holdMinutes: cfg.holdMinutes, emailEnabled: mailer.configured(), firstClassDiscount: cfg.firstClassDiscount || 0,
      classes: Object.fromEntries(Object.entries(cfg.classes).map(([k, c]) => [k, { name: c.name }]))
    });
  }

  if (method === 'GET' && p === '/api/sessions') {
    const t = studioToday();
    return sendJson(res, 200, {
      today: dateStr(t.y, t.m, t.d),
      days: allSessions().map((day) => ({
        date: day.date,
        sessions: day.sessions.map((s) => ({
          id: s.id, time: s.time, cid: s.cid, start: new Date(s.startMs).toISOString(), left: spotsLeft(s), cancelled: s.cancelled
        }))
      }))
    });
  }

  if (method === 'GET' && p === '/api/me') {
    const u = currentUser(req);
    return sendJson(res, 200, { user: u ? publicUser(u) : null });
  }

  // Accounts
  if (method === 'POST' && p === '/api/register') {
    if (tooMany('reg|' + ip, 10, FIFTEEN_MIN)) return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
    record('reg|' + ip);
    const body = parseJson(await readBody(req));
    if (!body) return sendJson(res, 400, { error: 'Invalid request.' });
    const name = clean(body.name, 80);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(body.password || '');
    if (!name) return sendJson(res, 400, { error: 'Enter your name.' });
    if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return sendJson(res, 400, { error: 'Use a password of 8 to 128 characters.' });
    if (db.users.some((u) => u.email === email)) {
      return sendJson(res, 409, { error: 'An account with this email already exists. Log in instead.' });
    }
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    if (db.users.some((u) => u.email === email)) {
      return sendJson(res, 409, { error: 'An account with this email already exists. Log in instead.' });
    }
    const user = { id: crypto.randomUUID(), name, email, salt: salt.toString('hex'), hash: hash.toString('hex'), created: Date.now() };
    db.users.push(user);
    const token = createSession(user.id);
    saveDb();
    setCookie(res, token, SESSION_DAYS * 86400);
    return sendJson(res, 201, { user: publicUser(user) });
  }

  if (method === 'POST' && p === '/api/login') {
    const body = parseJson(await readBody(req));
    if (!body) return sendJson(res, 400, { error: 'Invalid request.' });
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(body.password || '').slice(0, 128);
    if (tooMany('login|' + ip, 20, FIFTEEN_MIN) || tooMany('loginE|' + email, 8, FIFTEEN_MIN)) {
      return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
    }
    const user = db.users.find((u) => u.email === email);
    const hash = await scrypt(password, user ? Buffer.from(user.salt, 'hex') : DUMMY_SALT, 64);
    const ok = user && crypto.timingSafeEqual(hash, Buffer.from(user.hash, 'hex'));
    if (!ok) {
      record('login|' + ip);
      record('loginE|' + email);
      return sendJson(res, 401, { error: 'Incorrect email or password.' });
    }
    const token = createSession(user.id);
    saveDb();
    setCookie(res, token, SESSION_DAYS * 86400);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (method === 'POST' && p === '/api/logout') {
    const tok = parseCookies(req).sid;
    if (tok && db.sessions[sha256(tok)]) { delete db.sessions[sha256(tok)]; saveDb(); }
    setCookie(res, '', 0);
    return sendJson(res, 200, { ok: true });
  }

  // Bookings (login required)
  if (p === '/api/bookings' || /^\/api\/bookings\/[\w-]+\/(cancel|demo-pay)$/.test(p)) {
    const user = currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Please log in to continue.' });

    if (method === 'GET' && p === '/api/bookings') {
      const now = Date.now();
      const list = db.bookings
        .filter((b) => b.userId === user.id && b.startMs > now && (b.status === 'paid' || isHeld(b)))
        .sort((a, b) => a.startMs - b.startMs)
        .map(publicBooking);
      return sendJson(res, 200, { bookings: list });
    }

    if (method === 'POST' && p === '/api/bookings') {
      const body = parseJson(await readBody(req));
      if (!body) return sendJson(res, 400, { error: 'Invalid request.' });
      const qty = Number(body.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > cfg.maxSpots) {
        return sendJson(res, 400, { error: `Choose between 1 and ${cfg.maxSpots} spots.`, code: 'qty_range', n: cfg.maxSpots });
      }
      const s = findSession(String(body.sid || ''));
      if (!s) return sendJson(res, 404, { error: 'That session is no longer available.' });
      if (s.cancelled) return sendJson(res, 409, { error: 'That class has been cancelled.' });
      const left = spotsLeft(s);
      if (left <= 0) return sendJson(res, 409, { error: 'That session is full.' });
      if (qty > left) return sendJson(res, 409, { error: `Only ${left} ${left === 1 ? 'spot is' : 'spots are'} left.`, code: 'qty_over', n: left });
      if (db.bookings.filter((b) => b.userId === user.id && isHeld(b)).length >= 5) {
        return sendJson(res, 429, { error: 'You have several unpaid bookings. Please pay for or cancel one first.' });
      }
      // No awaits between the availability check above and the insert below.
      // A new account gets the first-class offer on one spot, once (see firstClassOffer).
      const discount = firstClassOffer(user) ? money(cfg.price * cfg.firstClassDiscount) : 0;
      const booking = {
        id: crypto.randomUUID(), ref: newRef(), userId: user.id, sid: s.id, cid: s.cid, startMs: s.startMs,
        qty, discount, amount: money(qty * cfg.price - discount), status: 'pending', created: Date.now(),
        lang: body.lang === 'ne' ? 'ne' : 'en'
      };
      db.bookings.push(booking);
      saveDb();
      const checkout = await payments.checkoutOptions(booking, user, cfg);
      return sendJson(res, 201, { booking: publicBooking(booking), checkout, demo: ALLOW_DEMO, holdMinutes: cfg.holdMinutes });
    }

    const m = p.match(/^\/api\/bookings\/([\w-]+)\/(cancel|demo-pay)$/);
    if (method === 'POST' && m) {
      const b = db.bookings.find((x) => x.id === m[1] && x.userId === user.id);
      if (!b) return sendJson(res, 404, { error: 'Booking not found.' });
      if (m[2] === 'cancel') {
        if (b.status === 'paid') return sendJson(res, 409, { error: 'This booking is paid. Please contact the studio to change it.' });
        b.status = 'cancelled';
        b.cancelledBy = 'customer';
        saveDb();
        return sendJson(res, 200, { ok: true });
      }
      if (!ALLOW_DEMO) return sendJson(res, 404, { error: 'Not found.' });
      if (!isHeld(b)) return sendJson(res, 409, { error: 'This booking has expired. Please book again.' });
      markPaid(b, 'demo');
      return sendJson(res, 200, { booking: publicBooking(b) });
    }
  }

  // Payment provider webhook (signed with HMAC-SHA256 of the raw body, hex, in X-Signature)
  if (method === 'POST' && p === '/api/webhooks/payment') {
    if (!WEBHOOK_SECRET) return sendJson(res, 404, { error: 'Not found.' });
    const raw = await readBody(req);
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    if (!safeEqual(String(req.headers['x-signature'] || ''), expected)) return sendJson(res, 401, { error: 'Invalid signature.' });
    const body = parseJson(raw);
    if (!body || body.status !== 'paid') return sendJson(res, 200, { ok: true, ignored: true });
    const b = db.bookings.find((x) => x.ref === String(body.ref || ''));
    if (!b) return sendJson(res, 404, { error: 'Unknown reference.' });
    if (body.amount !== undefined && Number(body.amount) !== b.amount) return sendJson(res, 400, { error: 'Amount mismatch.' });
    if (b.status === 'paid') return sendJson(res, 200, { ok: true });
    const wasCancelled = b.status === 'cancelled' || !isHeld(b);
    b.status = 'paid';
    b.paidAt = Date.now();
    if (wasCancelled && activeQty(b.sid) > cfg.classes[b.cid].cap) b.note = 'Paid after the hold expired and the class is now over capacity. Please contact the customer.';
    markPaid(b, 'webhook');
    return sendJson(res, 200, { ok: true });
  }

  // Admin (Bearer ADMIN_TOKEN)
  if (p.startsWith('/api/admin/')) {
    if (!ADMIN_TOKEN) return sendJson(res, 404, { error: 'Not found.' });
    if (tooMany('admin|' + ip, 10, FIFTEEN_MIN)) return sendJson(res, 429, { error: 'Too many attempts.' });
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), ADMIN_TOKEN)) {
      record('admin|' + ip);
      return sendJson(res, 401, { error: 'Unauthorized.' });
    }
    if (method === 'GET' && p === '/api/admin/bookings') {
      const users = new Map(db.users.map((u) => [u.id, u]));
      const rows = db.bookings
        .slice()
        .sort((a, b) => a.startMs - b.startMs)
        .map((b) => Object.assign(publicBooking(b), {
          name: (users.get(b.userId) || {}).name || '',
          email: (users.get(b.userId) || {}).email || '',
          note: b.note || '',
          emailSent: Boolean(b.emailSent),
          emailError: b.emailError || '',
          cancelledBy: b.cancelledBy || '',
          wasPaid: Boolean(b.wasPaid),
          cancelEmailSent: Boolean(b.cancelEmailSent),
          cancelEmailError: b.cancelEmailError || ''
        }));
      return sendJson(res, 200, { bookings: rows, customers: db.users.length, timezone: cfg.timezone });
    }
    if (method === 'GET' && p === '/api/admin/sessions') {
      const list = [];
      for (const day of allSessions()) {
        for (const s of day.sessions) {
          if (s.cancelled) continue;
          const active = db.bookings.filter((b) => b.sid === s.id && isActive(b));
          list.push({ id: s.id, cid: s.cid, start: new Date(s.startMs).toISOString(), bookings: active.length, spots: active.reduce((a, b) => a + b.qty, 0) });
        }
      }
      return sendJson(res, 200, { sessions: list, timezone: cfg.timezone });
    }

    // Cancel a whole class: stops new bookings, cancels every active booking and emails each customer.
    if (method === 'POST' && p === '/api/admin/sessions/cancel') {
      const body = parseJson(await readBody(req)) || {};
      const sid = String(body.sid || '');
      const reason = clean(body.reason, 300);
      const s = allSessions().flatMap((d) => d.sessions).find((x) => x.id === sid);
      if (!s) return sendJson(res, 404, { error: 'Class not found.' });
      if (s.cancelled) return sendJson(res, 409, { error: 'That class is already cancelled.' });
      db.cancelledSessions[sid] = { at: Date.now(), reason };
      const affected = db.bookings.filter((b) => b.sid === sid && isActive(b));
      for (const b of affected) {
        b.wasPaid = b.status === 'paid';
        b.status = 'cancelled';
        b.cancelledBy = 'studio';
        b.cancelReason = reason;
      }
      saveDb();
      let emailed = 0;
      for (const b of affected) if (await sendCancellation(b)) emailed++;
      return sendJson(res, 200, { ok: true, cancelled: affected.length, emailed });
    }

    const am = p.match(/^\/api\/admin\/bookings\/([\w-]+)\/(paid|cancel|resend)$/);
    if (method === 'POST' && am) {
      const b = db.bookings.find((x) => x.id === am[1]);
      if (!b) return sendJson(res, 404, { error: 'Booking not found.' });
      const body = parseJson(await readBody(req)) || {};
      if (am[2] === 'resend') {
        if (b.status === 'paid') {
          const sent = await sendConfirmation(b, true);
          return sendJson(res, 200, { ok: true, sent, error: sent ? null : (b.emailError || 'SMTP is not configured.') });
        }
        if (b.status === 'cancelled' && b.cancelledBy === 'studio') {
          const sent = await sendCancellation(b, true);
          return sendJson(res, 200, { ok: true, sent, error: sent ? null : (b.cancelEmailError || 'SMTP is not configured.') });
        }
        return sendJson(res, 409, { error: 'Only paid or studio-cancelled bookings have an email to resend.' });
      }
      if (am[2] === 'paid') { markPaid(b, 'manual'); return sendJson(res, 200, { ok: true }); }
      // cancel
      const wasActive = isActive(b);
      let emailed = false;
      if (b.status !== 'cancelled') {
        b.wasPaid = b.status === 'paid';
        b.status = 'cancelled';
        b.cancelledBy = 'studio';
        b.cancelReason = clean(body.reason, 300);
        saveDb();
        if (wasActive) emailed = await sendCancellation(b);
      }
      return sendJson(res, 200, { ok: true, emailed });
    }
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

// ---------- Static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
  let rel;
  try { rel = decodeURIComponent(p); } catch (e) { res.writeHead(400); return res.end(); }
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// ---------- Start ----------
loadDb();

const server = http.createServer(async (req, res) => {
  try {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await api(req, res, url, url.pathname);
    else serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e && e.status === 413) return sendJson(res, 413, { error: 'Request too large.' });
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
    else res.end();
  }
});

setInterval(() => { purgeSessions(); }, 60 * 60 * 1000).unref();

if (require.main === module) {
  runBackup();
  setInterval(runBackup, 6 * 60 * 60 * 1000).unref();
  server.listen(PORT, HOST, () => {
    console.log(`${cfg.studioName} running on http://localhost:${PORT}`);
    console.log(`Daily backups of the data file go to ${BACKUP_DIR} (keeping ${BACKUP_KEEP}).`);
    if (!COOKIE_SECURE) console.log('Note: COOKIE_SECURE is off. Set COOKIE_SECURE=1 when serving over HTTPS.');
    if (!ADMIN_TOKEN) console.log('Note: ADMIN_TOKEN is not set, so /admin is disabled.');
    if (!WEBHOOK_SECRET) console.log('Note: PAYMENT_WEBHOOK_SECRET is not set, so payment webhooks are disabled.');
    if (!mailer.configured()) console.log('Note: SMTP is not configured, so confirmation emails are not sent. See the README.');
  });
}

module.exports = server;
