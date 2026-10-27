# GateLink 活码台 — 开发规划

> 版本：v1.0 ｜ 日期：2026-10-27 ｜ 作者：suhao1314
> 状态：规划已确认，进入开发

---

## 一、产品定位与边界

**一句话**：给校园团长、本地商家、校园代理提供「渠道活码」——一个码背后挂多张二维码，轮换展示，统计每条渠道的访问效果。

### 首版做（M1 范围）

| 能力 | 说明 |
|---|---|
| 渠道活码 | 一个活码绑定多张个人微信/群二维码，按策略轮换 |
| 服务商生成二维码 | 服务端生成对外二维码（PNG/SVG），**不依赖小程序原生能力** |
| 落地页可编辑 | 商家自定义顶部标题、副标题、正文、提示语、二维码图 |
| 数据看板 | 访问量、独立访客、来源、时间趋势、子码分布 |
| 看板分享 | 生成分享链接，他人免登录查看 |

### 首版不做（明确砍掉）

套餐计费、代理分销、团队协作、多级分销、私有化部署。理由：先验证有没有人真的用，再谈商业化。

### 合规红线（写死，不做变通）

1. 对外口径只统计「访问落地页」，不承诺「成功添加好友」
2. 不采集微信昵称、头像、手机号（除非商家主动绑定）、通讯录、聊天记录
3. 落地页不强制授权、不弹登录框
4. 不做诱导分享文案，不用「领取」「福利」等营销词
5. 商家上传图片走内容审核（首版：人工 + 关键词/尺寸初检，第二轮换官方内容安全 API）

---

## 二、技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 小程序 | 微信原生（非 uni-app/Taro） | 包体最小、启动最快、无框架层损耗 |
| 渲染模式 | WebView 渲染 + `lazyCodeLoading: requiredComponents` | Skyline 兼容性风险大于本项目收益，本项目页面简单，WebView 足够 |
| 后端 | Node.js 22 + 内置 `http` 模块（零 Web 框架依赖） | 减少依赖与安装失败风险，校园量级足够 |
| 数据库 | SQLite（Node 内置 `node:sqlite`） | 零安装、单文件、易备份；日访问万级无压力 |
| 二维码生成 | 服务端 `qrcode` npm 包 | 满足「服务端自行生成与下发」要求 |
| 文件存储 | 服务器本地目录 + nginx 静态分发 | 简单可控，后续可换对象存储 |
| 部署 | 自建服务器 nginx 反代 + PM2 | 复用现有资产，零额外云成本 |

**为什么不选云开发**：云开发环境会与已有业务环境耦合；本项目要求独立部署、数据独立；自建在已有服务器上边际成本为零。

> ⚠️ `node:sqlite` 在 Node 22 为实验性 API，生产建议 Node 22.5+ 并加 `--experimental-sqlite`（Node 22.22 实测可直接使用，仅输出实验性警告）。上线前需核实运行环境的 Node 版本。

---

## 三、页面结构

### 包体策略

全部页面放主包（页面数 ≤ 7，代码量小），主包体积目标 **< 300KB**。不引入任何 UI 组件库。

### 页面清单

| 页面路径 | 用途 | 是否 tabBar | 需登录 |
|---|---|---|---|
| `pages/index/index` | 活码列表 + 新建入口 | 是 | 是 |
| `pages/editor/editor` | 落码编辑（落地页内容 + 子码队列） | 否 | 是 |
| `pages/stats/stats` | 数据看板 | 是 | 是 |
| `pages/profile/profile` | 我的 / 账号信息 | 是 | 是 |
| `pages/landing/landing` | **扫码落地页**（访客入口，核心） | 否 | **否** |
| `pages/share/share` | 分享看板（他人免登录查看） | 否 | 否 |

**登录不设独立页面**：首页检测到未登录时显示内嵌引导卡片，点一下完成授权。减少一跳，符合「主流程不超过 3 步」。

### 主流程（≤3 步）

```
新建活码：首页点「新建」 → 填名称 + 选类型 → 保存
           （1）          （2）          （3）

添加子码：进入编辑器 → 点「添加二维码」 → 选图上传
           （1）           （2）           （3）

对外投放：编辑器点「获取二维码」 → 预览 → 保存图片 / 直接分享
           （1）                  （2）   （3）
```

---

## 四、数据模型（SQLite）

