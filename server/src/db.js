'use strict';

const { DatabaseSync } = require('node:sqlite');
const { config, ensureDirs } = require('./config');

let _db = null;

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  openid        TEXT UNIQUE NOT NULL,
  nickname      TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT 0,
  last_login_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS campaigns (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  type        TEXT NOT NULL DEFAULT 'personal',
  name        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active',
  strategy    TEXT NOT NULL DEFAULT 'round_robin',
  fallback_id TEXT NOT NULL DEFAULT '',
  page_title  TEXT NOT NULL DEFAULT '',
  headline    TEXT NOT NULL DEFAULT '',
  subtitle    TEXT NOT NULL DEFAULT '',
  body_text   TEXT NOT NULL DEFAULT '',
  hint_text   TEXT NOT NULL DEFAULT '',
  theme_color TEXT NOT NULL DEFAULT '#007AFF',
  cover_path  TEXT NOT NULL DEFAULT '',
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS channels (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  image_path    TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  weight        INTEGER NOT NULL DEFAULT 1,
  quota         INTEGER NOT NULL DEFAULT 0,
  served_count  INTEGER NOT NULL DEFAULT 0,
  display_count INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  expires_at    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visits (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL,
  channel_id   TEXT NOT NULL DEFAULT '',
  visitor_hash TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT '',
  day          TEXT NOT NULL,
  hour         INTEGER NOT NULL DEFAULT 0,
  os           TEXT NOT NULL DEFAULT 'other',
  created_at   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_stats (
  campaign_id TEXT NOT NULL,
  day         TEXT NOT NULL,
  visits      INTEGER NOT NULL DEFAULT 0,
  uniques     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, day)
);

CREATE TABLE IF NOT EXISTS share_links (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  token       TEXT UNIQUE NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'full',
  expires_at  INTEGER NOT NULL DEFAULT 0,
  view_count  INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_campaigns_owner   ON campaigns(owner_id, deleted);
CREATE INDEX IF NOT EXISTS idx_campaigns_slug    ON campaigns(slug);
CREATE INDEX IF NOT EXISTS idx_channels_campaign ON channels(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_visits_campaign   ON visits(campaign_id, day);
CREATE INDEX IF NOT EXISTS idx_visits_day        ON visits(day);
CREATE INDEX IF NOT EXISTS idx_visits_unique     ON visits(campaign_id, visitor_hash, day);
CREATE INDEX IF NOT EXISTS idx_share_campaign    ON share_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_share_token       ON share_links(token);
`;

function getDb() {
  if (_db) return _db;
  ensureDirs();
  _db = new DatabaseSync(config.dbFile);
  try {
    _db.exec('PRAGMA journal_mode = WAL');
  } catch (e) {
    // 某些环境只读，忽略即可
  }
  _db.exec('PRAGMA foreign_keys = ON');
  _db.exec(SCHEMA);
  setMeta('schema_version', String(SCHEMA_VERSION));
  return _db;
}

function setMeta(k, v) {
  const db = getDbRaw();
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(k, v);
}

function getMetaRaw(k) {
  const db = getDbRaw();
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(k);
  return row ? row.value : null;
}

function getDbRaw() {
  if (!_db) throw new Error('database not initialized');
  return _db;
}

function resetDb() {
  const db = getDb();
  for (const t of ['visits', 'daily_stats', 'share_links', 'channels', 'campaigns', 'users', 'meta']) {
    db.exec(`DELETE FROM ${t}`);
  }
  return true;
}

function closeDb() {
  if (_db) {
    try { _db.close(); } catch (e) { /* noop */ }
    _db = null;
  }
}

module.exports = { getDb, closeDb, resetDb, SCHEMA_VERSION };
