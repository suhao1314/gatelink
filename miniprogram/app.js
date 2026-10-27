const request = require('./utils/request');

App({
  globalData: {
    token: '',
    user: null,
    api: request,
  },

  onLaunch() {
    const t = wx.getStorageSync('gl_token');
    if (t) this.globalData.token = t;
  },

  getToken() {
    return this.globalData.token || wx.getStorageSync('gl_token') || '';
  },

  setToken(t) {
    this.globalData.token = t || '';
    if (t) wx.setStorageSync('gl_token', t);
    else wx.removeStorageSync('gl_token');
  },

  clearAuth() {
    this.setToken('');
    this.globalData.user = null;
    wx.removeStorageSync('gl_user');
  },
});