```
users
  id TEXT PK            用户 ID
  openid TEXT UNIQUE    微信 openid（DEV 模式下为 mock 值）
  nickname TEXT         昵称（可选，用户主动填写）
  phone TEXT            手机号（可选）
  created_at INTEGER
  last_login_at INTEGER

campaigns              活码
  id TEXT PK
  owner_id TEXT         -> users.id
  slug TEXT UNIQUE      对外短标识，用于落地 URL
  type TEXT             personal | group
  name TEXT             内部名称
  status TEXT           active | paused
  strategy TEXT         round_robin | random | quota
  fallback_id TEXT      兜底子码 ID（队列耗尽时展示）
  -- 落地页可编辑字段 --
  page_title TEXT       顶部标题栏文字
  headline TEXT         主标题
  subtitle TEXT         副标题
  body_text TEXT        正文段落
  hint_text TEXT        二维码下方提示语
  theme_color TEXT      主题色（hex）
  cover_path TEXT       顶部封面图（可选）
  created_at INTEGER
  updated_at INTEGER

channels               子二维码
  id TEXT PK
  campaign_id TEXT      -> campaigns.id
  name TEXT             子码名称（如「客服小李」「拼车1群」）
  image_path TEXT       商家上传的二维码图片路径
  sort_order INTEGER    顺序
  weight INTEGER        权重（number 策略用）
  quota INTEGER         配额上限（0 = 不限）
  served_count INTEGER  已服务次数
  display_count INTEGER 展示次数（用于统计）
  status TEXT           active | paused | expired
  expires_at INTEGER    过期时间（群码提醒用，0 = 不过期）
  created_at INTEGER

visits                 原始访问日志
  id TEXT PK
  campaign_id TEXT
  channel_id TEXT
  visitor_hash TEXT     访客指纹哈希（ip + ua 加盐哈希，不可逆）
  source TEXT           来源标识（scene / 投放渠道）
  day TEXT              YYYY-MM-DD
  hour INTEGER          0-23
  os TEXT               ios | android | other
  created_at INTEGER

daily_stats            每日聚合（写入时同步 +1，读时不扫全表）
  campaign_id TEXT
  day TEXT
  visits INTEGER
  uniques INTEGER
  PRIMARY KEY (campaign_id, day)

share_links            看板分享
  id TEXT PK
  campaign_id TEXT
  token TEXT UNIQUE
  scope TEXT            summary | full
  expires_at INTEGER    0 = 永久
  view_count INTEGER
  created_at INTEGER
```

**索引**：`campaigns(owner_id)`、`channels(campaign_id, sort_order)`、`visits(campaign_id, day)`、`visits(day, campaign_id)`。

**隐私设计**：`visitor_hash` 用 `sha256(ip + ua + 盐)` 单向哈希，**不存储原始 IP**。符合数据最小化。

---

## 五、接口清单

统一前缀 `/api`，鉴权：商家接口 Header `Authorization: Bearer <token>`。

### 5.1 鉴权

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | body `{code}`，换 openid，返回 `{token, user}` |

> 服务端需配置小程序 AppID / AppSecret。未配置时进入 DEV 模式，返回固定 mock openid，保证本地可完整测试。

### 5.2 活码

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/campaigns` | 我的活码列表（含今日访问数聚合） |
| POST | `/api/campaigns` | 新建，body `{name, type, strategy}` |
| GET | `/api/campaigns/:id` | 详情（含 channels 列表） |
| PATCH | `/api/campaigns/:id` | 编辑（落地页文案、策略、状态、兜底） |
| DELETE | `/api/campaigns/:id` | 删除（软删除） |
| POST | `/api/campaigns/:id/duplicate` | 复制一份 |

### 5.3 子码

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/campaigns/:id/channels` | 上传二维码图（`multipart/form-data`） |
| PATCH | `/api/channels/:id` | 改名称/配额/状态/排序/过期 |
| DELETE | `/api/channels/:id` | 删除 |
| POST | `/api/campaigns/:id/channels/reorder` | 批量重排 `{ids:[]}` |

### 5.4 二维码（服务端生成，核心要求）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/campaigns/:id/qrcode?format=png\|svg&size=512&margin=2` | 返回二维码图片 |
| GET | `/api/campaigns/:id/qrcode?download=1` | 带下载头 |

支持参数：`color`（前景色，默认跟随主题色）、`bg`（背景）、`logo=1`（中心留白嵌 Logo，默认关闭以保证识别率）。

> 二维码内容 = `https://<域名>/c/<slug>`。同一个 URL 既可被微信「扫普通链接二维码打开小程序」接管跳转小程序，也可直接打开 H5 兜底页。

