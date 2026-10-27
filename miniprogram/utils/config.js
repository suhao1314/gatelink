// 接口地址解析
// 开发者工具（envVersion=develop）默认走本地服务，正式版/体验版走线上域名。
// 想强制指定时把 FORCE 改成 'dev' 或 'prod'。

// 本地后端地址
const DEV_BASE = 'http://127.0.0.1:8787';

// 改成你自己的域名，必须与后端 PUBLIC_HOST 完全一致
const PROD_BASE = 'https://gate.example.com';

// 'auto' 跟随环境 / 'dev' 强制本地 / 'prod' 强制线上
const FORCE = 'auto';

function resolveBase() {
  if (FORCE === 'dev') return DEV_BASE;
  if (FORCE === 'prod') return PROD_BASE;
  try {
    const info = wx.getAccountInfoSync();
    // envVersion: develop 开发者工具 / trial 体验版 / release 正式版
    const env = info && info.miniProgram ? info.miniProgram.envVersion : 'release';
    return env === 'develop' ? DEV_BASE : PROD_BASE;
  } catch (e) {
    return PROD_BASE;
  }
}

module.exports = {
  API_BASE: resolveBase(),
  TIMEOUT: 10000,
  STORAGE_TOKEN: 'gl_token',
};
