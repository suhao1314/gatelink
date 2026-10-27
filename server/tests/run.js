'use strict';

/* eslint-disable no-console */
process.env.NODE_ENV = 'test';

const path = require('path');
const os = require('os');
const fs = require('fs');
const QRCode = require('qrcode');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gatelink-test-'));
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.QR_DIR = path.join(tmp, 'qr');
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.PORT = '0';
process.env.TOKEN_SECRET = 'test-secret-value';
process.env.VISITOR_SALT = 'test-salt';
process.env.PUBLIC_HOST = 'http://127.0.0.1';

const { start, server } = require('../src/index');

let BASE = '';
const results = [];

function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? '  ' + detail : ''}`);
}

async function api(method, p, opts) {
  const o = opts || {};
  const headers = {};
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.body && !o.form) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: o.form ? o.form : (o.body ? JSON.stringify(o.body) : undefined),
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.indexOf('application/json') >= 0) {
    return { status: res.status, json: await res.json(), res };
  }
  const text = await res.text();
  return { status: res.status, text, headers: res.headers, res };
}

async function uploadBinary(p, token, buffer, fields) {
  const fd = new FormData();
  for (const k of Object.keys(fields || {})) fd.append(k, fields[k]);
  fd.append('file', new Blob([buffer], { type: 'image/png' }), 'code.png');
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.indexOf('application/json') >= 0) return { status: res.status, json: await res.json() };
  return { status: res.status, text: await res.text() };
}

async function main() {
  await start();
  const port = server.address().port;
  BASE = `http://127.0.0.1:${port}`;
  console.log(`\nGateLink 自测开始 -> ${BASE}\n`);

  console.log('-- 健康检查 --');
  let r = await api('GET', '/api/health');
  check('健康检查返回 200', r.status === 200, `status=${r.status}`);
  check('开发模式已启用', r.json && r.json.data && r.json.data.devMode === true);

  console.log('\n-- 登录鉴权 --');
  r = await api('POST', '/api/auth/login', { body: { code: 'test-code-a' } });
  check('登录成功', r.status === 200 && r.json.ok, `status=${r.status}`);
  const tokenA = r.json.data.token;
  const userA = r.json.data.user;
  check('返回 token', !!tokenA, `len=${tokenA ? tokenA.length : 0}`);
  check('返回用户 id', !!userA.id, userA.id);

  r = await api('POST', '/api/auth/login', { body: {} });
  check('缺少 code 时报错', r.status === 400 && !r.json.ok, r.json.error ? r.json.error.code : '');

  r = await api('GET', '/api/me', { token: 'bad-token' });
  check('错误 token 被拒绝', r.status === 401, `status=${r.status}`);

  r = await api('GET', '/api/me', { token: tokenA });
  check('正确 token 可读取自身', r.status === 200 && r.json.data.user.id === userA.id);

  console.log('\n-- 活码增删改查 --');
  r = await api('POST', '/api/campaigns', { token: tokenA, body: { name: '雁山拼车群', type: 'group', strategy: 'round_robin' } });
  check('创建活码成功', r.status === 200 && r.json.data.campaign.id, r.json.data ? r.json.data.campaign.slug : '');
  const camp = r.json.data.campaign;
  check('自动生成 slug', !!camp.slug, camp.slug);
  check('返回落地链接', /\/c\//.test(camp.landingUrl), camp.landingUrl);

  r = await api('POST', '/api/campaigns', { token: tokenA, body: { name: '' } });
  check('空名称被拒绝', r.status === 400, r.json.error ? r.json.error.code : '');

  r = await api('GET', '/api/campaigns', { token: tokenA });
  check('列表返回 1 条', r.json.data.items.length === 1, `count=${r.json.data.items.length}`);

  const editPayload = {
    name: '雁山拼车群',
    pageTitle: '雁山拼车咨询',
    headline: '扫码进群',
    subtitle: '工作日每天发车',
    hintText: '长按识别，进入群聊',
    bodyText: '拼车说明第一行\n拼车说明第二行',
    themeColor: '#007AFF',
    status: 'active',
  };
  r = await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenA, body: editPayload });
  check('编辑落地页文案成功', r.status === 200, `status=${r.status}`);
  check('导航栏标题已保存', r.json.data.campaign.pageTitle === '雁山拼车咨询', r.json.data.campaign.pageTitle);
  check('提示语已保存', r.json.data.campaign.hintText === '长按识别，进入群聊');

  r = await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenA, body: { themeColor: 'red' } });
  check('非法主题色被拒绝', r.status === 400, r.json.error ? r.json.error.code : '');

  console.log('\n-- 子码上传 --');
  const png1 = await QRCode.toBuffer('https://example.com/channel-1', { type: 'png', width: 240 });
  const png2 = await QRCode.toBuffer('https://example.com/channel-2', { type: 'png', width: 240 });

  r = await uploadBinary(`/api/campaigns/${camp.id}/channels`, tokenA, png1, { name: '客服小李' });
  check('上传子码 1 成功', r.status === 200 && r.json.data.channel.id, r.json.data ? r.json.data.channel.name : '');
  const ch1 = r.json.data.channel;
  check('返回图片地址', !!ch1.imageUrl, ch1.imageUrl);

  r = await uploadBinary(`/api/campaigns/${camp.id}/channels`, tokenA, png2, { name: '客服小王' });
  check('上传子码 2 成功', r.status === 200 && r.json.data.channel.id);
  const ch2 = r.json.data.channel;

  const notImage = Buffer.from('this is definitely not an image file');
  r = await uploadBinary(`/api/campaigns/${camp.id}/channels`, tokenA, notImage, { name: '假图' });
  check('非图片被拒绝', r.status === 400 && r.json.error.code === 'BAD_TYPE', r.json.error ? r.json.error.code : '');

  r = await api('GET', `/api/campaigns/${camp.id}`, { token: tokenA });
  check('详情返回 2 个子码', r.json.data.campaign.channels.length === 2, `count=${r.json.data.campaign.channels.length}`);
  check('首个上传自动成为兜底', r.json.data.campaign.fallbackId === ch1.id, r.json.data.campaign.fallbackId);

  const staticRes = await fetch(BASE + ch1.imageUrl);
  check('静态图片可访问', staticRes.status === 200, `status=${staticRes.status}`);

  console.log('\n-- 顺序轮询策略 --');
  const slug = camp.slug;
  const seq = [];
  for (let i = 0; i < 6; i++) {
    const rr = await api('GET', `/api/public/landing/${slug}?scene=poster-a`);
    if (!rr.json.ok) { seq.push('ERR'); continue; }
    seq.push(rr.json.data.channel ? rr.json.data.channel.id : 'none');
  }
  const uniqueSeq = Array.from(new Set(seq));
  check('轮询返回多个不同子码', uniqueSeq.length >= 2, `序列=${seq.map((s) => (s === ch1.id ? 'A' : s === ch2.id ? 'B' : s)).join(',')}`);
  check('无错误响应', seq.indexOf('ERR') < 0);

  console.log('\n-- 随机与配额策略 --');
  await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenA, body: { strategy: 'random' } });
  const randSeq = [];
  for (let i = 0; i < 8; i++) {
    const rr = await api('GET', `/api/public/landing/${slug}`);
    randSeq.push(rr.json.data.channel.id);
  }
  check('随机策略可用', Array.from(new Set(randSeq)).length >= 2, `分布=${randSeq.length}次`);

  await api('PATCH', `/api/channels/${ch1.id}`, { token: tokenA, body: { quota: 1, servedCount: 0 } });
  await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenA, body: { strategy: 'quota' } });
  const afterQuota = [];
  for (let i = 0; i < 3; i++) {
    const rr = await api('GET', `/api/public/landing/${slug}`);
    afterQuota.push(rr.json.data.channel.id);
  }
  const ch1Hits = afterQuota.filter((x) => x === ch1.id).length;
  check('达到配额后不再被选中', ch1Hits === 1, `ch1 命中 ${ch1Hits} 次`);
  check('配额耗尽后切到下一个', afterQuota[1] === ch2.id && afterQuota[2] === ch2.id, `序列后两位=${afterQuota.slice(1).join(',')}`);

  console.log('\n-- 兜底逻辑 --');
  await api('PATCH', `/api/channels/${ch1.id}`, { token: tokenA, body: { quota: 1, servedCount: 5, status: 'active' } });
  await api('PATCH', `/api/channels/${ch2.id}`, { token: tokenA, body: { quota: 1, servedCount: 5, status: 'active' } });
  await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenA, body: { strategy: 'quota' } });
  r = await api('GET', `/api/public/landing/${slug}`);
  check('队列耗尽时返回兜底码', r.json.data.channel && r.json.data.channel.id === ch1.id, `fallbackUsed=${r.json.data.fallbackUsed}`);
  check('兜底标记正确', r.json.data.fallbackUsed === true, `fallbackUsed=${r.json.data.fallbackUsed}`);

  await api('PATCH', `/api/channels/${ch1.id}`, { token: tokenA, body: { status: 'paused' } });
  await api('PATCH', `/api/channels/${ch2.id}`, { token: tokenA, body: { status: 'paused' } });
  r = await api('GET', `/api/public/landing/${slug}`);
  check('全部暂停且兜底也停用时返回空', r.json.data.status === 'empty', `status=${r.json.data.status}`);

  await api('PATCH', `/api/channels/${ch1.id}`, { token: tokenA, body: { quota: 0, servedCount: 0, status: 'active' } });
  await api('PATCH', `/api/channels/${ch2.id}`, { token: tokenA, body: { quota: 0, servedCount: 0, status: 'active' } });
  await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenA, body: { strategy: 'round_robin' } });

  console.log('\n-- 访问统计 --');
  r = await api('GET', `/api/campaigns/${camp.id}/stats?range=7d`, { token: tokenA });
  const st = r.json.data;
  check('统计接口可用', r.status === 200, `status=${r.status}`);
  check('统计到访问次数', st.overview.visits >= 17, `visits=${st.overview.visits}`);
  check('今日数据存在', st.overview.today >= 17, `today=${st.overview.today}`);
  check('趋势数组长度正确', st.trend.length === 7, `len=${st.trend.length}`);
  check('小时分布 24 段', st.hourly.length === 24, `len=${st.hourly.length}`);
  check('来源含 scene 参数', st.sources.some((s) => s.key === 'poster-a'), JSON.stringify(st.sources.map((s) => s.key)));
  check('子码分布有数据', st.channels.length >= 1, `count=${st.channels.length}`);
  check('设备分布有数据', st.os.length >= 1, JSON.stringify(st.os.map((o) => o.label)));
  const chanSum = st.channels.reduce((a, b) => a + b.views, 0);
  check('子码视图合计不超过总访问', chanSum <= st.overview.visits, `chan=${chanSum} total=${st.overview.visits}`);

  const beforeUnique = st.overview.uniques;
  await api('GET', `/api/public/landing/${slug}`);
  const st2 = (await api('GET', `/api/campaigns/${camp.id}/stats?range=today`, { token: tokenA })).json.data;
  check('重复访客不增加独立访客', st2.overview.uniques === beforeUnique, `before=${beforeUnique} after=${st2.overview.uniques}`);

  console.log('\n-- 服务端二维码生成 --');
  r = await fetch(`${BASE}/api/campaigns/${camp.id}/qrcode?size=512`, { headers: { Authorization: `Bearer ${tokenA}` } });
  const pngBuf = Buffer.from(await r.arrayBuffer());
  check('二维码接口返回 PNG', r.status === 200 && pngBuf.slice(1, 4).toString() === 'PNG', `bytes=${pngBuf.length}`);
  const cached = await fetch(`${BASE}/api/campaigns/${camp.id}/qrcode?size=512`, { headers: { Authorization: `Bearer ${tokenA}` } });
  const pngBuf2 = Buffer.from(await cached.arrayBuffer());
  check('二维码缓存生效', pngBuf.equals(pngBuf2), 'same bytes');

  const svgRes = await fetch(`${BASE}/api/campaigns/${camp.id}/qrcode?format=svg`, { headers: { Authorization: `Bearer ${tokenA}` } });
  const svgText = await svgRes.text();
  check('二维码接口返回 SVG', svgText.indexOf('<svg') >= 0, `len=${svgText.length}`);
  const badSize = await fetch(`${BASE}/api/campaigns/${camp.id}/qrcode?size=99999`, { headers: { Authorization: `Bearer ${tokenA}` } });
  check('超大尺寸被夹紧到上限', (await badSize.arrayBuffer()).byteLength > 0, 'clamped');

  console.log('\n-- 分享看板 --');
  r = await api('POST', `/api/campaigns/${camp.id}/share`, { token: tokenA, body: { scope: 'full', ttlDays: 7 } });
  check('创建分享成功', r.status === 200 && r.json.data.token, r.json.data ? r.json.data.url : '');
  const shareToken = r.json.data.token;

  r = await api('GET', `/api/public/share/${shareToken}`);
  check('免登录读取分享成功', r.status === 200 && r.json.data.stats, `status=${r.status}`);
  check('分享含活码名称', r.json.data.campaign.name === '雁山拼车群', r.json.data.campaign.name);
  check('分享浏览计数递增', r.json.data.share.viewCount >= 1, `views=${r.json.data.share.viewCount}`);

  r = await api('POST', `/api/campaigns/${camp.id}/share`, { token: tokenA, body: { scope: 'summary' } });
  const sumToken = r.json.data.token;
  const sum = await api('GET', `/api/public/share/${sumToken}`);
  check('精简分享不含子码明细', sum.json.data.stats.channels === undefined);

  r = await api('DELETE', `/api/share/${shareToken}`, { token: tokenA });
  check('关闭分享成功', r.status === 200 && r.json.data.revoked);
  r = await api('GET', `/api/public/share/${shareToken}`);
  check('关闭后不可访问', r.status === 404, `status=${r.status}`);

  console.log('\n-- H5 兜底页 --');
  const pageRes = await fetch(`${BASE}/c/${slug}`);
  const html = await pageRes.text();
  check('H5 落地页返回 200', pageRes.status === 200, `status=${pageRes.status}`);
  check('H5 含自定标题', html.indexOf('雁山拼车咨询') >= 0);
  check('H5 含主标题', html.indexOf('扫码进群') >= 0);
  check('H5 含提示语', html.indexOf('长按识别，进入群聊') >= 0);
  check('H5 含二维码图', html.indexOf('/static/uploads/') >= 0);
  check('H5 无 XSS 注入风险', html.indexOf('<script') < 0, '无内联 script');

  const sharePage = await fetch(`${BASE}/s/${sumToken}`);
  const shareHtml = await sharePage.text();
  check('分享页 H5 返回 200', sharePage.status === 200, `status=${sharePage.status}`);
  check('分享页含数值', shareHtml.indexOf('访问次数') >= 0);

  console.log('\n-- 重排与复制 --');
  r = await api('POST', `/api/campaigns/${camp.id}/channels/reorder`, { token: tokenA, body: { ids: [ch2.id, ch1.id] } });
  check('重排成功', r.status === 200 && r.json.data.channels[0].id === ch2.id, '顺序已更新');

  r = await api('POST', `/api/campaigns/${camp.id}/duplicate`, { token: tokenA });
  check('复制活码成功', r.status === 200 && r.json.data.campaign.id !== camp.id, r.json.data.campaign.name);
  check('副本默认暂停', r.json.data.campaign.status === 'paused');
  check('副本继承子码', r.json.data.campaign.channels.length === 2, `count=${r.json.data.campaign.channels.length}`);
  const dupId = r.json.data.campaign.id;

  console.log('\n-- 子码过期与图片替换 --');
  await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenA, body: { strategy: 'round_robin' } });
  await api('PATCH', `/api/channels/${ch1.id}`, { token: tokenA, body: { expiresAt: Math.floor(Date.now() / 1000) - 3600, status: 'active', quota: 0 } });
  await api('PATCH', `/api/channels/${ch2.id}`, { token: tokenA, body: { quota: 0, status: 'active' } });
  const expiredSeq = [];
  for (let i = 0; i < 3; i++) {
    const rr = await api('GET', `/api/public/landing/${slug}`);
    expiredSeq.push(rr.json.data.channel.id);
  }
  check('过期子码不会被选中', expiredSeq.every((x) => x !== ch1.id), '三次均未命中过期子码');
  await api('PATCH', `/api/channels/${ch1.id}`, { token: tokenA, body: { expiresAt: 0 } });

  const png3 = await QRCode.toBuffer('https://example.com/channel-3', { type: 'png', width: 200 });
  r = await uploadBinary(`/api/channels/${ch2.id}/image`, tokenA, png3, {});
  check('替换子码图片成功', r.status === 200 && r.json.data.channel.imageUrl, r.json.data ? r.json.data.channel.imageUrl : '');
  r = await api('GET', `/api/campaigns/${camp.id}`, { token: tokenA });
  check('替换后仍是两个子码', r.json.data.campaign.channels.length === 2, `count=${r.json.data.campaign.channels.length}`);

  console.log('\n-- 列表预警 --');
  // 列表按 updated_at 倒序，中途复制的副本会排在首位，必须按 id 取本用例的活码
  const findCamp = (items) => items.find((x) => x.id === camp.id) || {};
  await api('PATCH', `/api/channels/${ch1.id}`, { token: tokenA, body: { status: 'paused' } });
  await api('PATCH', `/api/channels/${ch2.id}`, { token: tokenA, body: { status: 'paused' } });
  r = await api('GET', '/api/campaigns', { token: tokenA });
  const a1 = findCamp(r.json.data.items).alert;
  check('无可用子码时给出危险预警', a1 && a1.level === 'danger', a1 ? a1.text : 'null');

  await api('PATCH', `/api/channels/${ch1.id}`, { token: tokenA, body: { status: 'active' } });
  await api('PATCH', `/api/channels/${ch2.id}`, { token: tokenA, body: { status: 'active', expiresAt: Math.floor(Date.now() / 1000) + 2 * 86400 } });
  r = await api('GET', '/api/campaigns', { token: tokenA });
  const a2 = findCamp(r.json.data.items).alert;
  check('即将过期时给出提醒', a2 && a2.level === 'warn', a2 ? a2.text : 'null');

  await api('PATCH', `/api/channels/${ch2.id}`, { token: tokenA, body: { expiresAt: 0, status: 'active' } });

  console.log('\n-- 权限隔离 --');
  const other = await api('POST', '/api/auth/login', { body: { code: 'test-code-b' } });
  const tokenB = other.json.data.token;
  check('第二个用户 id 不同', other.json.data.user.id !== userA.id);
  r = await api('GET', `/api/campaigns/${camp.id}`, { token: tokenB });
  check('跨用户读被拒绝', r.status === 403, `status=${r.status}`);
  r = await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenB, body: { name: '恶意改名' } });
  check('跨用户改被拒绝', r.status === 403, `status=${r.status}`);
  r = await api('DELETE', `/api/campaigns/${camp.id}`, { token: tokenB });
  check('跨用户删被拒绝', r.status === 403, `status=${r.status}`);
  r = await api('GET', '/api/campaigns', { token: tokenB });
  check('第二个用户列表为空', r.json.data.items.length === 0, `count=${r.json.data.items.length}`);

  console.log('\n-- 异常处理 --');
  r = await api('GET', '/api/public/landing/not-exist-slug');
  check('不存在的 slug 返回 404', r.status === 404, `status=${r.status}`);
  r = await api('GET', '/c/not-exist-slug');
  check('H5 未知 slug 返回 404', r.status === 404, `status=${r.status}`);
  r = await api('GET', '/api/nonexistent');
  check('未知接口返回 404', r.status === 404, `status=${r.status}`);
  r = await api('DELETE', `/api/channels/${ch1.id}`, { token: tokenB });
  check('跨用户删子码被拒绝', r.status === 403, `status=${r.status}`);

  await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenA, body: { status: 'paused' } });
  r = await api('GET', `/api/public/landing/${slug}`);
  check('暂停后返回 paused 状态', r.json.data.status === 'paused', r.json.data.status);
  await api('PATCH', `/api/campaigns/${camp.id}`, { token: tokenA, body: { status: 'active' } });

  console.log('\n-- 删除 --');
  r = await api('DELETE', `/api/campaigns/${dupId}`, { token: tokenA });
  check('删除活码成功', r.status === 200, `status=${r.status}`);
  r = await api('GET', `/api/campaigns/${dupId}`, { token: tokenA });
  check('删除后不可读取', r.status === 404, `status=${r.status}`);

  const passed = results.filter((x) => x.pass).length;
  const failed = results.filter((x) => !x.pass);
  console.log(`\n===== 测试结果：${passed}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log('\n未通过的用例：');
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* noop */ }
  server.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常终止：', e);
  try { server.close(); } catch (e2) { /* noop */ }
  process.exit(1);
});
