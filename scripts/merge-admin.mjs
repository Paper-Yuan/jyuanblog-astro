/**
 * 把 Vue 后台（jyuanblog-frontend 的 /admin 构建）并入 Astro 静态产物，
 * 并生成 Cloudflare Pages 的 _redirects 与 _headers。
 *
 * 为什么要合并：前台迁到 Astro 后仍复用同一个 Pages 项目 jyuanblog，
 * 而 astro build 会清空 dist —— 直接部署会把原有 /admin 一起抹掉。
 * 所以每次「构建 → 合并 → 部署」三步走，后台始终跟着上线。
 *
 * 约束一：后台内不能带 `/*  /index.html  200` 的 SPA 兜底，那会劫持 Astro 的全部路由。
 * 约束二：后台 base 必须是 /admin/，否则资源路径会指到站点根。
 * 约束三：SPA 兜底只能写成 `/admin/*  /admin/  200`。
 *
 * 约束三是踩坑换来的：Pages 对 `.html` 结尾的重写目标会做 clean-URL 规范化 ——
 * 写 `/admin/index.html` 会 404，写 `/admin/app.html` 会变成 308 跳到 `/admin/app`。
 * 指向「目录」则正常（目录的 index.html 直接命中，无需规范化）。
 *
 * 约束四：/admin/assets/* 必须先于 SPA 兜底放行。否则兜底会把 JS/CSS 也重写成
 * index.html，浏览器按 text/html 解析脚本，后台直接白屏。
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASTRO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ASTRO_DIR, 'dist');
const ADMIN_SRC = join(ASTRO_DIR, '..', 'jyuanblog-frontend', 'dist-admin');
const ADMIN_DEST = join(DIST, 'admin');

/** 正式域名。评论区的跨源回退、CSP 白名单都以它为准。 */
const SITE_ORIGIN = 'https://jyuanblog.cc.cd';

if (!existsSync(DIST)) {
  console.error('dist 不存在，请先运行 astro build');
  process.exit(1);
}
if (!existsSync(join(ADMIN_SRC, 'index.html'))) {
  console.error(`后台产物缺失：${ADMIN_SRC}/index.html`);
  console.error('请先在 jyuanblog-frontend 执行：');
  console.error('  MSYS_NO_PATHCONV=1 npx vite build --base=/admin/ --outDir dist-admin --emptyOutDir');
  process.exit(1);
}

// 校验 base 正确，避免部署出一个资源全 404 的后台
const adminHtml = readFileSync(join(ADMIN_SRC, 'index.html'), 'utf8');
if (!adminHtml.includes('"/admin/assets/')) {
  console.error('后台 index.html 的资源路径不是 /admin/ 前缀，base 配置有问题');
  process.exit(1);
}

rmSync(ADMIN_DEST, { recursive: true, force: true });
cpSync(ADMIN_SRC, ADMIN_DEST, { recursive: true });

// ============================================================
// 让后台与访客前台同色同形
// ============================================================
//
// 后台的 tokens.css 是真源 variables.css 的生成副本，里面只有语义层
// （--primary: var(--mc-primary, oklch 回退)）。真正的 --mc-* 数值由 HCT 引擎
// 在构建期算出、写进前台那节 <style id="jyuanblog-theme">。不把它一起注入，
// 后台就只落到 oklch 回退值 —— 于是"同一套设计系统"在两个 zone 里其实是两套。
//
// 顺带注入 @font-face：子集字体在 /fonts/ 下（绝对路径，后台也拿得到），
// 但字族不声明就没人用，标题会静默回落系统字。
function injectFrontendTokens() {
  const home = readFileSync(join(DIST, 'index.html'), 'utf8');

  const theme = home.match(/<style id="jyuanblog-theme"[^>]*>[\s\S]*?<\/style>/);
  if (!theme) {
    console.error('merge-admin: 前台产物里找不到 <style id="jyuanblog-theme"> —— 后台会退回 oklch 回退色，拒绝静默发布');
    process.exit(1);
  }
  const fontFace = [...home.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].find((m) =>
    m[1].includes('@font-face')
  );
  if (!fontFace) console.warn('merge-admin: 前台没有 @font-face，后台标题将用系统字（fonts:build 跑过了吗？）');

  const dest = join(ADMIN_DEST, 'index.html');
  const original = readFileSync(dest, 'utf8');
  if (original.includes('id="jyuanblog-theme"')) return; // 幂等：重复构建不叠加

  const block = theme[0] + (fontFace ? `\n${fontFace[0]}` : '');
  writeFileSync(dest, original.replace(/<head[^>]*>/, (m) => `${m}\n${block}`));
  console.log(`已注入出厂配色${fontFace ? ' + 品牌字体' : ''} -> dist/admin/index.html`);
}
injectFrontendTokens();

