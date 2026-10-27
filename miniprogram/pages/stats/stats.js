const request = require('../../utils/request');
const auth = require('../../utils/auth');

const RANGES = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '7 天' },
  { key: '30d', label: '30 天' },
];

function decorate(stats) {
  if (!stats) return null;
  const s = JSON.parse(JSON.stringify(stats));

  const maxTrend = s.trend.reduce((m, t) => Math.max(m, t.visits), 0) || 1;
  s.trend.forEach((t) => { t.h = Math.max(3, Math.round((t.visits / maxTrend) * 100)); });

  const maxHour = s.hourly.reduce((m, h) => Math.max(m, h.visits), 0) || 1;
  s.hourly.forEach((h) => { h.h = Math.max(2, Math.round((h.visits / maxHour) * 100)); });

  s.sources.forEach((r) => { r.w = Math.max(2, Math.round(r.pct * 2.6)); });
  s.channels.forEach((r) => { r.w = Math.max(2, Math.round(r.pct * 2.6)); });
  s.hasSources = s.sources.length > 0;
  s.hasChannels = s.channels.length > 0;
  return s;
}

Page({
  data: {
    loading: true,
    loadError: '',
    campaigns: [],
    campaignNames: [],
    campaignIndex: 0,
    campaignId: '',
    range: '7d',
    rangeLabels: RANGES.map((r) => r.label),
    stats: null,
    overview: null,
    shareUrl: '',
  },

  onShow() {
    this.bootstrap();
  },

  async bootstrap() {
    try {
      await auth.ensureLogin();
      const data = await request.get('/api/campaigns');
      const list = data.items || [];
      if (!list.length) {
        this.setData({ loading: false, campaigns: [], campaignNames: [], stats: null, loadError: '' });
        return;
      }
      const app = getApp();
      const wanted = app && app.globalData.viewCampaignId ? app.globalData.viewCampaignId : '';
      let idx = 0;
      if (wanted) {
        const found = list.map((c) => c.id).indexOf(wanted);
        if (found >= 0) idx = found;
      }
      if (app) app.globalData.viewCampaignId = '';

      this.setData({
        campaigns: list,
        campaignNames: list.map((c) => c.name),
        campaignIndex: idx,
        campaignId: list[idx].id,
        loading: false,
        loadError: '',
      });
      this.loadStats();
    } catch (err) {
      this.setData({ loading: false, loadError: request.failMessage(err) });
    }
  },

  loadStats() {
    if (!this.data.campaignId) return;
    this.setData({ loading: true });
    request.get(`/api/campaigns/${this.data.campaignId}/stats`, { range: this.data.range })
      .then((data) => {
        const s = decorate(data);
        this.setData({
          loading: false,
          stats: s,
          overview: s.overview,
          hasData: s.overview.visits > 0,
          loadError: '',
        });
      })
      .catch((err) => {
        this.setData({ loading: false, loadError: request.failMessage(err) });
      });
  },

  onPickCampaign(e) {
    const idx = Number(e.detail.value);
    const c = this.data.campaigns[idx];
    if (!c) return;
    this.setData({ campaignIndex: idx, campaignId: c.id });
    this.loadStats();
  },

  onRange(e) {
    const key = RANGES[e.currentTarget.dataset.index];
    if (!key || key.key === this.data.range) return;
    this.setData({ range: key.key });
    this.loadStats();
  },

  onShare() {
    if (!this.data.campaignId) return;
    wx.showLoading({ title: '生成中', mask: true });
    request.post(`/api/campaigns/${this.data.campaignId}/share`, { scope: 'full', ttlDays: 30 })
      .then((data) => {
        wx.hideLoading();
        wx.setClipboardData({
          data: data.url,
          success: () => request.toast('链接已复制，可发给其他人'),
        });
        this.setData({ shareUrl: data.url, shareToken: data.token });
      })
      .catch((err) => {
        wx.hideLoading();
        request.toast(request.failMessage(err));
      });
  },

  onRevokeShare() {
    if (!this.data.shareToken) return;
    wx.showModal({
      title: '关闭这个分享',
      content: '关闭后对方打开链接会看到已失效，可以随时再生成一条新的。',
      confirmText: '关闭',
      confirmColor: '#FF3B30',
      success: (r) => {
        if (!r.confirm) return;
        request.del(`/api/share/${this.data.shareToken}`)
          .then(() => {
            request.toast('已关闭');
            this.setData({ shareUrl: '', shareToken: '' });
          })
          .catch((err) => request.toast(request.failMessage(err)));
      },
    });
  },

  onViewShare() {
    if (!this.data.shareUrl) {
      request.toast('请先生成分享链接');
      return;
    }
    wx.setClipboardData({ data: this.data.shareUrl, success: () => request.toast('链接已复制') });
  },

  onCreate() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onRetry() {
    this.setData({ loading: true, loadError: '' });
    this.bootstrap();
  },
});
