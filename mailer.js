'use strict';

// Minimal SMTP client with no dependencies. Works with Gmail (smtp.gmail.com) and most providers.
//
// Settings (environment variables):
//   SMTP_HOST   e.g. smtp.gmail.com
//   SMTP_PORT   465 (secure from the start, default) or 587 (upgrades with STARTTLS)
//   SMTP_USER   the account to log in with, e.g. pailapilates10@gmail.com
//   SMTP_PASS   for Gmail this must be an App Password, not the normal password
//   MAIL_FROM   optional, e.g. "Paila Pilates <pailapilates10@gmail.com>" (defaults to SMTP_USER)
//   SMTP_ALLOW_PLAIN=1  testing only: allow a server without encryption

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const TIMEOUT_MS = 20000;

function configured(env = process.env) {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

const stripBreaks = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const bareAddress = (s) => {
  const m = String(s).match(/<([^>]+)>/);
  return stripBreaks(m ? m[1] : s);
};
const encodeHeader = (s) => {
  s = stripBreaks(s);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  // Several short encoded words (each under 75 characters), joined by a header fold
  const words = [];
  let chunk = '';
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 42) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => '=?UTF-8?B?' + Buffer.from(w, 'utf8').toString('base64') + '?=').join('\r\n ');
};
const wrap64 = (buf) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');

function buildMessage({ from, to, replyTo, subject, text, html }) {
  const boundary = '=_' + crypto.randomBytes(12).toString('hex');
  const domain = (bareAddress(from).split('@')[1] || 'localhost');
  const head = [
    'From: ' + stripBreaks(from),
    'To: ' + stripBreaks(to),
    replyTo ? 'Reply-To: ' + stripBreaks(replyTo) : null,
    'Subject: ' + encodeHeader(subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"'
  ].filter(Boolean).join('\r\n');

  const part = (type, body) =>
    '--' + boundary + '\r\nContent-Type: ' + type + '; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    wrap64(Buffer.from(body, 'utf8')) + '\r\n';

  return head + '\r\n\r\n' + part('text/plain', text) + (html ? part('text/html', html) : '') + '--' + boundary + '--\r\n';
}

// A small line-based SMTP conversation helper
class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.waiting = null;
    this.error = null;
    socket.setEncoding('utf8');
    socket.on('data', (d) => { this.buffer += d; this._flush(); });
    socket.on('error', (e) => { this.error = e; this._flush(); });
    socket.on('close', () => { this.error = this.error || new Error('Connection closed'); this._flush(); });
  }

  _flush() {
    if (!this.waiting) return;
    if (this.error && !this._complete()) { const w = this.waiting; this.waiting = null; clearTimeout(w.timer); w.reject(this.error); return; }
    const reply = this._complete();
    if (reply) { const w = this.waiting; this.waiting = null; clearTimeout(w.timer); w.resolve(reply); }
  }

  // A reply is complete when its last line is "NNN text" (no dash after the code)
  _complete() {
    const lines = this.buffer.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
        const used = lines.slice(0, i + 1);
        this.buffer = lines.slice(i + 1).join('\r\n');
        return { code: Number(used[i].slice(0, 3)), lines: used.map((l) => l.slice(4)) };
      }
    }
    return null;
  }

  read() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting = null; reject(new Error('SMTP timeout')); }, TIMEOUT_MS);
      this.waiting = { resolve, reject, timer };
      this._flush();
    });
  }

  async cmd(line, expect) {
    this.socket.write(line + '\r\n');
    const r = await this.read();
    if (expect && !expect.includes(r.code)) throw new Error('SMTP ' + r.code + ' after "' + line.split(' ')[0] + '": ' + r.lines.join(' ').slice(0, 160));
    return r;
  }
}

async function sendMail({ to, subject, text, html, replyTo }, env = process.env) {
  if (!configured(env)) throw new Error('SMTP is not configured');
  const host = env.SMTP_HOST;
  const port = Number(env.SMTP_PORT || 465);
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === '1' : port === 465;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  const from = env.MAIL_FROM || user;
  const clientName = 'localhost';

  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('SMTP timeout')));
  let conn = new Conn(socket);

  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.once(secure ? 'secureConnect' : 'connect', resolve);
    });
    const greet = await conn.read();
    if (greet.code !== 220) throw new Error('SMTP greeting ' + greet.code);

    let ehlo = await conn.cmd('EHLO ' + clientName, [250]);
    if (!secure) {
      const canTls = ehlo.lines.some((l) => /^STARTTLS/i.test(l));
      if (canTls) {
        await conn.cmd('STARTTLS', [220]);
        const upgraded = tls.connect({ socket, servername: host });
        await new Promise((resolve, reject) => { upgraded.once('secureConnect', resolve); upgraded.once('error', reject); });
        conn = new Conn(upgraded);
        ehlo = await conn.cmd('EHLO ' + clientName, [250]);
      } else if (env.SMTP_ALLOW_PLAIN !== '1') {
        throw new Error('The mail server does not offer encryption (STARTTLS). Refusing to send the password in plain text.');
      }
    }

    const mechs = (ehlo.lines.find((l) => /^AUTH\s/i.test(l)) || '').toUpperCase();
    if (!mechs || mechs.includes('PLAIN')) {
      await conn.cmd('AUTH PLAIN ' + Buffer.from('\0' + user + '\0' + pass).toString('base64'), [235]);
    } else if (mechs.includes('LOGIN')) {
      await conn.cmd('AUTH LOGIN', [334]);
      await conn.cmd(Buffer.from(user).toString('base64'), [334]);
      await conn.cmd(Buffer.from(pass).toString('base64'), [235]);
    } else {
      throw new Error('No supported login method offered by the mail server');
    }

    await conn.cmd('MAIL FROM:<' + bareAddress(from) + '>', [250]);
    await conn.cmd('RCPT TO:<' + bareAddress(to) + '>', [250, 251]);
    await conn.cmd('DATA', [354]);
    const message = buildMessage({ from, to, replyTo, subject, text, html })
      .replace(/\r?\n/g, '\r\n')
      .replace(/^\./gm, '..');
    conn.socket.write(message + '\r\n.\r\n');
    const done = await conn.read();
    if (done.code !== 250) throw new Error('SMTP ' + done.code + ' after message: ' + done.lines.join(' ').slice(0, 160));
    try { conn.socket.write('QUIT\r\n'); await conn.read(); } catch (e) { /* the message was already accepted */ }
    return true;
  } finally {
    try { conn.socket.destroy(); } catch (e) { /* ignore */ }
    try { socket.destroy(); } catch (e) { /* ignore */ }
  }
}

module.exports = { configured, sendMail, buildMessage };