// ============================================================
// CSP：内联脚本哈希
// ============================================================
//
// 前端有若干构建期生成的**内联**脚本（防闪烁配色、移动端抽屉、Astro 的岛
// 水合初始化）。它们必须在 CSP 里放行，否则页面直接不工作。
//
// 两种放行方式：
//   'unsafe-inline'  简单，但等于放弃对内联脚本注入的防护。
//   sha256-… 哈希     精确到具体脚本内容，注入别的内联脚本仍被拦截。
//
// 这里用哈希，而且是在构建期从**最终产物**里现算的 —— 脚本一变哈希就跟着变，
// 不存在"改了代码忘了更新哈希导致线上白屏"的隐患。
// 代价：引入新的内联脚本（例如改用 View Transitions）必须重跑本脚本。
//
// 前提已验证：产物中没有任何 `createElement('script')` 之类的运行时脚本注入，
// 也没有 eval / new Function，所以不需要 'unsafe-inline' 或 'unsafe-eval'。

function* walkHtml(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkHtml(p);
    else if (entry.name.endsWith('.html')) yield p;
  }
}

function collectInlineScriptHashes() {
  const hashes = new Set();
  for (const file of walkHtml(DIST)) {
    const html = readFileSync(file, 'utf8');
    /*
     * 先剥掉 HTML 注释再提取脚本。
     *
     * 不剥会踩一个**完全静默**的坑：只要注释里出现 script 开标签的字面文本
     * （比如在文档注释里举例说明），正则就会把注释当内联脚本匹配，
     * 于是 ① 哈希的是注释文本（错的值），② 非贪婪匹配一路吃到真正脚本的
     * 结束标签，导致真脚本的内容根本没被哈希。结果是线上脚本被 CSP 拦下，
     * 而构建成功、控制台只在浏览器里报一行违规 —— 排查成本极高。
     * 剥注释同样也更贴合浏览器的实际解析行为。
     */
    const cleaned = html.replace(/<!--[\s\S]*?-->/g, ' ');
    // 只匹配没有 src 的 script，即内联脚本
    for (const m of cleaned.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
      // JSON-LD 是数据块，浏览器不执行它，CSP 也不校验，无需（也不能）哈希 ——
      // 它的内容每页不同，哈希根本没法放进一张全局响应头里。
      if (/application\/ld\+json/i.test(m[1])) continue;
      const digest = createHash('sha256').update(m[2], 'utf8').digest('base64');
      hashes.add(`'sha256-${digest}'`);
    }
  }
  return [...hashes].sort();
}

const inlineHashes = collectInlineScriptHashes();
if (inlineHashes.length === 0) {
  // 命中 0 个几乎一定是匹配逻辑坏了。此时若照常生成 CSP，会把所有内联脚本
  // 全部拦掉 —— 配色、移动端导航、岛水合全废。宁可让构建失败。
  console.error('未能从产物中提取到任何内联脚本哈希，CSP 会导致页面失效，已中止。');
  process.exit(1);
}

/**
 * 前端 CSP。
 *
 * 几处非默认值的原因：
 *   script-src  'wasm-unsafe-eval' —— Pagefind 的全文检索依赖 WASM，
 *               现代浏览器要求显式放开才允许编译 WebAssembly，否则搜索直接坏掉。
 *   script-src  static.cloudflareinsights.com —— Cloudflare 会对经过其代理的
 *               HTML 自动注入 Web Analytics 的 beacon.min.js（该 zone 开着此功能）。
 *               不放行的话它每个页面都会报一条 CSP 违规，分析数据也收不到。
 *               若不需要站点分析，去控制台关掉该功能后可把这两处一起删掉。
 *   style-src   'unsafe-inline'    —— 必需：主题引擎会在运行时
 *               createElement('style') 注入访客配色，且 HTML 里有内联 <style>。
 *               style 注入的危害远低于脚本注入，这个取舍是接受的。
 *   img-src     images.unsplash.com —— 文章封面托管在 Unsplash。
 *   connect-src 允许正式域 —— 预览部署（*.pages.dev）调 API 属跨源；
 *               cloudflareinsights.com 是上面那个 beacon 的回传地址。
 *   worker-src  'self' —— Pagefind 从同源加载 pagefind-worker.js。
 *   frame-ancestors 'none' —— 防点击劫持。注意：CSP 规范规定 meta 标签里的
 *               frame-ancestors 会被忽略，所以这条必须走 HTTP 响应头（本文件即是）。
 */
