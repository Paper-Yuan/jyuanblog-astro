/**
 * 站点配置 —— 单一真源。
 * 其余模块（布局、feed、sitemap）都从这里取值，避免散落的硬编码。
 */
export const SITE = {
  url: 'https://jyuanblog.cc.cd',
  title: '千机志',
  subtitle: '记录技术、写作与生活',
  description: '千机志 —— 一个采用 Material 3 Expressive 设计的个人博客，记录技术、写作与生活。',
  author: 'Jyuan',
  /** 侧栏名片头像。留空则回退为首字色块（不请求任何外部图片） */
  avatar: '',
  /** 站点起始日期，用于侧栏「运行天数」 */
  startDate: '2024-01-01',
  lang: 'zh-CN',
  timeZone: 'Asia/Shanghai',

  /**
   * 客户端（Svelte/CSS 岛）调用的 API 地址。
   *
   * ⚠️ Vite 只把 VITE_/PUBLIC_ 前缀的变量注入客户端代码，其他名字在浏览器里是 undefined。
   *    默认值故意用相对路径 '/api'：线上前后端同域（jyuanblog.cc.cd/api），
   *    相对路径即同源请求 —— 完全不过 CORS，也不会写死域名。
   *    本地开发用 .env 里的 PUBLIC_API_BASE_URL 指到 wrangler dev。
   */
  apiBaseUrlClient: import.meta.env.PUBLIC_API_BASE_URL || '/api',

  /** 管理后台（现有 Vue 应用）地址 */
  adminUrl: import.meta.env.JYUANBLOG_ADMIN_URL || '/admin',

  /** 每页文章数 */
  pageSize: 8,
} as const;

/**
 * 主导航。
 *
 * 注意：`/timeline` 是否真的存在由 `TIMELINE.enable` 决定
 * （见 `src/config/timeline.ts`）。关掉时间线时**必须同时**把这一项注释掉，
 * 否则会出现一个 404 的导航项 —— 两者是分开的开关，没有自动联动，
 * 因为导航也包含不走这套开关的静态页。
 *
 * 2026-09-19：「分类」「标签」两条从这里退场。它们各自曾是一个列表页 +
 * 一个明细页（共 4 个路由），内容与常驻悬浮栏完全重复；现在统一收进
 * 归档页的筛选态（`/archives?category=` / `?tag=`），旧地址由 _redirects 301。
 */
export const NAV = [
  { label: '首页', href: '/' },
  { label: '博客', href: '/blog' },
  { label: '时间线', href: '/timeline' },
  { label: '归档', href: '/archives' },
  { label: '搜索', href: '/search' },
] as const;

/**
 * 默认主题种子。
 * hue 315 = 粉紫（Shirone 默认），偏二次元的柔和气质；
 * 想更中性可用 262（紫）或 240（蓝）。
 */
export const THEME_DEFAULTS = {
  hue: 315,
  style: 'tonalSpot' as const,
  spec: '2025' as const,
  mode: 'auto' as const,
  wallpaper: 'banner' as const,
  layout: 'grid' as const,
  texture: 'none' as const,
  textureOpacity: 0.12,
  reduceMotion: false,
} as const;
