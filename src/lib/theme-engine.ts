/**
 * 配色引擎入口 —— 唯一会 import mc-utils 的前端模块。
 *
 * 只允许被 **动态 import**：
 *     const { buildThemeCss } = await import('@/lib/theme-engine');
 *
 * 这样 HCT 引擎（约 40KB）只在访客真正改动配色时才下载。
 * 若被静态引入，该模块会和引用者打进同一个 chunk，懒加载即失效。
 *
 * 例外：BaseLayout.astro 静态引入 buildThemeCss 是安全的 —— .astro 是服务端
 * 组件，其 import 永远不进客户端 chunk。出厂配色与运行时配色因此共用同一份
 * 生成逻辑（改一处即可，不会两边算出不同的令牌集）。
 */
import { codeRoleCss, resolveScheme, schemeToCss } from './mc-utils';
import { DEFAULT_SETTINGS, cacheThemeCss, applyThemeCss, type Settings } from './theme';

/** 生成光暗两套 CSS 变量块 + 不翻转的代码块角色 */
export function buildThemeCss(s: Settings): string {
  const light = resolveScheme(s.hue, false, s.style, s.spec);
  const dark = resolveScheme(s.hue, true, s.style, s.spec);
  return [
    schemeToCss(light, ':root'),
    schemeToCss(dark, ':root.dark'),
    codeRoleCss(light),
  ].join('\n\n');
}

/** 算出并立即应用 + 缓存（设置面板的主入口） */
export function applyCustomTheme(s: Settings): void {
  const css = buildThemeCss(s);
  applyThemeCss(css);
  cacheThemeCss(css);
}

/**
 * 页面加载后调用：若访客改过配色但缓存丢了（清缓存/换设备），
 * 用引擎补一份，避免回落到出厂色。
 * 返回是否做了补算。
 */
export function ensureCustomThemeCss(s: Settings): boolean {
  const customized =
    s.hue !== DEFAULT_SETTINGS.hue ||
    s.style !== DEFAULT_SETTINGS.style ||
    s.spec !== DEFAULT_SETTINGS.spec;
  if (!customized) return false;

  let hasCache = false;
  try {
    hasCache = Boolean(localStorage.getItem('jyuanblog:theme-css'));
  } catch {
    hasCache = false;
  }
  if (hasCache) return false;

  applyCustomTheme(s);
  return true;
}
