'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { config } = require('./config');
const { isHexColor } = require('./util');

function clampSize(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 512;
  return Math.min(1280, Math.max(160, n));
}

function clampMargin(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 2;
  return Math.min(8, Math.max(0, n));
}

function normalizeOpts(q) {
  const color = isHexColor(q.color) ? q.color : '#000000';
  const bg = isHexColor(q.bg) ? q.bg : '#FFFFFF';
  return {
    size: clampSize(q.size),
    margin: clampMargin(q.margin),
    color,
    bg,
  };
}

function cacheKey(text, o) {
  return crypto.createHash('md5').update(`${text}|${o.size}|${o.margin}|${o.color}|${o.bg}`).digest('hex').slice(0, 20);
}

async function makePng(text, o) {
  const buf = await QRCode.toBuffer(text, {
    type: 'png',
    width: o.size,
    margin: o.margin,
    errorCorrectionLevel: 'M',
    color: { dark: o.color, light: o.bg },
  });
  return buf;
}

async function makeSvg(text, o) {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: o.margin,
    errorCorrectionLevel: 'M',
    color: { dark: o.color, light: o.bg },
  });
  return Buffer.from(svg, 'utf8');
}

async function generate(text, query, format) {
  const o = normalizeOpts(query || {});
  const key = cacheKey(text, o);
  const ext = format === 'svg' ? 'svg' : 'png';
  const file = path.join(config.qrDir, `${key}.${ext}`);

  if (fs.existsSync(file)) {
    return {
      buffer: fs.readFileSync(file),
      contentType: ext === 'svg' ? 'image/svg+xml' : 'image/png',
      cached: true,
    };
  }

  const buffer = ext === 'svg' ? await makeSvg(text, o) : await makePng(text, o);
  fs.writeFileSync(file, buffer);
  return {
    buffer,
    contentType: ext === 'svg' ? 'image/svg+xml' : 'image/png',
    cached: false,
  };
}

function landingUrl(slug) {
  const host = config.publicHost.replace(/\/+$/, '');
  return `${host}/c/${slug}`;
}

module.exports = { generate, landingUrl, normalizeOpts };
