'use strict';

const { getDb } = require('./db');
const http = require('./http');
const { staticUrl, publicCampaign, pickChannel, resolveFallback, recordVisit, channelPublic, buildLandingPayload } = require('./landing');
const { buildStats } = require('./stats');
const { config } = require('./config');
const { nowSec, pickText } = require('./util');

function db() {
  return getDb();
}

function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function resolveLanding(slug, req, source) {
  const c = publicCampaign(slug);
  if (!c) return { status: 'notfound' };

  if (c.status !== 'active') {
    const fb = resolveFallback(c);
    return {
      status: 'paused',
      campaign: c,
      payload: buildLandingPayload(c, {
        channel: fb ? channelPublic(fb) : null,
        fallbackUsed: !!fb,
      }),
    };
  }

  const picked = pickChannel(c);
  let channel = picked.channel;
  let fallbackUsed = false;
  if (!channel) {
    const fb = resolveFallback(c);
    channel = fb;
    fallbackUsed = !!fb;
  }

  recordVisit(c.id, channel ? channel.id : '', req, source);

  return {
    status: channel ? 'ok' : 'empty',
    campaign: c,
    payload: buildLandingPayload(c, {
      channel: channelPublic(channel),
      fallbackUsed,
    }),
  };
}

function handleLandingApi(req, res, params, query) {
  const source = pickText(query.scene || query.source, 40);
  const result = resolveLanding(params.slug, req, source);

  if (result.status === 'notfound') {
    return http.fail(res, 404, '这个入口已经失效了', 'CAMPAIGN_NOT_FOUND');
  }
  http.ok(res, Object.assign({ status: result.status }, result.payload));
}

