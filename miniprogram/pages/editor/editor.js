const request = require('../../utils/request');
const auth = require('../../utils/auth');
const { API_BASE } = require('../../utils/config');

function expireText(ts) {
  if (!ts) return '';
  const days = Math.ceil((ts - Date.now() / 1000) / 86400);
  if (days < 0) return '已过期';
  if (days === 0) return '今天过期';
  return `${days} 天后过期`;
}

const THEMES = ['#007AFF', '#34C759', '#FF9F0A', '#5856D6', '#FF3B30', '#8E8E93', '#1D1D1F'];
const STRATEGIES = [
  { value: 'round_robin', label: '依次轮流' },
  { value: 'random', label: '随机分配' },
  { value: 'quota', label: '按名额分配' },
];

Page({
  data: {
    id: '',
    loading: true,
    tab: 'content',
    loadError: '',
    saving: false,
    form: {
      name: '',
      pageTitle: '',
      headline: '',
      subtitle: '',
      hintText: '',
      bodyText: '',
      themeColor: '#007AFF',
      status: 'active',
      strategy: 'round_robin',
    },
    strategyLabel: '依次轮流',
    strategyIndex: 0,
    fallbackId: '',
    coverUrl: '',
    channels: [],
    themes: THEMES,
    strategies: STRATEGIES.map((s) => s.label),
    qrVisible: false,
    qrPath: '',
    qrLoading: false,
  },

  onLoad(query) {
    if (!query.id) {
      this.setData({ loading: false, loadError: '缺少活码信息' });
      return;
    }
    this.setData({ id: query.id });
    this.loadDetail();
  },

  async loadDetail() {
    try {
      await auth.ensureLogin();
      const data = await request.get(`/api/campaigns/${this.data.id}`);
      const c = data.campaign;
      const sIdx = STRATEGIES.map((s) => s.value).indexOf(c.strategy);
      this.setData({
        loading: false,
        loadError: '',
        slug: c.slug || '',
        landingUrl: c.landingUrl || '',
        fallbackId: c.fallbackId || '',
        coverUrl: c.coverUrl || '',
        channels: (c.channels || []).map((ch) => Object.assign({}, ch, { expireText: expireText(ch.expiresAt) })),
        strategyIndex: sIdx < 0 ? 0 : sIdx,
        strategyLabel: sIdx < 0 ? STRATEGIES[0].label : STRATEGIES[sIdx].label,
        form: {
          name: c.name || '',
          pageTitle: c.pageTitle || '',
          headline: c.headline || '',
          subtitle: c.subtitle || '',
          hintText: c.hintText || '',
          bodyText: c.bodyText || '',
          themeColor: c.themeColor || '#007AFF',
          status: c.status || 'active',
          strategy: c.strategy || 'round_robin',
        },
      });
    } catch (err) {
      this.setData({ loading: false, loadError: request.failMessage(err) });
    }
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onInput(e) {
    const k = e.currentTarget.dataset.key;
    const v = e.detail.value || '';
    this.setData({ [`form.${k}`]: v });
  },

  onStrategy(e) {
    const idx = Number(e.detail.value);
    const s = STRATEGIES[idx] || STRATEGIES[0];
    this.setData({ strategyIndex: idx, strategyLabel: s.label, 'form.strategy': s.value });
  },

  onTheme(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({ 'form.themeColor': color });
  },

  onStatusSwitch(e) {
    this.setData({ 'form.status': e.detail.value ? 'active' : 'paused' });
  },

  noop() {},

  onSave() {
    const f = this.data.form;
    if (!String(f.name).trim()) {
      request.toast('请填写名称');
      return;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });
    request.patch(`/api/campaigns/${this.data.id}`, {
      name: f.name,
      pageTitle: f.pageTitle,
      headline: f.headline,
      subtitle: f.subtitle,
      hintText: f.hintText,
      bodyText: f.bodyText,
      themeColor: f.themeColor,
      status: f.status,
      strategy: f.strategy,
    }).then(() => {
      wx.hideLoading();
      this.setData({ saving: false });
      request.toast('已保存');
    }).catch((err) => {
      wx.hideLoading();
      this.setData({ saving: false });
      request.toast(request.failMessage(err));
    });
  },

  onPreviewLanding() {
    if (!this.data.slug) return;
    wx.navigateTo({ url: `/pages/landing/landing?slug=${this.data.slug}` });
  },

  onShareAppMessage() {
    return {
      title: this.data.form.name || '扫码',
      path: `/pages/landing/landing?slug=${this.data.slug}`,
    };
  },

  // ---------- 封面 ----------

  onUploadCover() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (r) => {
        const p = r.tempFiles[0].tempFilePath;
        this.uploadTo(`/api/campaigns/${this.data.id}/channels`, p, { kind: 'cover' }, '上传封面中')
          .then((data) => {
            this.setData({ coverUrl: data.campaign ? data.campaign.coverUrl : '' });
            request.toast('封面已更新');
          })
          .catch((err) => request.toast(request.failMessage(err)));
      },
    });
  },

  // ---------- 队列 ----------

  onAddChannel() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (r) => {
        const p = r.tempFiles[0].tempFilePath;
        const name = `子码 ${this.data.channels.length + 1}`;
        this.uploadTo(`/api/campaigns/${this.data.id}/channels`, p, { name, kind: 'code' }, '上传中')
          .then(() => {
            request.toast('已添加');
            this.loadDetail();
          })
          .catch((err) => request.toast(request.failMessage(err)));
      },
    });
  },

  uploadTo(path, filePath, formData, loadingText) {
    return new Promise((resolve, reject) => {
      wx.showLoading({ title: loadingText || '上传中', mask: true });
      wx.uploadFile({
        url: `${API_BASE}${path}`,
        filePath,
        name: 'file',
        formData: formData || {},
        header: request.authHeader(),
        timeout: 30000,
        success(res) {
          wx.hideLoading();
          if (res.statusCode === 401) {
            reject({ code: 'UNAUTHORIZED', message: '登录已过期，请重新登录' });
            return;
          }
          let body;
          try {
            body = JSON.parse(res.data);
          } catch (e) {
            reject({ code: 'BAD_RESPONSE', message: '服务返回内容不正确' });
            return;
          }
          if (body.ok) resolve(body.data);
          else reject({ code: (body.error && body.error.code) || 'ERROR', message: (body.error && body.error.message) || '上传失败' });
        },
        fail() {
          wx.hideLoading();
          reject({ code: 'NETWORK', message: '网络不太顺，稍后再试' });
        },
      });
    });
  },

  onChannelTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const ch = this.data.channels[idx];
    if (!ch) return;

    const isFallback = this.data.fallbackId === ch.id;
    const menu = [];
    menu.push(ch.status === 'active' ? '停用' : '启用');
    if (!isFallback) menu.push('设为兜底');
    menu.push('设置名额');
    menu.push('设置过期天数');
    menu.push('重新上传图片');
    if (idx > 0) menu.push('上移');
    if (idx < this.data.channels.length - 1) menu.push('下移');
    menu.push('删除');

    const actions = [];
    if (!isFallback) {
      actions.push(() => this.toggleChannel(ch));
      actions.push(() => this.setFallback(ch));
    } else {
      actions.push(() => this.toggleChannel(ch));
    }
    actions.push(() => this.setQuota(ch));
    actions.push(() => this.setExpire(ch));
    actions.push(() => this.replaceImage(ch));
    if (idx > 0) actions.push(() => this.moveChannel(idx, -1));
    if (idx < this.data.channels.length - 1) actions.push(() => this.moveChannel(idx, 1));
    actions.push(() => this.removeChannel(ch));

    wx.showActionSheet({
      itemList: menu,
      success: (res) => {
        const fn = actions[res.tapIndex];
        if (fn) fn();
      },
      fail: () => {},
    });
  },

  toggleChannel(ch) {
    const next = ch.status === 'active' ? 'paused' : 'active';
    request.patch(`/api/channels/${ch.id}`, { status: next })
      .then(() => { request.toast(next === 'active' ? '已启用' : '已停用'); this.loadDetail(); })
      .catch((err) => request.toast(request.failMessage(err)));
  },

  setFallback(ch) {
    request.patch(`/api/campaigns/${this.data.id}`, { fallbackId: ch.id })
      .then(() => { request.toast('已设为兜底'); this.loadDetail(); })
      .catch((err) => request.toast(request.failMessage(err)));
  },

  setQuota(ch) {
    wx.showModal({
      title: '设置名额',
      content: String(ch.quota || 0),
      placeholderText: '0 表示不限人数',
      editable: true,
      success: (r) => {
        if (!r.confirm) return;
        const n = parseInt(r.content, 10);
        const quota = Number.isFinite(n) && n >= 0 ? n : 0;
        request.patch(`/api/channels/${ch.id}`, { quota })
          .then(() => { request.toast('已保存'); this.loadDetail(); })
          .catch((err) => request.toast(request.failMessage(err)));
      },
    });
  },

  setExpire(ch) {
    wx.showModal({
      title: '设置过期天数',
      content: '',
      placeholderText: '填 0 表示长期有效',
      editable: true,
      success: (r) => {
        if (!r.confirm) return;
        const n = parseInt(r.content, 10);
        const days = Number.isFinite(n) && n > 0 ? Math.min(365, n) : 0;
        const expiresAt = days === 0 ? 0 : Math.floor(Date.now() / 1000) + days * 86400;
        request.patch(`/api/channels/${ch.id}`, { expiresAt })
          .then(() => { request.toast(days === 0 ? '已设为长期有效' : `将在 ${days} 天后过期`); this.loadDetail(); })
          .catch((err) => request.toast(request.failMessage(err)));
      },
    });
  },

  replaceImage(ch) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (r) => {
        const p = r.tempFiles[0].tempFilePath;
        this.uploadTo(`/api/channels/${ch.id}/image`, p, {}, '替换中')
          .then(() => { request.toast('已替换'); this.loadDetail(); })
          .catch((err) => request.toast(request.failMessage(err)));
      },
    });
  },

  moveChannel(idx, dir) {
    const ids = this.data.channels.map((c) => c.id);
    const target = idx + dir;
    const tmp = ids[idx];
    ids[idx] = ids[target];
    ids[target] = tmp;
    request.post(`/api/campaigns/${this.data.id}/channels/reorder`, { ids })
      .then(() => this.loadDetail())
      .catch((err) => request.toast(request.failMessage(err)));
  },

  removeChannel(ch) {
    wx.showModal({
      title: `删除「${ch.name}」`,
      content: '这个二维码将从队列里移除，已经印有它的物料不受影响。',
      confirmText: '删除',
      confirmColor: '#FF3B30',
      success: (r) => {
        if (!r.confirm) return;
        request.del(`/api/channels/${ch.id}`)
          .then(() => { request.toast('已删除'); this.loadDetail(); })
          .catch((err) => request.toast(request.failMessage(err)));
      },
    });
  },

  // ---------- 对外二维码 ----------

  onOpenQr() {
    if (this.data.qrPath) {
      this.setData({ qrVisible: true });
      return;
    }
    this.generateQr();
  },

  generateQr() {
    this.setData({ qrLoading: true });
    wx.showLoading({ title: '生成中', mask: true });
    const color = encodeURIComponent(this.data.form.themeColor || '#007AFF');
    request.downloadAuth(`/api/campaigns/${this.data.id}/qrcode?size=640&color=${color}`)
      .then((p) => {
        wx.hideLoading();
        this.setData({ qrPath: p, qrVisible: true, qrLoading: false });
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ qrLoading: false });
        request.toast(request.failMessage(err));
      });
  },

  onCloseQr() {
    this.setData({ qrVisible: false });
  },

  onPreviewQr() {
    if (!this.data.qrPath) return;
    wx.previewImage({ urls: [this.data.qrPath], current: this.data.qrPath });
  },

  onSaveQr() {
    if (!this.data.qrPath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.qrPath,
      success: () => request.toast('已保存到相册'),
      fail: (err) => {
        const msg = err && err.errMsg ? err.errMsg : '';
        if (msg.indexOf('deny') >= 0 || msg.indexOf('auth') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存二维码需要你允许保存到相册，可以去设置里打开。',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting({});
            },
          });
        } else {
          request.toast('保存失败');
        }
      },
    });
  },

  onCopyLink() {
    const url = `${this.data.landingUrl}`;
    if (!url) return;
    wx.setClipboardData({ data: url, success: () => request.toast('链接已复制') });
  },
});
