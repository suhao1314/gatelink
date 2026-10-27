'use strict';

/* 小程序静态自检：文件完整度、资源引用、事件绑定、包体积 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'miniprogram');

const issues = [];
const notes = [];

function walk(dir, ext, out) {
  const list = out || [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, ext, list);
    else if (p.endsWith(ext)) list.push(p);
  }
  return list;
}

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

// 1. app.json 页面四件套
const appJson = JSON.parse(read(path.join(ROOT, 'app.json')));
for (const p of appJson.pages) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    const f = path.join(ROOT, p + ext);
    if (!fs.existsSync(f)) issues.push(`页面 ${p} 缺少 ${ext}`);
  }
}

// 2. tabBar 图标
if (appJson.tabBar && appJson.tabBar.list) {
  for (const item of appJson.tabBar.list) {
    for (const key of ['iconPath', 'selectedIconPath']) {
      const f = path.join(ROOT, item[key]);
      if (!fs.existsSync(f)) issues.push(`tabBar 图标不存在：${item[key]}`);
    }
  }
}

// 3. wxml 引用校验
const wxmls = walk(ROOT, '.wxml');
for (const w of wxmls) {
  const src = read(w);
  const jsPath = w.replace(/\.wxml$/, '.js');
  const jsSrc = read(jsPath);

  // 本地静态资源
  const srcs = src.match(/(?:src|url)\s*=\s*"([^"]+)"/g) || [];
  for (const s of srcs) {
    const m = /"([^"]+)"/.exec(s);
    if (!m) continue;
    const v = m[1];
    if (v.indexOf('/assets/') === 0) {
      const f = path.join(ROOT, v.slice(1));
      if (!fs.existsSync(f)) issues.push(`${rel(w)} 引用了不存在的资源：${v}`);
    }
  }

  // 事件绑定
  const binds = src.match(/bind(?:tap|change|input|confirm)\s*=\s*"([A-Za-z0-9_]+)"/g) || [];
  const catchs = src.match(/catchtap\s*=\s*"([A-Za-z0-9_]+)"/g) || [];
  const handlers = Array.from(new Set([...binds, ...catchs].map((b) => /"([A-Za-z0-9_]+)"/.exec(b)[1])));
  for (const h of handlers) {
    const defined = new RegExp(`\\b${h}\\s*\\(`).test(jsSrc) || new RegExp(`\\b${h}\\s*:`).test(jsSrc);
    if (!defined) issues.push(`${rel(w)} 绑定了未定义的方法：${h}`);
  }

  // 未使用的 data 字段提示（只检查 wxml 用到的顶层字段是否出现在 js 的 data/setData）
  const used = new Set();
  const fields = src.match(/\{\{\s*([A-Za-z0-9_.]+)/g) || [];
  for (const f of fields) {
    const key = f.replace(/\{\{\s*/, '').split('.')[0];
    used.add(key);
  }
  for (const u of used) {
    const inJs = new RegExp(`\\b${u}\\s*:`).test(jsSrc) || new RegExp(`['"\`]${u}['"\`]`).test(jsSrc);
    if (!inJs) notes.push(`${rel(w)} 使用了 js 中未出现的字段：${u}`);
  }
}

// 4. js 依赖是否存在
const jss = walk(ROOT, '.js');
for (const j of jss) {
  const src = read(j);
  const reqs = src.match(/require\(['"]([^'"]+)['"]\)/g) || [];
  for (const r of reqs) {
    const m = /require\(['"]([^'"]+)['"]\)/.exec(r);
    if (!m) continue;
    const v = m[1];
    if (v.indexOf('.') !== 0) continue;
    const f = path.resolve(path.dirname(j), v);
    if (!fs.existsSync(f) && !fs.existsSync(f + '.js')) issues.push(`${rel(j)} 引用了不存在的模块：${v}`);
  }
}

// 5. 包体积
let total = 0;
const byExt = {};
for (const name of fs.readdirSync(ROOT)) {
  const p = path.join(ROOT, name);
  if (fs.statSync(p).isDirectory()) {
    for (const f of walk(p, '')) {
      const size = fs.statSync(f).size;
      total += size;
      const ext = path.extname(f) || '(no ext)';
      byExt[ext] = (byExt[ext] || 0) + size;
    }
  } else {
    const size = fs.statSync(p).size;
    total += size;
    const ext = path.extname(p) || '(no ext)';
    byExt[ext] = (byExt[ext] || 0) + size;
  }
}

console.log('\n===== 小程序静态自检 =====');
console.log(`\n包体积：${(total / 1024).toFixed(1)} KB`);
const sorted = Object.entries(byExt).sort((a, b) => b[1] - a[1]);
for (const [ext, size] of sorted) {
  console.log(`  ${ext.padEnd(10)} ${(size / 1024).toFixed(1)} KB`);
}

if (issues.length) {
  console.log(`\n发现 ${issues.length} 个问题：`);
  for (const i of issues) console.log('  [X] ' + i);
} else {
  console.log('\n问题：无');
}

if (notes.length) {
  console.log(`\n提示 ${notes.length} 条：`);
  for (const n of notes.slice(0, 40)) console.log('  [i] ' + n);
}

process.exit(issues.length ? 1 : 0);
