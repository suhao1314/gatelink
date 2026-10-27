const request = require('./request');
const { STORAGE_TOKEN } = require('./config');

let pending = null;

function currentToken() {
  const app = getApp();
  return (app && app.globalData.token) || wx.getStorageSync(STORAGE_TOKEN) || '';
}

function isLogged() {
  return !!currentToken();
}

// 保证全局只发起一次登录请求，避免多个页面并发触发
function ensureLogin() {
  if (isLogged()) return Promise.resolve(currentToken());
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (!res.code) {
          pending = null;
          reject(new Error('微信登录失败，请重试'));
          return;
        }
        request.post('/api/auth/login', { code: res.code })
          .then((data) => {
            const app = getApp();
            if (app) app.setToken(data.token);
            else wx.setStorageSync(STORAGE_TOKEN, data.token);
            pending = null;
            resolve(data.token);
          })
          .catch((err) => {
            pending = null;
            reject(err);
          });
      },
      fail() {
        pending = null;
        reject(new Error('微信登录失败，请检查网络'));
      },
    });
  });
  return pending;
}

function logout() {
  const app = getApp();
  if (app) app.clearAuth();
}

module.exports = { ensureLogin, isLogged, logout, currentToken };
