'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let page;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/share/share.js'), 'utf8'), {
  require: () => ({ get: async () => ({ campaign: { name: 'test' }, stats: { trend: [], overview: {} } }) }),
  Page: value => { page = value; }, wx: { setNavigationBarTitle() {} },
});
(async () => {
  let state = {};
  const ctx = { setData: data => Object.assign(state, data), load() { throw Error('invalid token reached request'); } };
  for (const token of ['', '../x', 'a'.repeat(129), []]) {
    page.onLoad.call(ctx, { token });
    assert.equal(state.loading, false);
    assert.ok(state.error);
  }
  await page.load.call({ setData: data => { state = data; } }, 'a'.repeat(20));
  assert.equal(state.error, '');
  assert.equal(state.stats.sources.length, 0);
  assert.equal(state.stats.hasSources, false);
  let landing;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/landing/landing.js'), 'utf8'), {
    require: () => ({get: async () => { const e = new Error('gone'); e.code = 'CAMPAIGN_NOT_FOUND'; throw e; }}),
    Page: value => { landing = value; }, wx: {setNavigationBarTitle(){}, getStorageSync(){throw Error('must not use cached QR');}},
  });
  let cleared = {};
  await landing.loadPage.call({setData: d => Object.assign(cleared,d)}, 'slug', '');
  assert.equal(cleared.channel, null);
  assert.equal(cleared.coverUrl, '');
  assert.equal(cleared.status, 'notfound');
  landing.onLoad.call({setData: d => Object.assign(cleared,d)}, {scene: '%invalid'});
  assert.equal(cleared.status, 'notfound');
  console.log('PASS client summary and malformed-token regressions');
})().catch(e => { console.error(e); process.exitCode = 1; });
