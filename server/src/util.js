'use strict';

const crypto = require('crypto');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomStr(n) {
  const b = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
}

function uid(prefix) {
  return (prefix ? prefix + '_' : '') + Date.now().toString(36) + randomStr(8);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function dayStr(ts) {
  const d = ts === undefined ? new Date() : new Date(ts * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function hourOf(ts) {
  return new Date(ts * 1000).getHours();
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function visitorHash(ip, ua) {
  return sha256(`${ip}|${ua}|${arguments[2] || ''}`).slice(0, 32);
}

function toInt(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function toIntClamped(v, d, min, max) {
  const n = toInt(v, d);
  return Math.min(max, Math.max(min, n));
}

function clampStr(s, max) {
  if (s === undefined || s === null) return '';
  const t = String(s);
  return t.length > max ? t.slice(0, max) : t;
}

function stripControl(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function isHexColor(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function pickText(v, max, fallback) {
  const t = clampStr(stripControl(v), max);
  return t === '' ? (fallback || '') : t;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hmacSign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function parseJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function mapFields(body, spec) {
  const out = {};
  for (const key of Object.keys(spec)) {
    const rule = spec[key];
    const raw = body[key];
    if (raw === undefined) continue;
    if (rule.type === 'text') out[key] = pickText(raw, rule.max);
    else if (rule.type === 'int') out[key] = typeof rule.clamp === 'function' ? rule.clamp(raw) : toInt(raw, 0);
    else if (rule.type === 'bool') out[key] = raw === true || raw === '1' || raw === 1 ? 1 : 0;
    else if (rule.type === 'enum') out[key] = rule.values.indexOf(raw) >= 0 ? raw : undefined;
    else if (rule.type === 'color') out[key] = isHexColor(raw) ? raw : undefined;
    else out[key] = raw;
  }
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

function daysAgoTs(days) {
  return nowSec() - days * 86400;
}

module.exports = {
  uid, randomStr, nowSec, dayStr, hourOf, sha256, visitorHash,
  toInt, toIntClamped, clampStr, stripControl, isHexColor, pickText,
  base64url, hmacSign, safeEqual, parseJsonBody, mapFields, daysAgoTs,
};
