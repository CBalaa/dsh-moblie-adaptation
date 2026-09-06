# dsh-mobile-adaptation

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 网页版（`dsh web`）做的移动端浏览器适配插件，面向 **Android / iOS / 鸿蒙（HarmonyOS）** 三种系统的浏览器。

它解决两类最明显的问题：

- **输入框打字时“一跳一跳”** —— 虚拟键盘弹出/收起导致布局视口（layout viewport）与可视视口（visual viewport）不同步，页面被顶起或缩放。
- **手机上看不舒服** —— 桌面端三栏布局的固定 680px 内容宽度下限在手机上把聊天内容/输入框横向裁掉，侧边栏和拖拽把手也占用/残留桌面专属控件。

## 它能做什么

| 适配点 | 手段 |
|---|---|
| 键盘弹出导致跳动 | 视口 meta 加 `viewport-fit=cover` + `interactive-widget=resizes-content`；页面高度改为跟随 `window.visualViewport.height` 平滑变化 |
| iOS 聚焦输入框自动放大页面 | 输入框字号下限设为 16px（iOS 对 <16px 的输入框会自动 zoom） |
| 内容被 680px 宽度下限裁掉 | 把共享宽度轴 `--dsh-chat-content-width` 重新锚定到列宽 |
| 刘海/底部手势条遮挡输入框 | `env(safe-area-inset-bottom)` 给 composer 留出安全区 |
| 桌面专属控件残留 | 隐藏宽度拖拽把手（`data-width-handle`）与列拖拽把手 |
| 图片/视频/代码/表格撑破版面 | 约束 `max-width: 100%` |

## 目录结构

```
.
├── package.json        # dsh.bundle + dsh.client 双面声明；scripts.verify 冒烟测试
├── cordis.patch.yml    # bundle 补丁：insert 本包为 client row
├── lib/
│   ├── index.js        # node 半（空实现，纯 ESM）
│   └── client.js       # 浏览器半（视口 meta + 移动端 CSS + visualViewport）
├── scripts/
│   └── smoke.mjs       # 零依赖冒烟测试
├── reference/          # 上游 deepseek-harness 源码（已 gitignore，仅参考）
└── README.md
```

## 构建

这个插件**零依赖、无编译步骤**：`lib/` 下的两个文件既是源码也是发布产物，直接用纯 JavaScript 手写，不需要 `pnpm/npm install`，也不需要 bundler。

两个文件对运行环境的要求不同，编辑时要各按各的语法：

- `lib/index.js`（node 半）是普通 ESM —— 用 `export function apply() {}`。
- `lib/client.js`（浏览器半）**必须是 classic script**，整体包在 `window.__ModuleLoader__.load({ id, factory })` 里、用 `exports.apply = apply` 导出，**绝不能写成 `export` 的 ESM**。因为 DSH 会把几十个 client bundle 拼成一个 combo 脚本下发，里面出现 `export` 会整个脚本语法报错，导致「Failed to load plugins」。

所以“构建”= 直接编辑 `lib/client.js` / `lib/index.js`。改完跑一次冒烟测试确认没改坏：

```sh
node scripts/smoke.mjs     # 等价于 pnpm run verify / npm run verify
```

冒烟测试零依赖，覆盖三系统（android/ios/harmony）识别、样式/meta 注入、visualViewport 变量与卸载回滚，并且把 `lib/client.js` 当作 classic script 加载，验证 `__ModuleLoader__.load` 注册是否合法。

## 安装

> 前提：已安装并可用 `dsh` 命令，且 `dsh web` 能正常启动。

在**本仓库根目录**执行：

```sh
dsh plugin --profile web add .
```

`add .` 会被 `dsh plugin` 锚定到当前目录，把本包以 `link:` 软链接方式装进 `$DSH_HOME/profiles/web`；因为本包声明了 `dsh.bundle`，`dsh.profile.bundles` 会自动加入本包，无需手动改配置。

然后照常启动：

```sh
dsh web
```

用手机浏览器（与电脑同一局域网）打开 `dsh web` 打印的地址即可。

