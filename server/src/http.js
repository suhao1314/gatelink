'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('./config');

function setCors(res) {
  if (config.allowedOrigins === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', config.allowedOrigins);
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
}

function sendJson(res, status, payload, headers) {
  const body = JSON.stringify(payload);
  setCors(res);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }, headers || {}));
  res.end(body);
}

function ok(res, data) {
  sendJson(res, 200, { ok: true, data: data === undefined ? null : data });
}

function fail(res, status, message, code) {
  sendJson(res, status, { ok: false, error: { message, code: code || 'ERROR' } }, { 'Cache-Control': 'no-store' });
}

function badRequest(res, message, code) {
  fail(res, 400, message || '请求参数不正确', code || 'BAD_REQUEST');
}

function unauthorized(res, message) {
  fail(res, 401, message || '请先登录', 'UNAUTHORIZED');
}

function notFound(res, message) {
  fail(res, 404, message || '没有找到这个内容', 'NOT_FOUND');
}

function forbidden(res, message) {
  fail(res, 403, message || '没有权限执行这个操作', 'FORBIDDEN');
}

function serverError(res, err) {
  fail(res, 500, err && err.message ? err.message : '服务暂时不可用', 'SERVER_ERROR');
}

function sendBuffer(res, buffer, contentType, extra) {
  setCors(res);
  res.writeHead(200, Object.assign({
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'public, max-age=86400',
  }, extra || {}));
  res.end(buffer);
}

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function serveFile(res, absPath, downloadName) {
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return notFound(res, '文件不存在');
  }
  const ext = path.extname(absPath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(absPath);
  setCors(res);
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=86400',
  };
  if (downloadName) {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  }
  res.writeHead(200, headers);
  const stream = fs.createReadStream(absPath);
  stream.on('error', () => { try { res.end(); } catch (e) { /* noop */ } });
  stream.pipe(res);
}

function serveStatic(res, baseDir, relName) {
  const safeName = path.basename(relName);
  const abs = path.join(baseDir, safeName);
  if (!abs.startsWith(path.resolve(baseDir))) return notFound(res);
  return serveFile(res, abs);
}

function sendHtml(res, html, status) {
  const buf = Buffer.from(html, 'utf8');
  setCors(res);
  res.writeHead(status || 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

function handleOptions(res) {
  setCors(res);
  res.writeHead(204);
  res.end();
}

module.exports = {
  ok, fail, badRequest, unauthorized, notFound, forbidden, serverError,
  sendJson, sendBuffer, serveFile, serveStatic, sendHtml, handleOptions, setCors,
};
