const request = require('../../utils/request');
const auth = require('../../utils/auth');

const REFRESH_MIN_GAP = 20000;

Page({
  data: {
    loading: true,
    items: [],
    emptyError: '',
    lastLoadAt: 0,
  },

  onShow() {
    const app = getApp();
    if (app) app.globalData.viewCampaignId = '';
    this.bootstrap();
  },

  async bootstrap() {
    const gap = Date.now() - this.data.lastLoadAt;
    if (this.data.lastLoadAt && gap < REFRESH_MIN_GAP && this.data.items.length) return;

    try {
      await auth.ensureLogin();
      await this.loadList();
    } catch (err) {
      this.setData({ loading: false, emptyError: request.failMessage(err) });
    }
  },

  async loadList() {
    try {
      const data = await request.get('/api/campaigns');
      this.setData({
        loading: false,
        items: data.items || [],
        emptyError: '',
        lastLoadAt: Date.now(),
      });
    } catch (err) {
      this.setData({ loading: false, emptyError: request.failMessage(err) });
    }
  },

  onPullDownRefresh() {
    this.loadList().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  onCreate() {
    wx.showModal({
      title: '新建活码',
      placeholderText: '给它起个名字，比如 雁山拼车群',
      editable: true,
      maxLength: 40,
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const raw = String(res.content).trim();
        if (!raw) {
          request.toast('请先填写名称');
          return;
        }
        wx.showLoading({ title: '创建中', mask: true });
        request.post('/api/campaigns', { name: raw, type: 'personal', strategy: 'round_robin' })
          .then((data) => {
            wx.hideLoading();
            wx.navigateTo({ url: `/pages/editor/editor?id=${data.campaign.id}` });
          })
          .catch((err) => {
            wx.hideLoading();
            request.toast(request.failMessage(err));
          });
      },
    });
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/editor/editor?id=${id}` });
  },

  onViewStats(e) {
    const id = e.currentTarget.dataset.id;
    const app = getApp();
    if (app) app.globalData.viewCampaignId = id;
    wx.switchTab({ url: '/pages/stats/stats' });
  },

  onMore(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.items.filter((x) => x.id === id)[0];
    if (!item) return;

    const menu = [item.status === 'active' ? '暂停这个活码' : '启用这个活码', '复制出一份', '复制链接', '删除'];
    wx.showActionSheet({
      itemList: menu,
      success: (res) => {
        const idx = res.tapIndex;
        if (idx === 0) this.toggleStatus(item);
        else if (idx === 1) this.duplicate(item);
        else if (idx === 2) this.copyLink(item);
        else if (idx === 3) this.remove(item);
      },
      fail: () => {},
    });
  },

  toggleStatus(item) {
    const next = item.status === 'active' ? 'paused' : 'active';
    wx.showLoading({ title: '处理中', mask: true });
    request.patch(`/api/campaigns/${item.id}`, { status: next })
      .then(() => {
        wx.hideLoading();
        request.toast(next === 'active' ? '已启用' : '已暂停');
        this.loadList();
      })
      .catch((err) => {
        wx.hideLoading();
        request.toast(request.failMessage(err));
      });
  },

  duplicate(item) {
    wx.showLoading({ title: '复制中', mask: true });
    request.post(`/api/campaigns/${item.id}/duplicate`, {})
      .then(() => {
        wx.hideLoading();
        request.toast('已复制，默认暂停状态');
        this.loadList();
      })
      .catch((err) => {
        wx.hideLoading();
        request.toast(request.failMessage(err));
      });
  },

  copyLink(item) {
    wx.setClipboardData({
      data: item.landingUrl,
      success: () => request.toast('链接已复制'),
    });
  },

  remove(item) {
    wx.showModal({
      title: `删除「${item.name}」`,
      content: '删除后它的二维码会立即失效，统计数据一并清除，无法恢复。',
      confirmText: '删除',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中', mask: true });
        request.del(`/api/campaigns/${item.id}`)
          .then(() => {
            wx.hideLoading();
            request.toast('已删除');
            this.loadList();
          })
          .catch((err) => {
            wx.hideLoading();
            request.toast(request.failMessage(err));
          });
      },
    });
  },

  onRetry() {
    this.setData({ loading: true, emptyError: '' });
    this.bootstrap();
  },
});
