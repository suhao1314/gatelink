'use strict';

const { getDb } = require('./db');
const { config } = require('./config');
const http = require('./http');
const auth = require('./auth');
const qr = require('./qr');
const { staticUrl, STRATEGIES } = require('./landing');
const { buildStats, todayCountMap, buildAlerts } = require('./stats');
const { parseMultipart, saveImage, removeUpload } = require('./upload');
const {
  parseJsonBody, uid, nowSec, pickText, randomStr, isHexColor, toInt, toIntClamped,
} = require('./util');

const CAMPAIGN_STATUS = ['active', 'paused'];
const CHANNEL_STATUS = ['active', 'paused'];
const CAMPAIGN_TYPES = ['personal', 'group'];

function db() {
  return getDb();
}

function ensureSlug() {
  for (let i = 0; i < 12; i++) {
    const s = randomStr(8);
    const hit = db().prepare('SELECT 1 FROM campaigns WHERE slug = ?').get(s);
    if (!hit) return s;
  }
  return randomStr(12);
}

function loadCampaign(id) {
  return db().prepare('SELECT * FROM campaigns WHERE id = ? AND deleted = 0').get(id) || null;
}

function loadChannels(cid) {
  return db().prepare(
    'SELECT * FROM channels WHERE campaign_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(cid);
}

function campaignPublic(c, opts) {
  const o = opts || {};
  return {
    id: c.id,
    slug: c.slug,
    type: c.type,
    name: c.name,
    status: c.status,
    strategy: c.strategy,
    fallbackId: c.fallback_id,
    pageTitle: c.page_title,
    headline: c.headline,
    subtitle: c.subtitle,
    bodyText: c.body_text,
    hintText: c.hint_text,
    themeColor: c.theme_color,
    coverUrl: c.cover_path ? staticUrl(c.cover_path) : '',
    landingUrl: qr.landingUrl(c.slug),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    today: o.today || { visits: 0, uniques: 0 },
    channelCount: o.channelCount === undefined ? 0 : o.channelCount,
    alert: o.alert || null,
    channels: o.channels,
  };
}

function channelPublic(c) {
  return {
    id: c.id,
    name: c.name,
    imageUrl: staticUrl(c.image_path),
    sortOrder: c.sort_order,
    weight: c.weight,
    quota: c.quota,
    servedCount: c.served_count,
    displayCount: c.display_count,
    status: c.status,
    expiresAt: c.expires_at,
    createdAt: c.created_at,
  };
}

function assertOwner(req, res, campaign) {
  const user = auth.requireUser(req);
  if (!user) return { error: 'unauthorized' };
  if (!campaign) return { error: 'notfound' };
  if (campaign.owner_id !== user.id) return { error: 'forbidden' };
  return { user };
}

// ---------- 登录 ----------

async function handleLogin(req, res) {
  try {
    const body = await parseJsonBody(req, 8192);
    const { user, dev } = await auth.login(body.code);
    http.ok(res, {
      token: auth.signToken({ uid: user.id }),
      user: auth.publicUser(user),
      devMode: dev,
      expiresIn: config.tokenTTL,
    });
  } catch (e) {
    http.badRequest(res, e.message, 'LOGIN_FAILED');
  }
}

function handleMe(req, res) {
  const user = auth.requireUser(req);
  if (!user) return http.unauthorized(res);
  const total = db().prepare('SELECT COUNT(*) AS c FROM campaigns WHERE owner_id = ? AND deleted = 0').get(user.id);
  http.ok(res, {
    user: auth.publicUser(user),
    campaignCount: total ? total.c : 0,
    devMode: config.devMode,
  });
}

// ---------- 活码 ----------

function handleListCampaigns(req, res) {
  const user = auth.requireUser(req);
  if (!user) return http.unauthorized(res);
  const today = todayCountMap(user.id);
  const rows = db().prepare(
    'SELECT * FROM campaigns WHERE owner_id = ? AND deleted = 0 ORDER BY updated_at DESC, created_at DESC'
  ).all(user.id);

  const counts = db().prepare(
    'SELECT campaign_id AS id, COUNT(*) AS c FROM channels WHERE campaign_id IN (SELECT id FROM campaigns WHERE owner_id = ? AND deleted = 0) GROUP BY campaign_id'
  ).all(user.id);
  const countMap = new Map(counts.map((r) => [r.id, r.c]));

  const alerts = buildAlerts(rows.map((c) => c.id));
  http.ok(res, {
    items: rows.map((c) => campaignPublic(c, {
      today: today.get(c.id) || { visits: 0, uniques: 0 },
      channelCount: countMap.get(c.id) || 0,
      alert: alerts.get(c.id) || null,
    })),
  });
}

async function handleCreateCampaign(req, res) {
  const user = auth.requireUser(req);
  if (!user) return http.unauthorized(res);
  let body;
  try {
    body = await parseJsonBody(req, 8192);
  } catch (e) {
    return http.badRequest(res, '请求格式不正确');
  }
  const name = pickText(body.name, 40);
  if (!name) return http.badRequest(res, '请填写活码名称', 'NAME_REQUIRED');
  const type = CAMPAIGN_TYPES.indexOf(body.type) >= 0 ? body.type : 'personal';
  const strategy = STRATEGIES.indexOf(body.strategy) >= 0 ? body.strategy : 'round_robin';

  const now = nowSec();
  const id = uid('c');
  db().prepare(`
    INSERT INTO campaigns (id, owner_id, slug, type, name, status, strategy, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, user.id, ensureSlug(), type, name, strategy, now, now);

  const c = loadCampaign(id);
  http.ok(res, { campaign: campaignPublic(c, { today: { visits: 0, uniques: 0 }, channelCount: 0, channels: [] }) });
}

function handleGetCampaign(req, res, params) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  const chans = loadChannels(c.id);
  const today = todayCountMap(guard.user.id);
  http.ok(res, {
    campaign: campaignPublic(c, {
      today: today.get(c.id) || { visits: 0, uniques: 0 },
      channelCount: chans.length,
      channels: chans.map(channelPublic),
    }),
  });
}

async function handleUpdateCampaign(req, res, params) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  let body;
  try {
    body = await parseJsonBody(req, 16384);
  } catch (e) {
    return http.badRequest(res, '请求格式不正确');
  }

  const sets = [];
  const args = [];
  const put = (k, v) => { sets.push(`${k} = ?`); args.push(v); };

  if (body.name !== undefined) {
    const v = pickText(body.name, 40);
    if (!v) return http.badRequest(res, '名称不能为空');
    put('name', v);
  }
  if (body.type !== undefined && CAMPAIGN_TYPES.indexOf(body.type) >= 0) put('type', body.type);
  if (body.status !== undefined && CAMPAIGN_STATUS.indexOf(body.status) >= 0) put('status', body.status);
  if (body.strategy !== undefined && STRATEGIES.indexOf(body.strategy) >= 0) put('strategy', body.strategy);
  if (body.pageTitle !== undefined) put('page_title', pickText(body.pageTitle, 30));
  if (body.headline !== undefined) put('headline', pickText(body.headline, 40));
  if (body.subtitle !== undefined) put('subtitle', pickText(body.subtitle, 60));
  if (body.bodyText !== undefined) put('body_text', pickText(body.bodyText, 500));
  if (body.hintText !== undefined) put('hint_text', pickText(body.hintText, 40));
  if (body.themeColor !== undefined) {
    if (!isHexColor(body.themeColor)) return http.badRequest(res, '主题色格式不正确');
    put('theme_color', body.themeColor);
  }
  if (body.fallbackId !== undefined) {
    if (body.fallbackId === '') {
      put('fallback_id', '');
    } else {
      const ch = db().prepare('SELECT * FROM channels WHERE id = ? AND campaign_id = ?').get(body.fallbackId, c.id);
      if (!ch) return http.badRequest(res, '兜底子码不存在');
      put('fallback_id', ch.id);
    }
  }

  if (sets.length === 0) return http.badRequest(res, '没有需要更新的内容');
  sets.push('updated_at = ?');
  args.push(nowSec());
  args.push(c.id);
  db().prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  const fresh = loadCampaign(c.id);
  http.ok(res, { campaign: campaignPublic(fresh, { channels: loadChannels(c.id).map(channelPublic), channelCount: loadChannels(c.id).length }) });
}

function handleDeleteCampaign(req, res, params) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  const now = nowSec();
  db().exec('BEGIN IMMEDIATE');
  try {
    db().prepare('UPDATE campaigns SET deleted = 1, updated_at = ? WHERE id = ?').run(now, c.id);
    db().prepare('DELETE FROM channels WHERE campaign_id = ?').run(c.id);
    db().prepare('UPDATE share_links SET enabled = 0 WHERE campaign_id = ?').run(c.id);
    db().exec('COMMIT');
  } catch (e) {
    try { db().exec('ROLLBACK'); } catch (e2) { /* noop */ }
    return http.serverError(res, e);
  }
  http.ok(res, { deleted: true });
}

function handleDuplicateCampaign(req, res, params) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  const now = nowSec();
  const newId = uid('c');
  db().exec('BEGIN IMMEDIATE');
  try {
    db().prepare(`
      INSERT INTO campaigns (id, owner_id, slug, type, name, status, strategy, fallback_id,
        page_title, headline, subtitle, body_text, hint_text, theme_color, cover_path, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,'',?,?,?,?,?,?,?,?,?)
    `).run(
      newId, guard.user.id, ensureSlug(), c.type, `${c.name} 副本`, 'paused', c.strategy,
      c.page_title, c.headline, c.subtitle, c.body_text, c.hint_text, c.theme_color, c.cover_path, now, now
    );
    for (const ch of loadChannels(c.id)) {
      db().prepare(`
        INSERT INTO channels (id, campaign_id, name, image_path, sort_order, weight, quota, status, expires_at, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(uid('ch'), newId, ch.name, ch.image_path, ch.sort_order, ch.weight, ch.quota, ch.status, ch.expires_at, now);
    }
    db().exec('COMMIT');
  } catch (e) {
    try { db().exec('ROLLBACK'); } catch (e2) { /* noop */ }
    return http.serverError(res, e);
  }
  const fresh = loadCampaign(newId);
  http.ok(res, { campaign: campaignPublic(fresh, { channels: loadChannels(newId).map(channelPublic), channelCount: loadChannels(newId).length }) });
}

// ---------- 子码 ----------

async function handleAddChannel(req, res, params) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  let parsed;
  try {
    parsed = await parseMultipart(req);
  } catch (e) {
    return http.badRequest(res, e.message, (e.code || 'UPLOAD_FAILED'));
  }
  const file = parsed.files[0];
  let saved;
  try {
    saved = saveImage(file, config.maxImageBytes);
  } catch (e) {
    return http.badRequest(res, e.message, e.code || 'UPLOAD_FAILED');
  }

  const kind = parsed.fields.kind === 'cover' ? 'cover' : 'code';
  const now = nowSec();

  if (kind === 'cover') {
    const old = c.cover_path;
    db().prepare('UPDATE campaigns SET cover_path = ?, updated_at = ? WHERE id = ?').run(saved.storedName, now, c.id);
    if (old && old !== saved.storedName) removeUpload(old);
    const fresh = loadCampaign(c.id);
    return http.ok(res, { kind: 'cover', campaign: campaignPublic(fresh, { channels: loadChannels(c.id).map(channelPublic), channelCount: loadChannels(c.id).length }) });
  }

  const maxOrder = db().prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM channels WHERE campaign_id = ?').get(c.id);
  const name = pickText(parsed.fields.name, 30) || `子码 ${(maxOrder ? maxOrder.m : 0) + 1}`;
  const quota = toIntClamped(parsed.fields.quota, 0, 0, 1000000);
  const id = uid('ch');

  db().prepare(`
    INSERT INTO channels (id, campaign_id, name, image_path, sort_order, weight, quota, status, expires_at, created_at)
    VALUES (?,?,?,?,?,?,?,'active',?,?)
  `).run(id, c.id, name, saved.storedName, (maxOrder ? maxOrder.m : 0) + 1, 1, quota, 0, now);
  db().prepare('UPDATE campaigns SET updated_at = ? WHERE id = ?').run(now, c.id);

  if (!c.fallback_id) {
    db().prepare('UPDATE campaigns SET fallback_id = ? WHERE id = ?').run(id, c.id);
  }

  const row = db().prepare('SELECT * FROM channels WHERE id = ?').get(id);
  http.ok(res, { kind: 'code', channel: channelPublic(row) });
}

