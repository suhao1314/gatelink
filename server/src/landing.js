'use strict';

const { getDb } = require('./db');
const { config } = require('./config');
const { uid, nowSec, dayStr, hourOf, visitorHash } = require('./util');

const STRATEGIES = ['round_robin', 'random', 'quota'];
const STATUS_ACTIVE = 'active';

function staticUrl(name) {
  if (!name) return '';
  return `${config.staticBase}/uploads/${name}`;
}

function publicCampaign(slug) {
  return getDb().prepare('SELECT * FROM campaigns WHERE slug = ? AND deleted = 0').get(slug) || null;
}

function availableChannels(campaignId) {
  const now = nowSec();
  return getDb().prepare(`
    SELECT * FROM channels
    WHERE campaign_id = ?
      AND status = '${STATUS_ACTIVE}'
      AND (quota = 0 OR served_count < quota)
      AND (expires_at = 0 OR expires_at > ?)
    ORDER BY sort_order ASC, created_at ASC
  `).all(campaignId, now);
}

function pickChannel(campaign) {
  const rows = availableChannels(campaign.id);
  if (rows.length === 0) return { channel: null, fallback: true };

  let chosen;
  if (campaign.strategy === 'random') {
    chosen = rows[Math.floor(Math.random() * rows.length)];
  } else if (campaign.strategy === 'quota') {
    chosen = rows[0];
  } else {
    chosen = rows.reduce((min, r) => (r.served_count < min.served_count ? r : min), rows[0]);
  }
  return { channel: chosen, fallback: false };
}

function resolveFallback(campaign) {
  if (!campaign.fallback_id) return null;
  return getDb().prepare(
    `SELECT * FROM channels WHERE id = ? AND campaign_id = ? AND status = '${STATUS_ACTIVE}'`
  ).get(campaign.fallback_id, campaign.id) || null;
}

function detectOs(ua) {
  const s = String(ua || '');
  if (/iphone|ipad|ipod|ios/i.test(s)) return 'ios';
  if (/android/i.test(s)) return 'android';
  return 'other';
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '0.0.0.0';
}

function recordVisit(campaignId, channelId, req, source) {
  const db = getDb();
  const now = nowSec();
  const day = dayStr(now);
  const ua = String(req.headers['user-agent'] || '');
  const vh = visitorHash(clientIp(req), ua, config.visitorSalt);
  const os = detectOs(ua);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO visits (id, campaign_id, channel_id, visitor_hash, source, day, hour, os, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uid('v'), campaignId, channelId || '', vh, source || '', day, hourOf(now), os, now);

    db.prepare('INSERT OR IGNORE INTO daily_stats (campaign_id, day, visits, uniques) VALUES (?, ?, 0, 0)')
      .run(campaignId, day);
    db.prepare('UPDATE daily_stats SET visits = visits + 1 WHERE campaign_id = ? AND day = ?')
      .run(campaignId, day);

    const seen = db.prepare(
      'SELECT COUNT(*) AS c FROM visits WHERE campaign_id = ? AND visitor_hash = ? AND day = ?'
    ).get(campaignId, vh, day);
    if (seen && seen.c <= 1) {
      db.prepare('UPDATE daily_stats SET uniques = uniques + 1 WHERE campaign_id = ? AND day = ?')
        .run(campaignId, day);
    }

    if (channelId) {
      db.prepare('UPDATE channels SET display_count = display_count + 1, served_count = served_count + 1 WHERE id = ?')
        .run(channelId);
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* noop */ }
    throw e;
  }
  return { visitorHash: vh, day };
}

function channelPublic(c) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    imageUrl: staticUrl(c.image_path),
  };
}

function buildLandingPayload(campaign, preheaded) {
  const base = {
    slug: campaign.slug,
    type: campaign.type,
    pageTitle: campaign.page_title || campaign.name,
    headline: campaign.headline,
    subtitle: campaign.subtitle,
    bodyText: campaign.body_text,
    hintText: campaign.hint_text,
    themeColor: campaign.theme_color,
    coverUrl: campaign.cover_path ? staticUrl(campaign.cover_path) : '',
    updatedAt: campaign.updated_at,
  };
  return Object.assign(base, preheaded);
}

module.exports = {
  STRATEGIES,
  staticUrl,
  publicCampaign,
  pickChannel,
  resolveFallback,
  recordVisit,
  channelPublic,
  buildLandingPayload,
  availableChannels,
  clientIp,
  detectOs,
};
