/**
 * 站点配置 —— 单一真源。
 * 其余模块（布局、feed、sitemap）都从这里取值，避免散落的硬编码。
 */
export const SITE = {
  url: 'https://jyuanblog.cc.cd',
  title: 'JyuanBlog',
  subtitle: '记录技术、写作与生活',
  description: '一个采用 Material 3 Expressive 设计的个人博客，记录技术、写作与生活。',
  author: 'Jyuan',
  lang: 'zh-CN',
  timeZone: 'Asia/Shanghai',

  /**
   * 构建期（服务端）拉取文章的 API 地址。
   * 这是 Node 侧变量，可以被 astro build 读取；加不加 VITE_ 前缀都可以。
   */
  apiBaseUrl: import.meta.env.JYUANBLOG_API_URL || 'http://127.0.0.1:8787/api',

  /**
   * 客户端（Svelte/CSS 岛）调用的 API 地址。
   *
   * ⚠️ Vite 只把 VITE_ 前缀的变量注入客户端代码，其他名字在浏览器里是 undefined。
   *    默认值故意用相对路径 '/api'：线上前后端同域（jyuanblog.cc.cd/api），
   *    相对路径即同源请求 —— 完全不过 CORS，也不会写死域名。
   *    本地开发用 .env 里的 VITE_API_BASE_URL 指到 wrangler dev。
   */
  apiBaseUrlClient: import.meta.env.PUBLIC_API_BASE_URL || '/api',

  /** 管理后台（现有 Vue 应用）地址 */
  adminUrl: import.meta.env.JYUANBLOG_ADMIN_URL || '/admin',

  /** 每页文章数 */
  pageSize: 8,
} as const;

export const NAV = [
  { label: '首页', href: '/' },
  { label: '博客', href: '/blog' },
  { label: '归档', href: '/archives' },
  { label: '分类', href: '/categories' },
  { label: '标签', href: '/tags' },
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
