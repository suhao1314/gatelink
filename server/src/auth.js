'use strict';

const https = require('https');
const { config } = require('./config');
const { uid, nowSec, base64url, hmacSign, safeEqual, sha256, pickText } = require('./util');
const { getDb } = require('./db');

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function signToken(payload) {
  const body = Object.assign({}, payload, { exp: nowSec() + config.tokenTTL, iat: nowSec() });
  const encoded = base64url(JSON.stringify(body));
  const sig = base64url(hmacSign(encoded, config.tokenSecret));
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expect = base64url(hmacSign(parts[0], config.tokenSecret));
  if (!safeEqual(parts[1], expect)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(parts[0]));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.exp || payload.exp < nowSec()) return null;
  return payload;
}

function extractToken(req) {
  const raw = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return m ? m[1].trim() : null;
}

function findUserByOpenid(openid) {
  return getDb().prepare('SELECT * FROM users WHERE openid = ?').get(openid) || null;
}

function upsertUser(openid) {
  const db = getDb();
  const exist = findUserByOpenid(openid);
  const now = nowSec();
  if (exist) {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, exist.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(exist.id);
  }
  const id = uid('u');
  db.prepare('INSERT INTO users (id, openid, created_at, last_login_at) VALUES (?, ?, ?, ?)')
    .run(id, openid, now, now);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function jscode2session(code) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({
      appid: config.wxAppId,
      secret: config.wxSecret,
      js_code: code,
      grant_type: 'authorization_code',
    });
    const req = https.get(`https://api.weixin.qq.com/sns/jscode2session?${qs.toString()}`, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('微信返回解析失败'));
        }
      });
    });
    req.on('error', () => reject(new Error('无法连接微信接口')));
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('微信接口超时')); });
  });
}

async function login(code) {
  const cleaned = pickText(code, 128);
  if (config.devMode) {
    if (!cleaned) throw new Error('缺少登录凭证');
    const pseudo = 'dev_' + sha256(cleaned).slice(0, 20);
    const user = upsertUser(pseudo);
    return { user, dev: true };
  }
  if (!cleaned) throw new Error('缺少登录凭证');
  const data = await jscode2session(cleaned);
  if (data.errcode) {
    throw new Error(`微信登录失败（${data.errcode}）`);
  }
  if (!data.openid) throw new Error('微信登录失败');
  const user = upsertUser(data.openid);
  return { user, dev: false };
}

function requireUser(req) {
  const token = extractToken(req);
  const payload = verifyToken(token);
  if (!payload || !payload.uid) return null;
  return findUserById(payload.uid);
}

function publicUser(u) {
  return {
    id: u.id,
    nickname: u.nickname,
    createdAt: u.created_at,
  };
}

module.exports = {
  signToken, verifyToken, extractToken, login, requireUser,
  findUserById, upsertUser, publicUser, b64urlDecode,
};
