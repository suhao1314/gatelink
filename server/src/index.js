'use strict';

const httpServer = require('http');
const { config, ensureDirs } = require('./config');
const { getDb } = require('./db');
const { dispatch } = require('./routes');
const response = require('./http');
const { safeLogTarget } = require('./util');

ensureDirs();
getDb();

function logLine(level, msg, extra) {
  if (config.nodeEnv === 'test') return;
  const ts = new Date().toISOString();
  const tail = extra ? ` ${extra}` : '';
  console.log(`${ts} [${level}] ${msg}${tail}`);
}

const server = httpServer.createServer((req, res) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    if (config.nodeEnv !== 'test') {
      logLine('REQ', `${req.method} ${safeLogTarget(req.url)} -> ${res.statusCode}`, `${ms}ms`);
    }
  });

  if (!response.isOriginAllowed(req.headers.origin)) return response.forbidden(res);
  if (req.method === 'OPTIONS') return response.handleOptions(res);

  let u;
  try {
    u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: { message: '请求地址不正确' } }));
  }

  Promise.resolve()
    .then(() => dispatch(req, res, u))
    .catch((err) => {
      logLine('ERR', `${req.method} ${safeLogTarget(req.url)}`, 'Request failed');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: { message: '服务暂时不可用', code: 'SERVER_ERROR' } }));
      } else {
        try { res.end(); } catch (e) { /* noop */ }
      }
    });
});

function start() {
  return new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      logLine('INFO', `GateLink server listening on ${config.host}:${config.port}`);
      logLine('INFO', `env=${config.nodeEnv} devMode=${config.devMode} publicHost=${config.publicHost}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { start, server };
