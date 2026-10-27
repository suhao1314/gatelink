'use strict';

const { getDb } = require('./db');
const { nowSec, dayStr } = require('./util');

function resolveRange(key) {
  switch (key) {
    case 'today': return { days: 1, key: 'today', label: '今日' };
    case '30d': return { days: 30, key: '30d', label: '近 30 天' };
    case '90d': return { days: 90, key: '90d', label: '近 90 天' };
    default: return { days: 7, key: '7d', label: '近 7 天' };
  }
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function buildTrend(campaignId, days, now) {
  const startDay = dayStr(now - (days - 1) * 86400);
  const rows = getDb().prepare(
    'SELECT day, visits, uniques FROM daily_stats WHERE campaign_id = ? AND day >= ? ORDER BY day ASC'
  ).all(campaignId, startDay);

  const map = new Map();
  for (const r of rows) map.set(r.day, r);

  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const ts = now - i * 86400;
    const d = dayStr(ts);
    const r = map.get(d) || { visits: 0, uniques: 0 };
    trend.push({
      day: d,
      label: days === 1 ? `${String(Math.floor(ts % 86400 / 3600 + 8) % 24)}时` : d.slice(5),
      visits: r.visits,
      uniques: r.uniques,
    });
  }
  return trend;
}

function buildStats(campaignId, rangeKey) {
  const db = getDb();
  const range = resolveRange(rangeKey);
  const now = nowSec();
  const trend = buildTrend(campaignId, range.days, now);

  const visits = trend.reduce((a, b) => a + b.visits, 0);
  const uniques = trend.reduce((a, b) => a + b.uniques, 0);

  const todayStr = dayStr(now);
  const todayRow = trend.length ? trend[trend.length - 1] : { visits: 0, uniques: 0 };
  const yRow = db.prepare(
    'SELECT COALESCE(SUM(visits), 0) AS v, COALESCE(SUM(uniques), 0) AS u FROM daily_stats WHERE campaign_id = ? AND day = ?'
  ).get(campaignId, dayStr(now - 86400));

  const deltaBase = range.key === 'today' ? (yRow ? yRow.v : 0) : Math.round(visits / Math.max(1, range.days));
  const deltaPct = deltaBase > 0 ? Math.round(((todayRow.visits - deltaBase) / deltaBase) * 1000) / 10 : 0;

  const startDay = range.days === 1 ? todayStr : dayStr(now - (range.days - 1) * 86400);

  const hourlyRaw = db.prepare(
    'SELECT hour, COUNT(*) AS c FROM visits WHERE campaign_id = ? AND day >= ? GROUP BY hour'
  ).all(campaignId, startDay);
  const hourly = [];
  for (let h = 0; h < 24; h++) hourly.push({ hour: h, visits: 0 });
  for (const r of hourlyRaw) {
    if (r.hour >= 0 && r.hour < 24) hourly[r.hour].visits = r.c;
  }

  const sourceRaw = db.prepare(
    'SELECT source, COUNT(*) AS c FROM visits WHERE campaign_id = ? AND day >= ? GROUP BY source ORDER BY c DESC LIMIT 50'
  ).all(campaignId, startDay);
  const sources = sourceRaw.map((r) => ({
    key: r.source || '',
    label: r.source || '直接扫码',
    visits: r.c,
    pct: pct(r.c, visits),
  }));

  const chanRaw = db.prepare(`
    SELECT v.channel_id AS cid, COUNT(*) AS c
    FROM visits v
    WHERE v.campaign_id = ? AND v.day >= ?
    GROUP BY v.channel_id
    ORDER BY c DESC
  `).all(campaignId, startDay);
  const chanMap = new Map();
  for (const c of db.prepare('SELECT * FROM channels WHERE campaign_id = ?').all(campaignId)) {
    chanMap.set(c.id, c);
  }
  const totalChanVisits = chanRaw.reduce((a, b) => a + b.c, 0);
  const channels = chanRaw.map((r) => {
    const c = chanMap.get(r.cid);
    return {
      id: r.cid,
      name: c ? c.name : '已删除的子码',
      status: c ? c.status : 'removed',
      quota: c ? c.quota : 0,
      served: c ? c.served_count : 0,
      views: r.c,
      pct: pct(r.c, totalChanVisits),
    };
  });

  const osRaw = db.prepare(
    'SELECT os, COUNT(*) AS c FROM visits WHERE campaign_id = ? AND day >= ? GROUP BY os'
  ).all(campaignId, startDay);
  const os = osRaw.map((r) => ({
    key: r.os,
    label: r.os === 'ios' ? 'iPhone' : (r.os === 'android' ? 'Android' : '其他'),
    visits: r.c,
    pct: pct(r.c, visits),
  })).sort((a, b) => b.visits - a.visits);

  return {
    range: { key: range.key, label: range.label, days: range.days, startDay },
    overview: {
      visits,
      uniques,
      today: todayRow.visits,
      todayUniques: todayRow.uniques,
      yesterday: yRow ? yRow.v : 0,
      deltaPct,
      avgPerDay: range.days > 0 ? Math.round((visits / range.days) * 10) / 10 : 0,
    },
    trend,
    hourly,
    sources,
    channels,
    os,
  };
}

// 列表页预警：优先返回最需要处理的一条
function buildAlerts(campaignIds) {
  const map = new Map();
  if (!campaignIds || !campaignIds.length) return map;

  const db = getDb();
  const ph = campaignIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT campaign_id, quota, served_count, expires_at, status FROM channels WHERE campaign_id IN (${ph})`
  ).all(...campaignIds);

  const now = nowSec();
  const per = new Map();
  for (const id of campaignIds) per.set(id, { usable: 0, expiring: 0, quotaNear: 0 });

  for (const r of rows) {
    const s = per.get(r.campaign_id);
    if (!s) continue;
    const alive = r.status === 'active'
      && (r.quota === 0 || r.served_count < r.quota)
      && (r.expires_at === 0 || r.expires_at > now);
    if (alive) s.usable += 1;
    if (r.status === 'active' && r.expires_at > 0 && r.expires_at - now < 3 * 86400) s.expiring += 1;
    if (r.status === 'active' && r.quota > 0 && r.served_count >= Math.floor(r.quota * 0.9)) s.quotaNear += 1;
  }

  for (const [id, s] of per.entries()) {
    if (s.usable === 0) map.set(id, { level: 'danger', text: '没有可用二维码' });
    else if (s.expiring > 0) map.set(id, { level: 'warn', text: '有二维码即将过期' });
    else if (s.quotaNear > 0) map.set(id, { level: 'warn', text: '有名额即将用满' });
  }
  return map;
}

function todayCountMap(userId) {
  const db = getDb();
  const day = dayStr(nowSec());
  const rows = db.prepare(`
    SELECT campaign_id AS id, COALESCE(SUM(visits), 0) AS today, COALESCE(SUM(uniques), 0) AS todayUnique
    FROM daily_stats WHERE day = ? GROUP BY campaign_id
  `).all(day);
  const map = new Map();
  for (const r of rows) map.set(r.id, r);
  return map;
}

module.exports = { buildStats, resolveRange, todayCountMap, buildAlerts, pct };
