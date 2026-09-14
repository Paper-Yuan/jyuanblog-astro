/**
 * Material 3 / M3 Expressive 动态配色引擎。
 *
 * 移植自 Shirone（LyraVoid/Shirone, MIT）的 src/utils/mc-utils.ts —— 一个对
 * Google 官方 `@material/material-color-utilities`（HCT 色彩空间）的薄封装，
 * 使 MD3(2021) 与 M3E(2025) 两版规范、以及全部 9 种 palette style
 * （TonalSpot / Vibrant / Content / Expressive / …）都能解析出真实的 HCT 色调板。
 *
 * 种子色由 `--hue`(0-360) 推导，因此色相滑杆的语义保持不变；
 * 引擎为每个 M3 角色返回具体 hex。
 */
import {
  type DynamicColor,
  type DynamicScheme,
  Hct,
  type MaterialDynamicColors,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeFruitSalad,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
} from './vendor/material-color.mjs';

/**
 * 重新生成 vendor 包的命令（仅在上游升级时才需要）：
 *   npx esbuild node_modules/@material/material-color-utilities/index.js \n *     --bundle --format=esm --platform=neutral \n *     --outfile=src/lib/vendor/material-color.mjs
 * 原因：上游 0.4.0 使用省略扩展名的相对 import，Node 严格 ESM 无法解析。
 */

/** Palette 风格 —— 对应 com.materialkolor 的 PaletteStyle */
export const MC_STYLES = [
  'tonalSpot',
  'vibrant',
  'content',
  'expressive',
  'rainbow',
  'fruitSalad',
  'monochrome',
  'neutral',
  'fidelity',
] as const;
export type McStyle = (typeof MC_STYLES)[number];

/** 设计规范版本 —— 对应 ColorSpec.SpecVersion */
export const MC_SPECS = ['2021', '2025'] as const;
export type McSpec = (typeof MC_SPECS)[number];

export const MC_STYLE_LABELS: Record<McStyle, string> = {
  tonalSpot: '柔和',
  vibrant: '鲜艳',
  content: '内容',
  expressive: '表现',
  rainbow: '彩虹',
  fruitSalad: '果趣',
  monochrome: '单色',
  neutral: '中性',
  fidelity: '保真',
};

/** 种子色用的中间调、中等彩度，保证任何色相都既鲜明又不发灰 */
const SEED_CHROMA = 60;
const SEED_TONE = 50;

/** 由色相(0-360)构造种子 ARGB */
export function seedFromHue(hue: number): number {
  return Hct.from(hue, SEED_CHROMA, SEED_TONE).toInt();
}

/** M3/M3E 色彩角色 -> DynamicColor 解析器 */
const roleMap: Record<string, DynamicColor | undefined> = {
  primary: undefined,
  onPrimary: undefined,
  primaryContainer: undefined,
  onPrimaryContainer: undefined,
  inversePrimary: undefined,
  primaryFixed: undefined,
  primaryFixedDim: undefined,
  onPrimaryFixed: undefined,
  onPrimaryFixedVariant: undefined,
  secondary: undefined,
  onSecondary: undefined,
  secondaryContainer: undefined,
  onSecondaryContainer: undefined,
  secondaryFixed: undefined,
  secondaryFixedDim: undefined,
  onSecondaryFixed: undefined,
  onSecondaryFixedVariant: undefined,
  tertiary: undefined,
  onTertiary: undefined,
  tertiaryContainer: undefined,
  onTertiaryContainer: undefined,
  tertiaryFixed: undefined,
  tertiaryFixedDim: undefined,
  onTertiaryFixed: undefined,
  onTertiaryFixedVariant: undefined,
  error: undefined,
  onError: undefined,
  errorContainer: undefined,
  onErrorContainer: undefined,
  surface: undefined,
  surfaceDim: undefined,
  surfaceBright: undefined,
  surfaceContainerLowest: undefined,
  surfaceContainerLow: undefined,
  surfaceContainer: undefined,
  surfaceContainerHigh: undefined,
  surfaceContainerHighest: undefined,
  onSurface: undefined,
  surfaceVariant: undefined,
  onSurfaceVariant: undefined,
  outline: undefined,
  outlineVariant: undefined,
  inverseSurface: undefined,
  inverseOnSurface: undefined,
  shadow: undefined,
  scrim: undefined,
  surfaceTint: undefined,
  primaryDim: undefined,
  secondaryDim: undefined,
  tertiaryDim: undefined,
  errorDim: undefined,
};

