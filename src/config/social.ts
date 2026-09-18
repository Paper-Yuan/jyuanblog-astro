/**
 * 社交入口配置。
 *
 * ★ 这里的 url 会直接渲染进 `<a href>`，必须过协议白名单 ——
 *   数据文件是手写的，一行 `url: 'javascript:...'` 就是 XSS 入口。
 *   校验逻辑见 `@/lib/url`（用 URL 解析比对 protocol，而非 startsWith）。
 */
import { safeUrl } from '@/lib/url';

export interface SocialLink {
  label: string;
  url: string;
}

/** 改这里即可。留空数组则侧栏名片不渲染社交区。 */
const RAW: SocialLink[] = [
  { label: 'B 站', url: 'https://space.bilibili.com/99201674' },
  { label: 'GitHub', url: 'https://github.com/Zzz-IT/GoclashZ/issues' },
  // RSS 不在此列：订阅源仍由 <head> 里的 <link rel="alternate"> 与页脚提供，
  // 名片区只放"人"的入口，不放格式入口。
];

/** 过滤掉校验不过的条目 —— 宁可少一个入口，也不要留一个可疑的 href */
export const socialLinks: SocialLink[] = RAW.map((l) => {
  const safe = safeUrl(l.url);
  return safe ? { ...l, url: safe } : null;
}).filter((l): l is SocialLink => l !== null);