function renderLandingHtml(result) {
  const p = result.payload;
  const title = escapeHtml(p.pageTitle || '扫码');
  const body = escapeHtml(p.bodyText || '');
  const headline = escapeHtml(p.headline || '');
  const subtitle = escapeHtml(p.subtitle || '');
  const img = result.status === 'ok' || result.status === 'paused'
    ? (p.channel && p.channel.imageUrl ? escapeHtml(p.channel.imageUrl) : '') : '';

  let tip;
  if (result.status === 'notfound') tip = '这个入口已经失效了';
  else if (result.status === 'empty') tip = '暂时无法为您提供对应的二维码，请稍后再试';
  else if (result.status === 'paused') tip = '这个入口已暂时关闭';
  else tip = escapeHtml(p.hintText || '长按识别二维码');

  let block;
  if (img) {
    block = `<div class="qr"><img src="${img}" alt="二维码"></div>`;
  } else {
    block = `<div class="qr qr-empty"><span>暂无可用二维码</span></div>`;
  }

  const theme = /^#[0-9a-fA-F]{6}$/.test(p.themeColor) ? p.themeColor : '#007AFF';

  const cover = p.coverUrl ? `<div class="cover"><img src="${escapeHtml(p.coverUrl)}" alt="封面"></div>` : '';
  const bodyBlock = body ? `<div class="body">${body.replace(/\n/g, '<br>')}</div>` : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="format-detection" content="telephone=no">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#F5F5F7;color:#1D1D1F;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Helvetica,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px 40px}
.card{width:100%;max-width:420px;background:#fff;border-radius:16px;padding:24px 20px 28px}
.cover{margin:-8px -4px 20px;border-radius:12px;overflow:hidden;line-height:0}
.cover img{width:100%;display:block}
h1{font-size:22px;font-weight:600;line-height:1.3;text-align:center;margin-bottom:6px}
.sub{font-size:13px;color:#6E6E73;text-align:center;margin-bottom:20px}
.qr{display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #E5E5EA;border-radius:16px;padding:18px}
.qr img{width:78%;max-width:280px;display:block;image-rendering:-webkit-optimize-contrast}
.qr-empty{height:220px;color:#8E8E93;font-size:14px}
.tip{text-align:center;font-size:13px;margin-top:16px}
.body{margin-top:22px;padding-top:18px;border-top:1px solid #E5E5EA;font-size:14px;line-height:1.65;color:#3A3A3C;white-space:normal;word-break:break-word}
</style>
</head>
<body>
<div class="wrap"><div class="card">
${cover}
${headline ? `<h1>${headline}</h1>` : ''}
${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
${block}
<div class="tip" style="color:${theme}">${tip}</div>
${bodyBlock}
</div></div>
</body>
</html>`;
}

function handleLandingPage(req, res, params, query) {
  const source = pickText(query.scene || query.source, 40);
  const result = resolveLanding(params.slug, req, source);
  if (result.status === 'notfound') {
    http.sendHtml(res, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>已失效</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#6E6E73;font-size:15px;background:#F5F5F7}</style></head><body>这个入口已经失效了</body></html>', 404);
    return;
  }
  http.sendHtml(res, renderLandingHtml(result));
}

function handleShareApi(req, res, params) {
  const row = db().prepare('SELECT * FROM share_links WHERE token = ? AND enabled = 1').get(params.token);
  if (!row) return http.fail(res, 404, '分享内容不存在或已关闭', 'SHARE_NOT_FOUND');
  if (row.expires_at && row.expires_at < nowSec()) {
    return http.fail(res, 410, '分享链接已过期', 'SHARE_EXPIRED');
  }
  const c = db().prepare('SELECT * FROM campaigns WHERE id = ? AND deleted = 0').get(row.campaign_id);
  if (!c) return http.fail(res, 404, '分享内容不存在', 'SHARE_NOT_FOUND');

  db().prepare('UPDATE share_links SET view_count = view_count + 1 WHERE token = ?').run(row.token);
  const stats = buildStats(c.id, '30d');

  http.ok(res, {
    campaign: { name: c.name, type: c.type, landingUrl: `${config.publicHost.replace(/\/+$/, '')}/c/${c.slug}` },
    share: {
      scope: row.scope,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      viewCount: row.view_count + 1,
    },
    stats: row.scope === 'summary'
      ? { range: stats.range, overview: stats.overview, trend: stats.trend }
      : stats,
  });
}

function handleSharePage(req, res, params, query) {
  const row = db().prepare('SELECT * FROM share_links WHERE token = ? AND enabled = 1').get(params.token);
  if (!row) {
    http.sendHtml(res, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>已失效</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#6E6E73;font-size:15px;background:#F5F5F7}</style></head><body>分享内容不存在或已关闭</body></html>', 404);
    return;
  }
  const c = db().prepare('SELECT * FROM campaigns WHERE id = ? AND deleted = 0').get(row.campaign_id);
  if (!c) {
    http.sendHtml(res, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>已失效</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#6E6E73;font-size:15px;background:#F5F5F7}</style></head><body>分享内容不存在</body></html>', 404);
    return;
  }

  db().prepare('UPDATE share_links SET view_count = view_count + 1 WHERE token = ?').run(row.token);
  const s = buildStats(c.id, '30d');
  const max = s.trend.reduce((m, t) => Math.max(m, t.visits), 0) || 1;
  const bars = s.trend.map((t) => {
    const h = Math.max(2, Math.round((t.visits / max) * 100));
    return `<div class="bar-wrap"><div class="bar" style="height:${h}%"></div><span class="lab">${escapeHtml(t.label)}</span></div>`;
  }).join('');

  const rows = (s.sources.length ? s.sources : [{ label: '暂无数据', visits: 0, pct: 0 }]).slice(0, 8).map((r) => `
    <li><span class="k">${escapeHtml(r.label)}</span><span class="v">${r.visits} 次 · ${r.pct}%</span></li>`).join('');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(c.name)} 数据看板</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#F5F5F7;color:#1D1D1F;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;padding:20px 16px 40px;-webkit-font-smoothing:antialiased}
.wrap{max-width:520px;margin:0 auto}
h1{font-size:19px;font-weight:600;margin-bottom:4px}
.meta{font-size:12px;color:#8E8E93;margin-bottom:20px}
.card{background:#fff;border-radius:14px;padding:18px 18px 20px;margin-bottom:14px}
.grid{display:flex;gap:12px;margin-bottom:14px}
.stat{flex:1;background:#fff;border-radius:14px;padding:16px}
.stat .num{font-size:27px;font-weight:600;line-height:1.15}
.stat .lab{font-size:12px;color:#6E6E73;margin-top:4px}
h2{font-size:14px;font-weight:600;margin-bottom:14px}
.chart{display:flex;align-items:flex-end;gap:6px;height:130px}
.bar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:6px}
.bar{width:100%;background:#007AFF;border-radius:4px 4px 0 0;min-height:2px}
.lab{font-size:10px;color:#8E8E93;transform:scale(.92)}
ul{list-style:none}
li{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #F2F2F5;font-size:14px}
li:last-child{border-bottom:none}
li .k{color:#1D1D1F}
li .v{color:#6E6E73}
.foot{text-align:center;font-size:12px;color:#8E8E93;margin-top:24px}
</style>
</head>
<body>
<div class="wrap">
<h1>${escapeHtml(c.name)}</h1>
<div class="meta">${escapeHtml(s.range.label)} · 数据由 GateLink 统计</div>
<div class="grid">
<div class="stat"><div class="num">${s.overview.visits}</div><div class="lab">访问次数</div></div>
<div class="stat"><div class="num">${s.overview.uniques}</div><div class="lab">独立访客</div></div>
</div>
<div class="card"><h2>访问趋势</h2><div class="chart">${bars}</div></div>
<div class="card"><h2>来源分布</h2><ul>${rows}</ul></div>
<div class="foot">统计的是页面访问次数，不代表最终添加或进群的人数</div>
</div>
</body>
</html>`;
  http.sendHtml(res, html);
}

module.exports = {
  handleLandingApi, handleLandingPage, handleShareApi, handleSharePage, resolveLanding,
};
