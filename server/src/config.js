'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

function env(k, d) {
  const v = process.env[k];
  return v === undefined || v === '' ? d : v;
}

const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  port: parseInt(env('PORT', '8787'), 10),
  host: env('HOST', '0.0.0.0'),

  dataDir: env('DATA_DIR', path.join(ROOT, 'data')),
  uploadDir: env('UPLOAD_DIR', path.join(ROOT, 'data', 'uploads')),
  qrDir: env('QR_DIR', path.join(ROOT, 'data', 'qr')),
  dbFile: env('DB_FILE', path.join(ROOT, 'data', 'gatelink.db')),

  // 对外域名：二维码内容与分享链接都基于它生成，必须是已备案的 HTTPS 域名
  publicHost: env('PUBLIC_HOST', 'https://gate.example.com'),
  staticBase: env('STATIC_BASE', '/static'),

  wxAppId: env('WX_APPID', ''),
  wxSecret: env('WX_SECRET', ''),

  tokenSecret: env('TOKEN_SECRET', 'gatelink-local-dev-secret'),
  visitorSalt: env('VISITOR_SALT', 'gatelink-visitor-salt'),
  tokenTTL: parseInt(env('TOKEN_TTL', '2592000'), 10),

  maxUploadBytes: parseInt(env('MAX_UPLOAD_BYTES', '5242880'), 10),
  maxImageBytes: parseInt(env('MAX_IMAGE_BYTES', '3145728'), 10),

  allowedOrigins: env('ALLOWED_ORIGINS', '*'),
};

config.devMode = config.wxAppId === '';

function ensureDirs() {
  for (const d of [config.dataDir, config.uploadDir, config.qrDir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

module.exports = { config, ensureDirs, ROOT };
