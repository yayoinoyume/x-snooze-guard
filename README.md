# X 暂停话题推送 · 自动续期

一个 Tampermonkey 用户脚本，让 X（Twitter）的「暂停话题推送」保持有效。

X 的这个功能只持续 **24 小时**，到期后你屏蔽的话题会重新出现在「为你推荐」里。这个脚本会记住你勾选过的话题，在到期时自动续上 24 小时。

不是刷流量、不是抓数据、不调用任何 API。它只改浏览器本地的设置时间戳。

---

## 它做什么

X 的「暂停话题推送」面板（「为你推荐」右侧小箭头）里勾选话题，有效期 24 小时。

这个脚本在同一个面板里加一块「自动续期」开关：

```
政治              [开关]
体育              [开关]
…（9 个话题）…
──────────────────────
自动续期          [开关]   ← 脚本加的
已勾选的话题到期前自动续上 24 小时
2 个话题生效中 · 23 小时后到期
──────────────────────
      [ 重 置 ]
```

- 你在 X 面板里勾选哪些话题，脚本就记住哪些
- 到期前自动续上 24 小时
- 你取消勾选，脚本就停止续期
- 没有悬浮窗、没有额外界面、不打扰你正常使用

## 安装

先安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）。

### 方式一：复制粘贴（不需要额外授权，推荐）

1. 打开 [x-snooze-guard.user.js](./x-snooze-guard.user.js)，点右上角 **Raw**，全选复制
2. 点 Tampermonkey 图标 → 管理面板 → **+** 新建脚本
3. 清空模板内容，粘贴刚才复制的代码
4. Ctrl+S 保存

### 方式二：点链接自动安装（需要先给扩展授权）

Tampermonkey 只会拦截它**有权限访问的站点**上的 `.user.js`。
如果点 raw 链接看到的是纯文本源码而不是安装页，就是这个原因。

授权方法：`chrome://extensions` → 篡改猴 → 详情 → 网站访问 → 「在特定网站上」→ 添加：

- `https://github.com/*`
- `https://raw.githubusercontent.com/*`

之后点这个链接会弹出安装页：
<https://github.com/yayoinoyume/x-snooze-guard/raw/main/x-snooze-guard.user.js>

### 最后一步（两种方式都要）

给 Tampermonkey 授权 x.com：`chrome://extensions` → 篡改猴 → 详情 → 网站访问 → 「在特定网站上」并添加 `https://x.com/*`

然后打开 x.com，点「为你推荐」右侧箭头，在面板底部看到「自动续期」即成功。

## 原理

X 把「暂停话题推送」的状态存在浏览器的 IndexedDB 里，不是服务器：

```
数据库  localforage
表      keyvaluepairs
键      user:<账号ID>:rweb.timelineFilters
值      { snoozedTags: { "<话题ID>": <到期时间戳ms> }, _lastPersisted: <ms> }
```

页面加载时，X 会读取已过期的时间戳并丢弃，**但不会删除记录**；而你在面板里取消勾选时，X 会**删除**记录。

脚本利用这个差异区分两种情况：

| 存储里的状态 | 含义 | 脚本动作 |
|---|---|---|
| 记录存在，时间戳在未来 | 正在生效 | 不动 |
| 记录存在，时间戳已过期 | 到期了 | 续上 24 小时 |
| 记录不存在 | 你取消了 | 停止续期 |

续期后，X 的下一次 HomeTimeline 请求会带上 `topicIds: ["-<话题ID>"]`，服务端据此过滤该话题。这是 X 自己支持的正常参数。

## 隐私

- **零网络请求**：脚本没有 `fetch` / `XMLHttpRequest` / `sendBeacon` / `WebSocket`
- **零油猴特权**：`@grant none`，没有 `GM_xmlhttpRequest` 之类可以跨域发请求的 API
- **不读登录态**：不碰 cookie、token、密码
- **只写三处本地数据**：
  - `localStorage["xSnoozeGuard.known"]` — 话题 ID 数组
  - `localStorage["xSnoozeGuard.auto"]` — 开关状态
  - IndexedDB 里的 `snoozedTags` 时间戳

数据出不了你的浏览器。

## 限制

- 只在 x.com / twitter.com 生效
- 手机上装不了 Tampermonkey，所以移动端用不了
- X 改版可能改存储结构，脚本会失效（面板会显示「没有找到 X 的时间线设置」，不会静默出错）
- 话题 ID 是硬编码的 9 个（X 当前的话题分类）

## 免责声明

这个脚本修改的是浏览器本地的偏好数据，绕过 X 产品设计上的 24 小时有效期。

它不自动化任何社交操作、不抓取数据、不调用私有接口。但它**不是 X 官方支持的行为**，使用风险自负。如果 X 更改实现方式，脚本可能失效。

## License

MIT