async function handleReplaceChannelImage(req, res, params) {
  const ch = db().prepare('SELECT * FROM channels WHERE id = ?').get(params.id);
  if (!ch) return http.notFound(res, '子码不存在');
  const c = loadCampaign(ch.campaign_id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  let parsed;
  try {
    parsed = await parseMultipart(req);
  } catch (e) {
    return http.badRequest(res, e.message, e.code || 'UPLOAD_FAILED');
  }
  let saved;
  try {
    saved = saveImage(parsed.files[0], config.maxImageBytes);
  } catch (e) {
    return http.badRequest(res, e.message, e.code || 'UPLOAD_FAILED');
  }

  const old = ch.image_path;
  db().prepare('UPDATE channels SET image_path = ? WHERE id = ?').run(saved.storedName, ch.id);
  db().prepare('UPDATE campaigns SET updated_at = ? WHERE id = ?').run(nowSec(), c.id);
  if (old) removeUpload(old);

  const row = db().prepare('SELECT * FROM channels WHERE id = ?').get(ch.id);
  http.ok(res, { channel: channelPublic(row) });
}

async function handleUpdateChannel(req, res, params) {
  const ch = db().prepare('SELECT * FROM channels WHERE id = ?').get(params.id);
  if (!ch) return http.notFound(res, '子码不存在');
  const c = loadCampaign(ch.campaign_id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  let body;
  try {
    body = await parseJsonBody(req, 8192);
  } catch (e) {
    return http.badRequest(res, '请求格式不正确');
  }

  const sets = [];
  const args = [];
  const put = (k, v) => { sets.push(`${k} = ?`); args.push(v); };

  if (body.name !== undefined) {
    const v = pickText(body.name, 30);
    if (!v) return http.badRequest(res, '名称不能为空');
    put('name', v);
  }
  if (body.status !== undefined && CHANNEL_STATUS.indexOf(body.status) >= 0) put('status', body.status);
  if (body.quota !== undefined) put('quota', toIntClamped(body.quota, 0, 0, 1000000));
  if (body.weight !== undefined) put('weight', toIntClamped(body.weight, 1, 1, 1000));
  if (body.sortOrder !== undefined) put('sort_order', toIntClamped(body.sortOrder, 0, 0, 100000));
  if (body.expiresAt !== undefined) put('expires_at', toIntClamped(body.expiresAt, 0, 0, 4102444800));
  if (body.servedCount !== undefined) put('served_count', toIntClamped(body.servedCount, 0, 0, 100000000));

  if (sets.length === 0) return http.badRequest(res, '没有需要更新的内容');
  args.push(ch.id);
  db().prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  db().prepare('UPDATE campaigns SET updated_at = ? WHERE id = ?').run(nowSec(), ch.campaign_id);

  const row = db().prepare('SELECT * FROM channels WHERE id = ?').get(ch.id);
  http.ok(res, { channel: channelPublic(row) });
}

function handleDeleteChannel(req, res, params) {
  const ch = db().prepare('SELECT * FROM channels WHERE id = ?').get(params.id);
  if (!ch) return http.notFound(res, '子码不存在');
  const c = loadCampaign(ch.campaign_id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  db().exec('BEGIN IMMEDIATE');
  try {
    db().prepare('DELETE FROM channels WHERE id = ?').run(ch.id);
    if (c.fallback_id === ch.id) db().prepare('UPDATE campaigns SET fallback_id = \'\', updated_at = ? WHERE id = ?').run(nowSec(), c.id);
    db().prepare('UPDATE campaigns SET updated_at = ? WHERE id = ?').run(nowSec(), c.id);
    db().exec('COMMIT');
  } catch (e) {
    try { db().exec('ROLLBACK'); } catch (e2) { /* noop */ }
    return http.serverError(res, e);
  }
  removeUpload(ch.image_path);
  http.ok(res, { deleted: true });
}

async function handleReorderChannels(req, res, params) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  let body;
  try {
    body = await parseJsonBody(req, 16384);
  } catch (e) {
    return http.badRequest(res, '请求格式不正确');
  }
  if (!Array.isArray(body.ids)) return http.badRequest(res, 'ids 必须是数组');

  db().exec('BEGIN IMMEDIATE');
  try {
    const stmt = db().prepare('UPDATE channels SET sort_order = ? WHERE id = ? AND campaign_id = ?');
    body.ids.forEach((id, i) => { stmt.run(i + 1, String(id), c.id); });
    db().prepare('UPDATE campaigns SET updated_at = ? WHERE id = ?').run(nowSec(), c.id);
    db().exec('COMMIT');
  } catch (e) {
    try { db().exec('ROLLBACK'); } catch (e2) { /* noop */ }
    return http.serverError(res, e);
  }
  http.ok(res, { channels: loadChannels(c.id).map(channelPublic) });
}

// ---------- 二维码 ----------

async function handleQrcode(req, res, params, query) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  const format = query.format === 'svg' ? 'svg' : 'png';
  try {
    const out = await qr.generate(qr.landingUrl(c.slug), query, format);
    if (query.download === '1') {
      http.sendBuffer(res, out.buffer, out.contentType, {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${c.name}.${format}`)}`,
      });
      return;
    }
    http.sendBuffer(res, out.buffer, out.contentType);
  } catch (e) {
    http.serverError(res, new Error('二维码生成失败'));
  }
}

// ---------- 统计与分享 ----------

function handleStats(req, res, params, query) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);
  http.ok(res, buildStats(c.id, query.range));
}

