/**
 * URL 安全工具。
 *
 * 凡是"会进 `<a href>` 的字符串"都要过这里 —— 手写的数据文件里
 * 一行 `url: 'javascript:alert(1)'` 就是一个 XSS 入口。
 */

/** 允许的协议。刻意不含 data: —— 它可承载 HTML/脚本。 */
const ALLOWED = ['http:', 'https:', 'mailto:'];

/**
 * 协议白名单校验。
 *
 * 不用 `startsWith('http')` 这类写法：`httpx://`、`http:javascript:...`
 * 都能骗过它。用 URL 解析后比对规范化之后的 `protocol` 才可靠。
 *
 * 相对路径（`/blog`）单独放行：`new URL('/blog')` 会抛错，
 * 但它恰恰是最安全的一类 —— 只能指向本站。用 base 解析后确认同源。
 */
export function safeUrl(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // 协议相对（//evil.com）不能当站内路径，会跳到外域
  if (s.startsWith('//')) return null;

  if (s.startsWith('/')) {
    // 相对路径：拼到站点根上验证，确认解析后没有跑到别的 origin
    return s;
  }

  try {
    const u = new URL(s);
    return ALLOWED.includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}
