'use strict';

const http = require('./http');
const { config } = require('./config');
const merchant = require('./handlers-merchant');
const pub = require('./handlers-public');

const ROUTES = [
  ['GET', /^\/api\/health$/, (req, res) => http.ok(res, { ok: true, env: config.nodeEnv, devMode: config.devMode })],

  ['POST', /^\/api\/auth\/login$/, merchant.handleLogin],
  ['GET', /^\/api\/me$/, merchant.handleMe],

  ['GET', /^\/api\/campaigns$/, merchant.handleListCampaigns],
  ['POST', /^\/api\/campaigns$/, merchant.handleCreateCampaign],
  ['GET', /^\/api\/campaigns\/([^/]+)$/, merchant.handleGetCampaign, ['id']],
  ['PATCH', /^\/api\/campaigns\/([^/]+)$/, merchant.handleUpdateCampaign, ['id']],
  ['DELETE', /^\/api\/campaigns\/([^/]+)$/, merchant.handleDeleteCampaign, ['id']],
  ['POST', /^\/api\/campaigns\/([^/]+)\/duplicate$/, merchant.handleDuplicateCampaign, ['id']],

  ['POST', /^\/api\/campaigns\/([^/]+)\/channels$/, merchant.handleAddChannel, ['id']],
  ['POST', /^\/api\/campaigns\/([^/]+)\/channels\/reorder$/, merchant.handleReorderChannels, ['id']],
  ['PATCH', /^\/api\/channels\/([^/]+)$/, merchant.handleUpdateChannel, ['id']],
  ['POST', /^\/api\/channels\/([^/]+)\/image$/, merchant.handleReplaceChannelImage, ['id']],
  ['DELETE', /^\/api\/channels\/([^/]+)$/, merchant.handleDeleteChannel, ['id']],

  ['GET', /^\/api\/campaigns\/([^/]+)\/qrcode$/, merchant.handleQrcode, ['id']],
  ['GET', /^\/api\/campaigns\/([^/]+)\/stats$/, merchant.handleStats, ['id']],
  ['POST', /^\/api\/campaigns\/([^/]+)\/share$/, merchant.handleCreateShare, ['id']],
  ['GET', /^\/api\/campaigns\/([^/]+)\/shares$/, merchant.handleListShares, ['id']],
  ['DELETE', /^\/api\/share\/([^/]+)$/, merchant.handleRevokeShare, ['token']],

  ['GET', /^\/api\/public\/landing\/([^/]+)$/, pub.handleLandingApi, ['slug']],
  ['GET', /^\/api\/public\/share\/([^/]+)$/, pub.handleShareApi, ['token']],
];

const PAGES = [
  [/^\/c\/([A-Za-z0-9_-]+)$/, pub.handleLandingPage, ['slug']],
  [/^\/s\/([A-Za-z0-9_-]+)$/, pub.handleSharePage, ['token']],
];

function toParams(match, keys) {
  const out = {};
  if (!keys) return out;
  keys.forEach((k, i) => { out[k] = decodeURIComponent(match[i + 1]); });
  return out;
}

function toQuery(u) {
  const q = {};
  for (const [k, v] of u.searchParams.entries()) q[k] = v;
  return q;
}

function dispatch(req, res, u) {
  const path = u.pathname;
  const method = req.method || 'GET';

  const prefix = config.staticBase.replace(/\/+$/, '');
  if (method === 'GET' && path.startsWith(prefix + '/uploads/')) {
    const name = path.slice((prefix + '/uploads/').length);
    return http.serveStatic(res, config.uploadDir, name);
  }
  if (method === 'GET' && path.startsWith(prefix + '/qr/')) {
    const name = path.slice((prefix + '/qr/').length);
    return http.serveStatic(res, config.qrDir, name);
  }

  if (method === 'GET') {
    for (const [re, handler, keys] of PAGES) {
      const m = re.exec(path);
      if (m) return handler(req, res, toParams(m, keys), toQuery(u));
    }
  }

  for (const [rmethod, re, handler, keys] of ROUTES) {
    if (rmethod !== method) continue;
    const m = re.exec(path);
    if (m) return handler(req, res, toParams(m, keys), toQuery(u));
  }

  if (path.startsWith('/api/')) {
    return http.fail(res, 404, '接口不存在', 'NO_ROUTE');
  }
  return http.fail(res, 404, '页面不存在', 'NOT_FOUND');
}

module.exports = { dispatch };