async function handleCreateShare(req, res, params) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  let body = {};
  try {
    body = await parseJsonBody(req, 8192);
  } catch (e) {
    return http.badRequest(res, '请求格式不正确');
  }
  const scope = body.scope === 'summary' ? 'summary' : 'full';
  const ttl = toIntClamped(body.ttlDays, 0, 0, 3650);
  const token = randomStr(20);
  const now = nowSec();

  db().prepare(`
    INSERT INTO share_links (id, campaign_id, token, scope, expires_at, enabled, created_at)
    VALUES (?,?,?,?,?,1,?)
  `).run(uid('s'), c.id, token, scope, ttl === 0 ? 0 : now + ttl * 86400, now);

  http.ok(res, {
    token,
    scope,
    expiresAt: ttl === 0 ? 0 : now + ttl * 86400,
    url: `${config.publicHost.replace(/\/+$/, '')}/s/${token}`,
  });
}

function handleRevokeShare(req, res, params) {
  const user = auth.requireUser(req);
  if (!user) return http.unauthorized(res);
  const row = db().prepare('SELECT * FROM share_links WHERE token = ?').get(params.token);
  if (!row) return http.notFound(res, '分享链接不存在');
  const c = loadCampaign(row.campaign_id);
  if (!c || c.owner_id !== user.id) return http.forbidden(res);
  db().prepare('UPDATE share_links SET enabled = 0 WHERE token = ?').run(params.token);
  http.ok(res, { revoked: true });
}

