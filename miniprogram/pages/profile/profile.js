const request = require('../../utils/request');
const auth = require('../../utils/auth');
const { STORAGE_TOKEN } = require('../../utils/config');

Page({
  data: {
    loading: true,
    error: '',
    userId: '',
    campaignCount: 0,
    devMode: false,
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      await auth.ensureLogin();
      const data = await request.get('/api/me');
      const id = data.user && data.user.id ? String(data.user.id) : '';
      this.setData({
        loading: false,
        error: '',
        userId: id.length > 14 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id,
        campaignCount: data.campaignCount || 0,
        devMode: !!data.devMode,
      });
    } catch (err) {
      this.setData({ loading: false, error: request.failMessage(err) });
    }
  },

  onCopyId() {
    const app = getApp();
    const raw = wx.getStorageSync(STORAGE_TOKEN) ? '已登录' : '';
    if (!raw) return;
    request.toast('账号信息可在后台查看');
  },

  onClearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '会清除本地缓存的数据，不会删除你的活码和统计数据。',
      success: (r) => {
        if (!r.confirm) return;
        const app = getApp();
        const token = (app && app.globalData.token) || wx.getStorageSync(STORAGE_TOKEN) || '';
        wx.clearStorageSync();
        if (token && app) app.setToken(token);
        request.toast('缓存已清除');
      },
    });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新授权才能查看你的活码，数据不会丢失。',
      confirmText: '退出',
      confirmColor: '#FF3B30',
      success: (r) => {
        if (!r.confirm) return;
        auth.logout();
        wx.reLaunch({ url: '/pages/index/index' });
      },
    });
  },

  onRetry() {
    this.setData({ loading: true, error: '' });
    this.load();
  },
});
