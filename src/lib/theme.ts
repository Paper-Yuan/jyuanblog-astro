/**
 * 主题运行时 —— 轻量层。
 *
 * ⚠️ 本模块**不得** import mc-utils（配色引擎约 40KB）。它会被设置面板静态引入，
 *    一旦引入引擎，所有访客都要为设置面板付这份代价，破坏"默认零负担"契约。
 *    需要算配色时，走 theme-engine.ts 的动态 import。
 *
 * 内联脚本（BaseLayout 里）与本模块共享 STORAGE_KEY / CSS_CACHE_KEY / CSS_STYLE_ID
 * 三个契约常量，改动需两处同步。
 */
import { THEME_DEFAULTS } from '@/config/site';

export const STORAGE_KEY = 'jyuanblog:settings';
export const CSS_CACHE_KEY = 'jyuanblog:theme-css';
export const CSS_STYLE_ID = 'jyuanblog-theme';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type WallpaperMode = 'banner' | 'solid';
export type LayoutMode = 'grid' | 'list';
export type TexturePreset =
  | 'none'
  | 'starlight'
  | 'cyber-dots'
  | 'topography'
  | 'geometric'
  | 'sakura';

export const TEXTURE_PRESETS: { value: TexturePreset; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'starlight', label: '星尘' },
  { value: 'sakura', label: '樱花' },
  { value: 'cyber-dots', label: '网点' },
  { value: 'topography', label: '等高线' },
  { value: 'geometric', label: '几何' },
];

/** 与 mc-utils 的 MC_STYLES 对应（此处用宽字符串避免引入引擎的类型） */
export type McStyleName =
  | 'tonalSpot'
  | 'vibrant'
  | 'content'
  | 'expressive'
  | 'rainbow'
  | 'fruitSalad'
  | 'monochrome'
  | 'neutral'
  | 'fidelity';

export interface Settings {
  hue: number;
  style: McStyleName;
  spec: '2021' | '2025';
  mode: ThemeMode;
  wallpaper: WallpaperMode;
  layout: LayoutMode;
  texture: TexturePreset;
  textureOpacity: number;
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  hue: THEME_DEFAULTS.hue,
  style: THEME_DEFAULTS.style,
  spec: THEME_DEFAULTS.spec,
  mode: THEME_DEFAULTS.mode,
  wallpaper: THEME_DEFAULTS.wallpaper,
  layout: THEME_DEFAULTS.layout,
  texture: THEME_DEFAULTS.texture,
  textureOpacity: THEME_DEFAULTS.textureOpacity,
  reduceMotion: THEME_DEFAULTS.reduceMotion,
};

export function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
}

/** 解析实际生效的明暗（auto 时跟随系统） */
export function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 把色彩 CSS 注入（或更新）到 head 里的专用 <style> */
export function applyThemeCss(css: string): void {
  let el = document.getElementById(CSS_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = CSS_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/** 把非色彩类设置写到 <html> 的 data-* 与 class 上（纯 CSS 消费） */
export function applyAttributes(s: Settings): void {
  const root = document.documentElement;
  const effective = resolveMode(s.mode);

  root.classList.toggle('dark', effective === 'dark');
  root.dataset.themeMode = s.mode;
  root.dataset.wallpaper = s.wallpaper;
  root.dataset.layout = s.layout;
  root.dataset.texture = s.texture;
  root.style.setProperty('--texture-opacity', String(s.textureOpacity));
  root.classList.toggle('motion-reduced', s.reduceMotion);
}

export function cacheThemeCss(css: string): void {
  try {
    localStorage.setItem(CSS_CACHE_KEY, css);
  } catch {
    /* 忽略配额/隐私模式错误 */
  }
}

/** 判断访客是否改过配色默认值（决定要不要加载引擎） */
export function isCustomized(s: Settings): boolean {
  return (
    s.hue !== DEFAULT_SETTINGS.hue ||
    s.style !== DEFAULT_SETTINGS.style ||
    s.spec !== DEFAULT_SETTINGS.spec
  );
}