function initRoleMap(colors: MaterialDynamicColors) {
  roleMap.primary = colors.primary();
  roleMap.onPrimary = colors.onPrimary();
  roleMap.primaryContainer = colors.primaryContainer();
  roleMap.onPrimaryContainer = colors.onPrimaryContainer();
  roleMap.inversePrimary = colors.inversePrimary();
  roleMap.primaryFixed = colors.primaryFixed();
  roleMap.primaryFixedDim = colors.primaryFixedDim();
  roleMap.onPrimaryFixed = colors.onPrimaryFixed();
  roleMap.onPrimaryFixedVariant = colors.onPrimaryFixedVariant();
  roleMap.secondary = colors.secondary();
  roleMap.onSecondary = colors.onSecondary();
  roleMap.secondaryContainer = colors.secondaryContainer();
  roleMap.onSecondaryContainer = colors.onSecondaryContainer();
  roleMap.secondaryFixed = colors.secondaryFixed();
  roleMap.secondaryFixedDim = colors.secondaryFixedDim();
  roleMap.onSecondaryFixed = colors.onSecondaryFixed();
  roleMap.onSecondaryFixedVariant = colors.onSecondaryFixedVariant();
  roleMap.tertiary = colors.tertiary();
  roleMap.onTertiary = colors.onTertiary();
  roleMap.tertiaryContainer = colors.tertiaryContainer();
  roleMap.onTertiaryContainer = colors.onTertiaryContainer();
  roleMap.tertiaryFixed = colors.tertiaryFixed();
  roleMap.tertiaryFixedDim = colors.tertiaryFixedDim();
  roleMap.onTertiaryFixed = colors.onTertiaryFixed();
  roleMap.onTertiaryFixedVariant = colors.onTertiaryFixedVariant();
  roleMap.error = colors.error();
  roleMap.onError = colors.onError();
  roleMap.errorContainer = colors.errorContainer();
  roleMap.onErrorContainer = colors.onErrorContainer();
  roleMap.surface = colors.surface();
  roleMap.surfaceDim = colors.surfaceDim();
  roleMap.surfaceBright = colors.surfaceBright();
  roleMap.surfaceContainerLowest = colors.surfaceContainerLowest();
  roleMap.surfaceContainerLow = colors.surfaceContainerLow();
  roleMap.surfaceContainer = colors.surfaceContainer();
  roleMap.surfaceContainerHigh = colors.surfaceContainerHigh();
  roleMap.surfaceContainerHighest = colors.surfaceContainerHighest();
  roleMap.onSurface = colors.onSurface();
  roleMap.surfaceVariant = colors.surfaceVariant();
  roleMap.onSurfaceVariant = colors.onSurfaceVariant();
  roleMap.outline = colors.outline();
  roleMap.outlineVariant = colors.outlineVariant();
  roleMap.inverseSurface = colors.inverseSurface();
  roleMap.inverseOnSurface = colors.inverseOnSurface();
  roleMap.shadow = colors.shadow();
  roleMap.scrim = colors.scrim();
  roleMap.surfaceTint = colors.surfaceTint();
  roleMap.primaryDim = colors.primaryDim();
  roleMap.secondaryDim = colors.secondaryDim();
  roleMap.tertiaryDim = colors.tertiaryDim();
  roleMap.errorDim = colors.errorDim();
}

function buildScheme(style: McStyle, isDark: boolean, seed: number, spec: McSpec): DynamicScheme {
  const hct = Hct.fromInt(seed);
  switch (style) {
    case 'content':
      return new SchemeContent(hct, isDark, 0, spec);
    case 'expressive':
      return new SchemeExpressive(hct, isDark, 0, spec);
    case 'fidelity':
      return new SchemeFidelity(hct, isDark, 0, spec);
    case 'fruitSalad':
      return new SchemeFruitSalad(hct, isDark, 0, spec);
    case 'monochrome':
      return new SchemeMonochrome(hct, isDark, 0, spec);
    case 'neutral':
      return new SchemeNeutral(hct, isDark, 0, spec);
    case 'rainbow':
      return new SchemeRainbow(hct, isDark, 0, spec);
    case 'vibrant':
      return new SchemeVibrant(hct, isDark, 0, spec);
    case 'tonalSpot':
    default:
      return new SchemeTonalSpot(hct, isDark, 0, spec);
  }
}

function argbToHex(argb: number): string {
  return `#${[16, 8, 0]
    .map((shift) => ((argb >> shift) & 0xff).toString(16).padStart(2, '0'))
    .join('')}`;
}

export type McScheme = Record<string, string | null>;

/**
 * 解析给定 色相/风格/规范/明暗 下的全部 M3 角色 hex。
 *
 * 关于 spec：在 @material/material-color-utilities@0.4.0 中
 * `MaterialDynamicColors.colorSpec` 是静态属性，模块加载时即固定为 2025 委托，
 * 因此所有角色（含 *Dim / *Fixed）在 2021 与 2025 下都会解析出值；
 * 两版的实际差异只在调色板派生层，不影响角色集。
 * 仅当 resolver 为 undefined 时返回 null（防御性保留）。
 */
export function resolveScheme(
  hue: number,
  isDark: boolean,
  style: McStyle,
  spec: McSpec
): McScheme {
  const scheme = buildScheme(style, isDark, seedFromHue(hue), spec);
  initRoleMap(scheme.colors);
  const out: McScheme = {};
  for (const name of Object.keys(roleMap)) {
    const dc = roleMap[name];
    if (!dc) {
      out[name] = null;
      continue;
    }
    out[name] = argbToHex(dc.getArgb(scheme));
  }
  return out;
}

/** 角色名（camelCase） -> CSS 变量名（kebab） */
export function roleToCssVar(role: string): string {
  return `--mc-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * 把一套 scheme 渲染成 CSS 变量声明块。
 * 供构建期注入 <style> 使用，避免首屏闪烁。
 */
export function schemeToCss(scheme: McScheme, selector = ':root'): string {
  const decls = Object.entries(scheme)
    .filter(([, v]) => v)
    .map(([role, value]) => `  ${roleToCssVar(role)}: ${value};`)
    .join('\n');
  return `${selector} {\n${decls}\n}`;
}
