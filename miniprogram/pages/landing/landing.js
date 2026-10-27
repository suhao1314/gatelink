const request = require('../../utils/request');

const CACHE_TTL = 5 * 60 * 1000;

function extractSlug(query) {
  if (!query) return '';
  if (query.slug) return String(query.slug);
  if (query.scene) return decodeURIComponent(String(query.scene));
  if (query.q) {
    const url = decodeURIComponent(String(query.q));
    if (/\/c\/([A-Za-z0-9_-]+)/.test(url)) {
      return /\/c\/([A-Za-z0-9_-]+)/.exec(url)[1];
    }
    if (/[?&]slug=([A-Za-z0-9_-]+)/.test(url)) {
      return /[?&]slug=([A-Za-z0-9_-]+)/.exec(url)[1];
    }
  }
  return '';
}

function extractScene(query) {
  if (!query) return '';
  if (query.source) return String(query.source);
  if (query.sceneRaw) return String(query.sceneRaw);
  if (query.q) {
    const url = decodeURIComponent(String(query.q));
    if (/[?&](scene|source)=([A-Za-z0-9_.-]+)/.test(url)) {
      return /[?&](scene|source)=([A-Za-z0-9_.-]+)/.exec(url)[2];
    }
  }
  return '';
}

Page({
  data: {
    loading: true,
    status: '',
    slug: '',
    pageTitle: '扫码',
    headline: '',
    subtitle: '',
    bodyText: '',
    hintText: '',
    themeColor: '#007AFF',
    coverUrl: '',
    channel: null,
    errorMsg: '',
  },

  onLoad(query) {
    const slug = extractSlug(query);
    if (!slug) {
      this.setData({ loading: false, status: 'notfound', errorMsg: '入口信息不完整' });
      wx.setNavigationBarTitle({ title: '无法打开' });
      return;
    }
    this.setData({ slug });
    wx.setNavigationBarTitle({ title: '加载中' });
    this.loadPage(slug, extractScene(query));
  },

  applyData(data) {
    const patch = {
      loading: false,
      status: data.status,
      pageTitle: data.pageTitle || '扫码',
      headline: data.headline || '',
      subtitle: data.subtitle || '',
      bodyText: data.bodyText || '',
      hintText: data.hintText || '',
      themeColor: data.themeColor || '#007AFF',
      coverUrl: data.coverUrl || '',
      channel: data.channel || null,
      errorMsg: '',
    };
    if (data.status === 'paused') patch.hintText = data.hintText || '这个入口已暂时关闭';
    if (data.status === 'empty') patch.hintText = '暂时无法为您提供二维码，请稍后再试';
    this.setData(patch);
    wx.setNavigationBarTitle({ title: patch.pageTitle });
  },

  async loadPage(slug, source) {
    const key = `gl_landing_${slug}`;
    let cached = null;
    try {
      cached = wx.getStorageSync(key);
    } catch (e) {
      cached = null;
    }
    const fresh = cached && cached.data && (Date.now() - (cached.ts || 0)) < CACHE_TTL;
    if (fresh) this.applyData(cached.data);

    try {
      const suffix = source ? `?source=${encodeURIComponent(source)}` : '';
      const data = await request.get(`/api/public/landing/${encodeURIComponent(slug)}${suffix}`, { noAuth: true });
      try {
        wx.setStorageSync(key, { ts: Date.now(), data });
      } catch (e) {
        /* 存储失败不影响使用 */
      }
      this.applyData(data);
    } catch (err) {
      if (fresh) return;
      const code = err && err.code ? err.code : 'ERROR';
      this.setData({
        loading: false,
        status: code === 'CAMPAIGN_NOT_FOUND' ? 'notfound' : 'error',
        errorMsg: code === 'CAMPAIGN_NOT_FOUND' ? '这个入口已经失效了' : (err.message || '加载失败，请稍后再试'),
      });
      wx.setNavigationBarTitle({ title: code === 'CAMPAIGN_NOT_FOUND' ? '已失效' : '出错了' });
    }
  },

  onReload() {
    if (!this.data.slug) return;
    this.setData({ loading: true, status: '' });
    this.loadPage(this.data.slug, '');
  },

  onPreview() {
    const c = this.data.channel;
    if (!c || !c.imageUrl) return;
    wx.previewImage({ current: c.imageUrl, urls: [c.imageUrl] });
  },

  onShareAppMessage() {
    const t = this.data.headline || this.data.pageTitle || '扫码';
    return {
      title: t,
      path: `/pages/landing/landing?slug=${this.data.slug}`,
    };
  },

  onShareTimeline() {
    return { title: this.data.headline || this.data.pageTitle || '扫码' };
  },
});
