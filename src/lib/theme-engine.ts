/**
 * 配色引擎入口 —— 唯一会 import mc-utils 的前端模块。
 *
 * 只允许被 **动态 import**：
 *     const { buildThemeCss } = await import('@/lib/theme-engine');
 *
 * 这样 HCT 引擎（约 40KB）只在访客真正改动配色时才下载。
 * 若被静态引入，该模块会和引用者打进同一个 chunk，懒加载即失效。
 */
import { resolveScheme, schemeToCss } from './mc-utils';
import { DEFAULT_SETTINGS, cacheThemeCss, applyThemeCss, type Settings } from './theme';

/** 生成光暗两套 CSS 变量块 */
export function buildThemeCss(s: Settings): string {
  const light = schemeToCss(resolveScheme(s.hue, false, s.style, s.spec), ':root');
  const dark = schemeToCss(resolveScheme(s.hue, true, s.style, s.spec), ':root.dark');
  return `${light}\n\n${dark}`;
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