function handleListShares(req, res, params) {
  const c = loadCampaign(params.id);
  const guard = assertOwner(req, res, c);
  if (guard.error === 'unauthorized') return http.unauthorized(res);
  if (guard.error === 'notfound') return http.notFound(res);
  if (guard.error === 'forbidden') return http.forbidden(res);

  const rows = db().prepare('SELECT * FROM share_links WHERE campaign_id = ? ORDER BY created_at DESC').all(c.id);
  http.ok(res, {
    items: rows.map((r) => ({
      token: r.token,
      scope: r.scope,
      enabled: !!r.enabled,
      expiresAt: r.expires_at,
      viewCount: r.view_count,
      createdAt: r.created_at,
      url: `${config.publicHost.replace(/\/+$/, '')}/s/${r.token}`,
    })),
  });
}

module.exports = {
  handleLogin, handleMe,
  handleListCampaigns, handleCreateCampaign, handleGetCampaign,
  handleUpdateCampaign, handleDeleteCampaign, handleDuplicateCampaign,
  handleAddChannel, handleUpdateChannel, handleDeleteChannel, handleReorderChannels,
  handleReplaceChannelImage,
  handleQrcode, handleStats, handleCreateShare, handleRevokeShare, handleListShares,
  loadCampaign, campaignPublic, channelPublic,
};
