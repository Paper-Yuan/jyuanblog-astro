import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';

import { SITE } from './src/config/site.ts';

/**
 * 关于 @material/material-color-utilities：
 * 上游 0.4.0 的 45 个文件里有 40 个使用省略扩展名的相对 import
 * （如 './dynamic_color'），Node 的严格 ESM 解析器会直接拒绝
 * （ERR_MODULE_NOT_FOUND）。官方仓库用宽松解析器 / pnpm，故上游未暴露。
 *
 * 处理方式：用 esbuild 预打包成 src/lib/vendor/material-color.mjs，
 * 由 mc-utils.ts 直接引用该文件。源码内保留了重新生成的命令注释。
 * 因此本文件不再需要额外的 resolver 插件。
 */

/**
 * 静态前台：所有页面在构建期生成。文章数据由构建期从 Worker API 拉取
 * （见 src/lib/api.ts），因此发新文章后需要重新构建。
 *
 * 管理后台不在这里 —— 它仍由 jyuanblog-frontend（Vue）提供，
 * 通过 /admin 反向代理或独立子域访问。
 */
export default defineConfig({
  site: SITE.url,
  trailingSlash: 'ignore',

  integrations: [
    svelte(),
    sitemap({
      filter: (page) => !page.includes('/admin'),
    }),
  ],

  build: {
    // 小体积样式内联进 HTML，省一次往返（首屏关键 CSS）
    inlineStylesheets: 'auto',
  },

  vite: {
    build: {
      // 产物给 Cloudflare Pages / 任意静态托管，不需要 sourcemap
      sourcemap: false,
    },
    server: {
      /**
       * 开发期把 /api 代理到本地 Worker，这样即使不设 VITE_API_BASE_URL，
       * 客户端用相对路径 /api 也能连通 —— 与线上的同源行为保持一致，
       * 因此本地也不需要 CORS 白名单。
       */
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8791',
          changeOrigin: true,
        },
      },
    },
  },
});