因为是 `link:` 软链接安装，**以后改完 `lib/client.js` 直接重启 `dsh web` 就生效，不用重新安装**。

### 更新 / 卸载

```sh
# 更新（重新安装本目录，等价于刷新软链接 + 重排 bundles）
dsh plugin --profile web add .

# 卸载
dsh plugin --profile web remove dsh-mobile-adaptation
```

## 实现原理

DSH 的网页是一个「全插件」的 Cordis 应用。这个仓库里的插件是一个**双面插件**（bundle + client plugin）：

- `dsh.bundle.patch` 指向 `cordis.patch.yml`，它 `insert` 一行指向本包自身的 Loader entry，所以 `dsh plugin add` 后无需手动改 profile 配置。
- `dsh.client`（`platform: "web"`）让 `client-modules` 的 node 半扫描到本包，把 `lib/client.js` 作为浏览器插件下发。
- `lib/index.js` 是空实现（node 半）；`lib/client.js` 是浏览器半，全部行为通过 `ctx.effect()` 注册，插件热更新/卸载时可完整回滚。

`lib/client.js` 里做三件事：

1. 在 `<html>` 上打 `data-dsh-os`（`android` / `ios` / `harmony`）与 `data-dsh-mobile` 标记，并改写视口 meta。
2. 注入一段**只在 `html[data-dsh-mobile]` 下生效**的全局 CSS。
3. 监听 `window.visualViewport` 的 `resize`/`scroll`，用 rAF 节流地把可视视口高度写成 CSS 变量 `--dsh-vv-height`，页面外壳高度始终等于键盘上方可见区域。

所有选择器都用稳定锚点（`data-*` 属性、`#root`、CSS 自定义属性），不依赖会被 CSS Modules 哈希的类名，因此跨 DSH 小版本基本稳定。

## 配置

插件默认零配置。可通过覆盖 CSS 自定义属性微调：

| 变量 | 默认 | 说明 |
|---|---|---|
| `--dsh-mobile-side-pad` | `12px` | 聊天内容/输入框两侧留白 |
| `--dsh-mobile-composer-font-size` | `16px` | 输入框字号下限（低于 16px 会被 iOS 自动放大） |

你可以在自己的样式里（或再挂一个插件注入样式）覆盖 `:root` 上的这两个变量。

如需强制/关闭移动模式，可以手动给 `<html>` 加/去掉 `data-dsh-mobile`（脚本会在 `resize` 时按设备自动同步，但设备判定为手机时始终开启）。

## 已知限制

- **详情面板（details，工具输出列）在手机上自动关闭且无移动端打开入口**。这是 `ui-layout` 的列让位算法（`CENTER_MIN = 640px`）决定的：手机上放不下第三列就自动归零。把它做成移动端抽屉/浮层需要改 React 侧（`ui-layout` 的 AppFrame），超出本 CSS 插件的范围；本插件只保证它不遮挡主列。
- **侧边栏在手机上退化为 56px 的窄栏**（DSH 在 <1024px 自动折叠）。保留它是为了不丢失工作区/会话切换入口；本插件没有激进地隐藏它。
- 各系统浏览器的键盘行为有差异（尤其旧版本 iOS Safari、旧鸿蒙 ArkWeb）。本插件采用「`interactive-widget` + `visualViewport.height`」这套最通用的组合；极端旧内核若仍不理想，可自行微调 `lib/client.js` 里的常量。
- 移动端适配通过运行时注入完成（在客户端插件 apply 阶段、首次渲染前），视口 meta 与样式是“启动即就位”而非构建期写入 `index.html`，因此理论上存在极短的首次加载前闪现，不影响功能。

## 参考

- [DeepSeek Harness 源码](https://github.com/deepseek-ai/deepseek-harness)
- 上游样式规范 `docs/web-styling.md`
- 客户端插件契约 `packages/client/AGENTS.md`
- 主题注入先例 `packages/client/ui-theme/src/client/styles.ts`（本插件沿用其 `ctx.effect` 注入全局样式的方式）