function buildCsp({ scriptSrc, workerSrc }) {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: https://images.unsplash.com`,
    "font-src 'self'",
    `connect-src 'self' ${SITE_ORIGIN} https://cloudflareinsights.com`,
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `worker-src ${workerSrc}`,
    'upgrade-insecure-requests',
  ].join('; ');
}

const CF_INSIGHTS = 'https://static.cloudflareinsights.com';

const FRONTEND_CSP = buildCsp({
  scriptSrc: `'self' ${CF_INSIGHTS} ${inlineHashes.join(' ')} 'wasm-unsafe-eval'`,
  workerSrc: "'self'",
});

/**
 * 后台 CSP：比前台更严。
 *
 * Vue 的生产构建没有内联脚本、没有 WASM，所以 script-src 只要 'self'，
 * 连前台那串哈希都不需要。后台是持有管理员令牌的敏感面，收紧得越彻底越好。
 * 同样不放行 Cloudflare Insights —— 后台页面没有分析价值，少一个第三方脚本更好。
 */
const ADMIN_CSP = buildCsp({
  scriptSrc: `'self'`,
  workerSrc: "'self'",
});

/** 所有响应共用的安全头。 */
const BASE_HEADERS = [
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  // HSTS：强制后续访问走 HTTPS，抵御 SSL 剥离。
  // 刻意不加 preload —— preload 列表移除流程很麻烦，收益也有限。
  '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
  // frame-ancestors 已覆盖现代浏览器；这条兼顾老浏览器
  '  X-Frame-Options: DENY',
  // 隔离跨源窗口引用，避免 window.opener 被反向控制
  '  Cross-Origin-Opener-Policy: same-origin',
  // 我们的静态资源只服务于本站，禁止被别的站点当子资源引用（防热链与嗅探）
  '  Cross-Origin-Resource-Policy: same-origin',
];

writeFileSync(
  join(DIST, '_redirects'),
  [
    '# 后台静态资源必须先于 SPA 兜底放行。',
    '# 只写 /admin/* -> /admin/ 会连 /admin/assets/*.js 一起吃掉，',
    '# 那些请求会拿到 index.html（MIME 变成 text/html），后台白屏。',
    '/admin/assets/*        /admin/assets/:splat        200',
    '/admin/favicon.svg    /admin/favicon.svg          200',
    '',
    '# 其余 /admin 下的路径回退到后台 SPA；',
    '# 千万不要写 /* -> /index.html，那会把前台所有路由都吃进 Vue。',
    '# 重写目标必须是目录（带尾斜杠）：指向 .html 会被 Pages 规范化成 404/308。',
    '/admin/*               /admin/                     200',
    '',
  ].join('\n')
);

writeFileSync(
  join(DIST, '_headers'),
  [
    '/*',
    ...BASE_HEADERS,
    `  Content-Security-Policy: ${FRONTEND_CSP}`,
    '',
    '# 后台单独收紧 CSP。Pages 会把同一路径命中的多条规则叠加，',
    '# 同名头出现多次时浏览器按「全部都要满足」处理 —— 所以这里的',
    '# script-src self 是相对上面那条约束、生效的是更严的那份。',
    '# 基础安全头不在这里重复：/* 已经覆盖 /admin，重复设置会把',
    '# HSTS 拼成两个值（形如 "…, …"），那是无效头，浏览器可能整条忽略。',
    '/admin/*',
    `  Content-Security-Policy: ${ADMIN_CSP}`,
    // 后台页面不该进搜索引擎索引（登录页与仪表板都没有收录价值）
    '  X-Robots-Tag: noindex, nofollow',
    '',
    '# 订阅源与站点地图是给机器读的，但不需要索引器把它们当页面收录',
    '/rss.xml',
    '  X-Robots-Tag: noindex',
    '',
    '/atom.xml',
    '  X-Robots-Tag: noindex',
    '',
    '/llms.txt',
    '  X-Robots-Tag: noindex',
    '',
    // llms-full.txt 是两个导出里**含正文**的那个，更需要 noindex ——
    // 否则它会被当成一篇超长页面收录进搜索结果，与单篇正文重复。
    '/llms-full.txt',
    '  X-Robots-Tag: noindex',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/_astro/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/pagefind/*',
    '  Cache-Control: public, max-age=3600',
    '',
    '/*.html',
    '  Cache-Control: public, max-age=0, must-revalidate',
    '',
  ].join('\n')
);

console.log('已并入后台 ->', ADMIN_DEST);
console.log(`内联脚本哈希 ${inlineHashes.length} 条，已写入 _headers（哈希制 CSP，无 unsafe-inline）`);
