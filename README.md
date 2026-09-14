# JyuanBlog Astro 前台

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

| 元素 | 圆角 |
|---|---|
| 按钮、输入框 | `--shape-corner-m` (12px) |
| 卡片 | `--shape-corner-l` (16px) |
| chip | `--shape-corner-s` (8px) |
| 浮层 / 对话框 / 搜索栏 | `--shape-corner-xl` (28px) |

**对比度契约**：正文 ≥ 4.5:1，大字与边界 ≥ 3:1；`--primary` 只能配 `--on-primary`，
`--primary-container` 只能配 `--on-primary-container`。

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

## 环境变量

Astro 只把 **`PUBLIC_`** 前缀的变量注入客户端（Vite 的 `VITE_` 在这里不生效）：

| 变量 | 侧 | 说明 |
|---|---|---|
| `JYUANBLOG_API_URL` | 构建期 | `astro build` 拉文章用，如 `https://jyuanblog.cc.cd/api` |
| `PUBLIC_API_BASE_URL` | 客户端 | 评论区用。**留空即回退 `/api`**，线上同源推荐保持默认 |

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

## 后续可做

- 图片优化：本地图片接 `astro:assets` 生成 AVIF/WebP + srcset
- 部署钩子：文章发布后自动触发前台重建
- 深浅色 OG 图、按文章动态生成
- Markdown 增强：数学公式（katex）、图表（mermaid）、代码块行号
