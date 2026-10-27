const { API_BASE, TIMEOUT, STORAGE_TOKEN } = require('./config');

function buildFail(code, message) {
  const err = new Error(message || '请求失败');
  err.code = code || 'ERROR';
  return err;
}

function authHeader() {
  const token = wx.getStorageSync(STORAGE_TOKEN) || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function request(method, path, data, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const header = Object.assign({ 'content-type': 'application/json' }, o.header);
    const token = o.noAuth ? null : authHeader();
    if (token) Object.assign(header, token);

    wx.request({
      url: `${API_BASE}${path}`,
      method,
      data: data || {},
      header,
      timeout: o.timeout || TIMEOUT,
      success(res) {
        const status = res.statusCode;
        const body = res.data;

        if (status === 401) {
          wx.removeStorageSync(STORAGE_TOKEN);
          const app = getApp();
          if (app) app.globalData.token = '';
          reject(buildFail('UNAUTHORIZED', '登录已过期，请重新登录'));
          return;
        }
        if (body && typeof body === 'object' && typeof body.ok === 'boolean') {
          if (status >= 200 && status < 300 && body.ok) {
            resolve(body.data);
            return;
          }
          reject(buildFail((body.error && body.error.code) || 'ERROR', (body.error && body.error.message) || '请求失败'));
          return;
        }
        reject(buildFail('BAD_RESPONSE', '服务返回内容不正确'));
      },
      fail(err) {
        const msg = err && err.errMsg ? err.errMsg : '';
        if (msg.indexOf('timeout') >= 0) reject(buildFail('TIMEOUT', '请求超时，请稍后再试'));
        else reject(buildFail('NETWORK', '网络不太顺，稍后再试'));
      },
    });
  });
}

// 下载需要鉴权的资源（如服务端生成的二维码），返回本地临时路径
function downloadAuth(path) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${API_BASE}${path}`,
      header: authHeader(),
      timeout: 20000,
      success(res) {
        if (res.statusCode === 200 && res.tempFilePath) {
          resolve(res.tempFilePath);
        } else if (res.statusCode === 401) {
          reject(buildFail('UNAUTHORIZED', '登录已过期，请重新登录'));
        } else {
          reject(buildFail('DOWNLOAD_FAILED', '下载失败，请稍后再试'));
        }
      },
      fail() {
        reject(buildFail('NETWORK', '网络不太顺，稍后再试'));
      },
    });
  });
}

function toast(message, icon) {
  wx.showToast({ title: message, icon: icon || 'none', duration: 1800 });
}

function failMessage(err) {
  if (!err) return '操作失败';
  if (typeof err === 'string') return err;
  if (err.code === 'UNAUTHORIZED') return '登录已过期，请重新登录';
  return err.message || '操作失败';
}

module.exports = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, d, o) => request('POST', p, d, o),
  patch: (p, d, o) => request('PATCH', p, d, o),
  del: (p, d, o) => request('DELETE', p, d, o),
  downloadAuth,
  authHeader,
  toast,
  failMessage,
  request,
};