### 5.5 落地页（访客，无需登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/public/landing/:slug?scene=xxx` | **一次请求**返回落地页配置 + 本次应展示的子码，同时写入访问记录 |

> 设计要点：配置读取、子码决策、访问埋点合并为一个接口，落地页首屏**只发 1 次网络请求**。

### 5.6 统计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/campaigns/:id/stats?range=7d\|30d\|today` | 概览 + 趋势 + 来源分布 + 子码分布 + 时段分布 |

返回结构：

```json
{
  "overview": { "visits": 0, "uniques": 0, "today": 0, "yesterday": 0, "deltaPct": 0 },
  "trend": [{ "day": "10-21", "visits": 12, "uniques": 9 }],
  "hourly": [{ "hour": 0, "visits": 3 }],
  "sources": [{ "key": "poster-a", "label": "海报A", "visits": 40, "pct": 0.42 }],
  "channels": [{ "id": "", "name": "客服小李", "views": 30, "pct": 0.5, "status": "active" }],
  "os": [{ "key": "ios", "visits": 20, "pct": 0.4 }]
}
```

### 5.7 分享

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/campaigns/:id/share` | body `{scope, ttlDays}`，返回 `{token, url}` |
| GET | `/api/public/share/:token` | 免登录读取统计摘要 |
| DELETE | `/api/share/:token` | 关闭分享 |

### 5.8 静态与兜底

| 路径 | 说明 |
|---|---|
| `/static/uploads/**` | 商家上传的二维码原图 |
| `/static/qr/**` | 服务端生成的对外二维码缓存 |
| `/c/:slug` | H5 兜底落地页（未在微信内或未配跳转规则时） |

---

## 六、性能预算

用户明确要求「启动与页面切换速度优先」。以下为硬性目标，验收时逐项核对。

| 指标 | 目标 | 手段 |
|---|---|---|
| 主包体积 | < 300KB | 零第三方依赖、不用组件库、图标自生产且压到 81×81 |
| 落地页首屏请求数 | **1 次** | 配置+选码+埋点合并接口 |
| 落地页首屏渲染 | < 800ms | 服务端直出配置、图片 WebP/压缩、数据本地缓存 5 分钟 |
| 页面切换 | < 300ms | 页面数控制在 7 个内，无复杂动画 |
| 列表首屏 | < 1s | 一次拉全、骨架屏、下拉刷新 |
| 静止时请求量 | 0 | 不在 onShow 无脑拉数据，用节流 + 时间戳判断 |

---

## 七、里程碑

| 里程碑 | 内容 | 交付物 |
|---|---|---|
| M1 | 规划 + UI 设计 | 本文档 + `02-ui-design.md` + 线框图 |
| M2 | 图标自生产 | PNG 图标包（禁 emoji） |
| M3 | 后端骨架：DB + 鉴权 + CRUD | `server/` 可启动 |
| M4 | 服务端二维码生成 + 图片上传 | 接口可用 |
| M5 | 落地页访问链路 + 决策策略 + 埋点 | 端到端跑通 |
| M6 | 小程序全部页面 | `miniprogram/` |
| M7 | 统计看板 + 分享 | 接口 + 页面 |
| M8 | 第一轮自测 | 测试报告 |
| M9 | 第二轮复盘优化 | 优化记录 |
| M10 | 第三轮验收 | 验收表 + 待补清单 |

---

## 八、风险与前置条件

| 项 | 说明 | 处理 |
|---|---|---|
| **审核合规（最大风险）** | 落地页展示第三方二维码，微信审核规则将「页面含二维码/微信号」列为常见驳回情形 | 落地页做成「商家卡片」形态而非纯二维码页；平台标识减弱而非完全隐藏；提审时用自己的合规内容；上线前核实最新审核规范 |
| AppID / AppSecret 缺失 | 当前无小程序 AppID | 代码走 DEV 模式兜底，配置真实凭证后即生效 |
| 域名与跳转规则 | 「扫普通链接二维码打开小程序」需在小程序后台配置 + ICP 备案域名 + 上传校验文件 | 交付文档中列为「需手动配置」清单 |
| 图片内容安全 | 商家可能上传违规图片 | 首版人工审核；第二轮接入微信内容安全 API |
| SQLite 并发 | 写操作串行，高频并发有锁等待 | 校园量级足够；超出后迁移到 MySQL，接口层已隔离 |

> 以上平台规则均以微信官方文档最新内容为准，交付文档会列出需人工核实的条目。
