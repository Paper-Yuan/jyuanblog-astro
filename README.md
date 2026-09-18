# 千机志 Astro 前台

静态前台，设计语言采用 **Material 3 Expressive**，配色引擎参考
[Shirone](https://github.com/LyraVoid/Shirone)（MIT）。

## 这是什么

**混合架构**：前台静态生成，后台仍由现有 Vue 应用提供。

```
访问者侧（本目录，Astro SSG）        管理侧（jyuanblog-frontend，Vue）
  /                 静态首页            /admin/*  仪表板/文章/评论/音乐
  /blog/:id         静态文章 + TOC
  /archives 等      静态归档/分类/标签
  /search           Pagefind 全文检索
  → 零 JS 依赖，首屏直出
                                     /api/*  Cloudflare Worker + D1
                                     ↑ 文章数据由构建期从这里拉取
```

新文章发布后需要**重新构建**前台（数据在构建期固化）。

## 快速开始

```bash
npm install

# 后端需先起来（另开一个终端）
#   cd ../jyuanblog-worker && npx wrangler dev --port 8787

npm run dev        # http://localhost:4321
```

`astro.config.mjs` 已把 `/api` 代理到本地 Worker，因此客户端用相对路径即可，
本地不需要 CORS 白名单。若后端换了端口，改代理目标与 `.env`。

```bash
npm run build      # astro build + pagefind 生成搜索索引
npm run preview    # 预览构建产物（搜索只在构建产物里可用）
npm run check      # 类型检查
```

> **搜索在 `dev` 下不可用**：Pagefind 的索引是构建期产物，
> 必须 `npm run build && npm run preview` 才能检索。

## 目录结构

```
src/
├── config/site.ts          站点配置单一真源（标题/导航/主题默认值/API 地址）
├── lib/
│   ├── mc-utils.ts         Material 3 动态配色引擎（HCT，移植自 Shirone）
│   ├── vendor/
│   │   └── material-color.mjs  预打包的官方色彩库（见下方"已知坑"）
│   ├── theme.ts            主题运行时（轻量层，不含引擎）
│   ├── theme-engine.ts     引擎入口（唯一静态 import mc-utils 的模块，只能动态加载）
│   ├── api.ts              构建期从 Worker API 拉数据
│   └── format.ts           Markdown 渲染 / TOC / 阅读时长 / 日期格式化
├── styles/
│   ├── variables.css       M3E 设计令牌（色彩角色/形状/间距/动效/排版）
│   └── main.css            基础样式 + M3 组件原语 + Markdown 排版
├── components/             Icon / TopAppBar / Footer / ArticleCard
│   ├── SettingsPanel.svelte    访客显示设置面板
│   └── Comments.svelte         评论区（客户端拉 API）
├── layouts/BaseLayout.astro
└── pages/                  8 个路由 + rss/atom/llms/sitemap
```

## 设计系统

令牌定义在 `src/styles/variables.css`，两层结构：

1. `--mc-*`：由 HCT 引擎按"色相 + 风格 + 规范 + 明暗"算出的 51 个 M3 角色。
2. 语义层：`--primary` / `--surface` / `--outline` 等，映射到 `--mc-*`，
   并带 `oklch` 回退公式，保证引擎未介入时样式依然可用。

**形状契约**（改样式前请先读）：

| 元素 | 圆角 | 令牌 |
|---|---|---|
| 按钮、输入框 | 12px | `--shape-corner-m` |
| 卡片 | 16px | `--shape-corner-l` |
| chip、图标按钮 | 全圆 | `--shape-corner-full` |
| 浮层 / 对话框 / 搜索栏 | 28px | `--shape-corner-xl` |

> ⚠️ **按钮与 chip 的形状不能互换**。早期版本把两者写反了：按钮是胶囊
> （chip 的形状）、chip 是 8px 小圆角（按钮的形状），结果每个按钮看起来
> 都像个标签，反而削弱了"这可点"的暗示。判断依据是 M3E 的语义——
> **核心控件用 12px，标签用全圆**。这条有测试覆盖（`verify:visual`）。

**版心契约**：正文阅读列是 `--m3e-reading-max`，规范要求在 Extra-large
（≥1280px）下把正文约束在 **840–1040dp** 内、两侧留白。本项目取区间下界
**840px**：同一像素宽度下中文能排的字数约为西文两倍，840px / 16px 已是
52 个汉字一行。`--m3e-measure`（`.prose` 的行宽上限）直接引用它——
两者一旦分开取值，宽屏上正文会比标题窄一截，右半边空出一条竖向死区。

侧栏 TOC 的断点（`1200px`）与版心宽度（`1120px`）是从这个不变量**反推**的：
`840 + 240 + 24 = 1104`。若沿用更早的 `1100px` 断点 + `1080px` 版心，
一加侧栏正文列就只剩 816px，跌破了 840px 下界 —— 加侧栏反而把阅读体验
弄差了，这类回归不会报错，只能靠断言拦住。

**对比度契约**：正文 ≥ 4.5:1，大字与边界 ≥ 3:1；`--primary` 只能配 `--on-primary`，
`--primary-container` 只能配 `--on-primary-container`。

## 动效

动效令牌在 `variables.css`，遵循 M3 的完整时长阶梯
（`--m3e-duration-short1` … `--m3e-duration-extra-long4`，50ms–1000ms），
外加 `--m3e-duration-short/medium/long` 三个语义别名。
缓动里 `emphasized` 与 `standard` 的贝塞尔值相同**不是笔误** —— M3 的 emphasized
是一段两段式路径，单条 `cubic-bezier` 表达不了，material-web 的 Web 实现同样用
standard 近似它；真正拉开观感的是 `emphasized-decelerate`（进场）与
`emphasized-accelerate`（离场）。

**页面过渡是纯 CSS 的**，没有引入 Swup 之类的路由库：
`@view-transition { navigation: auto }` 让浏览器在跨文档导航时自动做过渡，
`::view-transition-old/new(root)` 负责进出动画，顶栏用 `view-transition-name: topbar`
钉住、不跟着淡入淡出。代价是必须同源且浏览器支持；不支持时就是一次普通跳转，
没有任何降级成本。访客手动关闭动效时会 `view-transition-name: none` 一并关掉它。

已实现的动效（**全部零 JS**，不挂滚动监听）：

| 效果 | 实现 | 位置 |
|---|---|---|
| 页面切换淡化移位 | `@view-transition` + `m3-page-in/out` | `main.css` |
| 卡片滚入浮现 | `animation-timeline: view()`，`entry 0%→45%` | `.m3-reveal` |
| 卡片错落入场 | 逐张微调 `animation-range` | `.m3-stagger` |
| 顶栏随滚动抬起 | `animation-timeline: scroll(root block)`，`0→96px` | `.topbar` |
| 按钮/图标按钮状态层 | `::after` 叠 `currentColor`，hover 8% / focus 10% / press 12% | `.m3-button`、`.m3-icon-btn` |
| 按钮形状变形 | `:active` 时圆角 12px → 8px | `.m3-button` |
| 壁纸缓慢呼吸 | 18s 环境动效，仅横幅模式 | `body.has-wallpaper::before` |
| 评论加载骨架屏 | 结构与真实评论一致，避免内容到位时布局跳动 | `Comments.svelte` |

六条必须遵守的规则：

1. **`animation-timeline` 必须用长写属性声明。** 写成简写
   `animation: linear both m3-rise-in view()` 时，浏览器解析不了 `view()` 会
   **整条声明作废** —— `animation-name` 静默回退成 `none`，动画完全不跑却不报错；
   而相邻的 `animation-range` 是独立声明仍然生效，排查时极具迷惑性。
   同时必须写 `animation-duration: auto`，写 `0s` 会被当成零时长动画瞬间跑完。
2. **减少动效不能只压时长。** 滚动驱动动画由滚动进度而非 `animation-duration` 驱动，
   只把时长设成 `0.01ms` 关不掉它。`variables.css` 的 reduced-motion 块里额外有
   `animation-timeline: none !important` 把它退回文档时间轴，才能真正停掉。
3. **入场元素默认必须是可见的**，绝不能预设 `opacity: 0`。滚动动效最典型的翻车
   就是初始状态透明、动画因浏览器不支持或用户关了动效而没跑，内容永久消失。
   这里的状态是"可见"，动画只负责把它演进来，且外层有
   `@supports (animation-timeline: view())` + `prefers-reduced-motion: no-preference`
   + `:root:not(.motion-reduced)` 三重守卫。
4. **错落要用 `animation-range` 的微调，不能用 `animation-delay`。** 滚动驱动动画的
   时间轴是滚动进度而非时钟，`animation-delay` 会被忽略。
   做法是逐张把入场区间起点往后推 2%：`entry -2%/0%/2%/4%/6%`。
5. **错落选择器必须匹配元素自己**，不是它的后代。`ArticleCard` 的根元素同时是
   `.m3-stagger` 的直接子元素**和** `.m3-reveal` 的载体，所以选择器是
   `.m3-stagger > .m3-reveal:nth-child(n)`；写成 `> *:nth-child(n) .m3-reveal`
   （后代组合器）会**一条都匹配不上**，错落静默失效、页面上看不出任何异常。
   `verify:visual` 里有一条断言专门比对"每张卡片的 range 是否互不相同"来兜住它。
6. **`animation-range` 里 `0%` 可以被省略**（`entry entry 45%` 等价于
   `entry 0% entry 45%`），构建工具会顺手压掉它，属正常现象、不是 bug。

## 性能契约：默认访客零 JS 负担

这是本项目最重要的一条设计约束，改动时请勿破坏：

- **出厂配色在构建期算好**，直接以 `<style id="jyuanblog-theme">` 内联进 HTML。
  默认访客**不下载任何配色代码**就有正确颜色。
- 访客改配色时，引擎（约 88KB）才通过**动态 import** 加载，算出的 CSS 缓存进
  `localStorage`；刷新时内联脚本直接注入缓存，**不再次加载引擎、也不闪烁**。
- 因此 `theme.ts` 绝不能 import `mc-utils.ts`——一旦引入，引擎会与该模块打进
  同一个 chunk，懒加载失效。需要引擎请走 `theme-engine.ts`。

可用这条命令自查（应全部为 0）：

```bash
node -e "const h=require('fs').readFileSync('dist/index.html','utf8');
console.log('外部脚本数:', (h.match(/<script[^>]*src=/g)||[]).length,
            '| 含引擎:', h.includes('SchemeTonalSpot'))"
```

## 账号与评论

前台有两个轻量页面：`/login` 与 `/register`，表单是 Svelte 岛（`client:load`），
页面壳仍是静态 HTML。会话存 `localStorage`，键为 `jyuanblog:user-token` /
`jyuanblog:user-profile`（见 `src/lib/session.ts`）。

> ⚠️ **前台与后台用不同的存储键**。后台（Vue）用 `jyuanblog_token`。
> 刻意不共用：否则"注册一个访客账号"与"登录管理后台"会共享同一份会话状态，
> 容易造成权限边界上的误解。

评论区（`Comments.svelte`）的行为：

- **未登录：没有表单，只有登录引导**（`/login` 与 `/register` 两个按钮）。
  这是服务端渲染出来的，禁用 JS 或首屏未水合时也能看到 —— 不会出现
  "能填但提交了才被拒"的挫败感。
- 已登录：**隐藏昵称输入框**，提交时不发送作者名 —— 后端一律以账号名为准。
  这里不发是为了让"署名不可伪造"这件事在代码里一眼可见，而不是靠后端静默覆盖。
- 提交遇 401/403 会清掉本地会话并提示重新登录 —— 令牌过期或被封禁时，
  界面必须跟着回到未登录态，否则用户会对着一个永远提交失败的框反复试。
- 顶栏的账号入口（`TopAppBar.astro` 里的内联脚本）直接读 localStorage 改文案，
  **没有为此水合一个岛** —— 顶栏每页都渲染，为一个文字替换破坏零 JS 契约不划算。

安全相关的实现细节（密码散列、限流分档、防枚举、防冒充）见根 README 的安全章节。

## 环境变量

Astro 只把 **`PUBLIC_`** 前缀的变量注入客户端（Vite 的 `VITE_` 在这里不生效）：

| 变量 | 侧 | 说明 |
|---|---|---|
| `JYUANBLOG_API_URL` | 构建期 | `astro build` 拉文章用，如 `https://jyuanblog.cc.cd/api` |
| `PUBLIC_API_BASE_URL` | 客户端 | 评论区用。**留空即回退 `/api`**，线上同源推荐保持默认 |
| `JYUANBLOG_ALLOW_FALLBACK` | 构建期 | 设为 `1` 才允许 API 不可达时用示例数据继续构建 |

> 生产构建下 API 不可达会**直接中止**（避免把占位文章当真实内容发布）。
> 只有明确需要离线构建时才设 `JYUANBLOG_ALLOW_FALLBACK=1`。

## 已知坑

**`@material/material-color-utilities@0.4.0` 无法被 Node 直接加载。**
该包 45 个文件里有 40 个使用省略扩展名的相对 import（如 `./dynamic_color`），
Node 的严格 ESM 解析器会报 `ERR_MODULE_NOT_FOUND`；上游用宽松解析器/pnpm 所以没暴露。

处理方式：已用 esbuild 预打包为 `src/lib/vendor/material-color.mjs`。
上游升级后需重新生成：

```bash
npx esbuild node_modules/@material/material-color-utilities/index.js \
  --bundle --format=esm --platform=neutral \
  --outfile=src/lib/vendor/material-color.mjs
```

**`_redirects` 里 SPA 兜底必须放在资源放行规则之后。** 见上文构建章节：
只写 `/admin/*  /admin/  200` 会把 `/admin/assets/*.js` 也重写成 HTML，后台白屏。

**评论区在预览域下的基址。** 默认相对 `/api` 只在正式域名成立（Worker 路由绑在那里）。
组件会在「当前域 ≠ 正式域」时自动回退到正式域名的绝对地址，因此预览部署也能用。

**CSS 的失败是静默的。** 选择器写错只是"这条规则一条都匹配不上"，页面不报错、
不崩、控制台干净 —— 本轮就踩到过两次：错落选择器用了后代组合器
（`.m3-stagger > *:nth-child(n) .m3-reveal`）而 `.m3-reveal` 本来就是直接子元素，
导致错落入场全部失效；以及 `.prose` 的行宽用了 `68ch`，中文下只有 586px，
比标题和封面都窄。两者肉眼都不容易发现。**改完样式请跑一次观感回归**：

```bash
npx wrangler pages dev dist --port 8790 --ip 127.0.0.1   # 另开一个终端
npm run verify:visual -- http://127.0.0.1:8790
```

也可以直接对线上跑（只读）：`npm run verify:visual -- https://jyuanblog.cc.cd`。
需要本机有 Edge/Chrome（脚本自动查找，或用 `CHROME_PATH` 指定）。

## 构建与部署

```bash
JYUANBLOG_API_URL=https://jyuanblog.cc.cd/api npm run build   # astro → pagefind → /admin
npx wrangler pages deploy dist --project-name=jyuanblog --branch=main
```

`npm run build` 里的 `scripts/merge-admin.mjs` 会把 `../jyuanblog-frontend/dist-admin`
复制成 `dist/admin/`，并写 `_redirects`。**不要跳过它、也不要直接跑 `astro build` 后部署**
——`astro build` 会清空 `dist`，单独部署等于删掉线上后台。

后台产物需先构建（base 必须为 `/admin/`）：

```bash
cd ../jyuanblog-frontend
MSYS_NO_PATHCONV=1 npx vite build --base=/admin/ --outDir dist-admin --emptyOutDir
```

`MSYS_NO_PATHCONV=1` 在 Windows/Git Bash 下必需，否则 `/admin/` 会被 MSYS 改写成
`C:/Program Files/Git/admin/`，导致所有资源路径 404。

### 安全响应头与 CSP

`merge-admin.mjs` 同时生成 `_headers`（CSP、HSTS、COOP/CORP、
Permissions-Policy、后台 `X-Robots-Tag` 等）。**CSP 用的是内联脚本哈希，不是
`'unsafe-inline'`** —— 哈希在构建期从最终产物里现算，所以：

> ⚠️ **只要新增或修改任何内联 `<script>`，就必须重跑构建再部署。**
> 哈希会变，用旧的 `_headers` 部署会让那个脚本被 CSP 拦下（页面可能直接不工作）。
> 哈希提取逻辑若命中 0 条会直接让构建失败，就是为了避免这种静默失效。

后台的 CSP 比前台更严（`script-src 'self'`），所以后台页面会拦掉 Cloudflare
自动注入的 Web Analytics beacon（一条控制台报错）。这是**有意的**：登录页是管理员
输入密码的地方，不该让第三方 CDN 脚本在此执行。详见根 README 的安全章节。

## 后续可做

- 图片优化：本地图片接 `astro:assets` 生成 AVIF/WebP + srcset
- 部署钩子：文章发布后自动触发前台重建
- 深浅色 OG 图、按文章动态生成
- Markdown 增强：数学公式（katex）、图表（mermaid）、代码块行号
