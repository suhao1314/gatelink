const request = require('../../utils/request');

function decorate(stats) {
  if (!stats) return null;
  const s = JSON.parse(JSON.stringify(stats));
  const max = s.trend.reduce((m, t) => Math.max(m, t.visits), 0) || 1;
  s.trend.forEach((t) => { t.h = Math.max(3, Math.round((t.visits / max) * 100)); });
  s.sources.forEach((r) => { r.w = Math.max(2, Math.round(r.pct * 2.6)); });
  if (s.channels) s.channels.forEach((r) => { r.w = Math.max(2, Math.round(r.pct * 2.6)); });
  s.hasSources = s.sources.length > 0;
  s.hasChannels = !!(s.channels && s.channels.length);
  return s;
}

Page({
  data: {
    token: '',
    loading: true,
    error: '',
    url: '',
    info: null,
    stats: null,
  },

  onLoad(query) {
    const token = query.token || query.scene || '';
    if (!token) {
      this.setData({ loading: false, error: '链接信息不完整' });
      return;
    }
    this.setData({ token });
    wx.setNavigationBarTitle({ title: '数据看板' });
    this.load(token);
  },

  async load(token) {
    try {
      const data = await request.get(`/api/public/share/${encodeURIComponent(token)}`, { noAuth: true });
      this.setData({
        loading: false,
        error: '',
        info: data,
        stats: decorate(data.stats),
      });
      wx.setNavigationBarTitle({ title: `${data.campaign.name} 数据` });
    } catch (err) {
      const code = err && err.code ? err.code : 'ERROR';
      this.setData({
        loading: false,
        error: code === 'SHARE_EXPIRED' ? '这个分享链接已过期' : '看板不存在或已被关闭',
      });
    }
  },

  onCopy() {
    const url = this.data.info && this.data.info.campaign ? this.data.info.campaign.landingUrl : '';
    if (!url) return;
    wx.setClipboardData({ data: url, success: () => request.toast('已复制活码地址') });
  },

  onRetry() {
    this.setData({ loading: true, error: '' });
    this.load(this.data.token);
  },

  onShareAppMessage() {
    return {
      title: this.data.info ? `${this.data.info.campaign.name} 的扫码数据` : '扫码数据看板',
      path: `/pages/share/share?token=${this.data.token}`,
    };
  },
});
