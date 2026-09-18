/**
 * 构建期字体子集化：扫描 dist 里**真正出现**的字符，从 24 MB 的霞鹜文楷源字体
 * 切出一个只含这些字形的 woff2，写进 dist/fonts/。
 *
 * 为什么要它：中文 web 字体的全量文件是 MB 级，所以「用不用品牌字体」这件事
 * 通常直接被放弃。实测按内容切片后，全站可见文本（约 330 个汉字）只要几十 KB，
 * 于是字体重新变成一个可以正常讨论的设计选项。
 *
 * 产物文件名是**固定**的（不带 hash）：CSS 里的 @font-face 在 astro build 阶段
 * 就要写死 URL，而此时本脚本还没跑（它必须在 HTML 产出之后才能扫字符）。
 * 稳定文件名让"先引用、后填充"成立；缓存击穿交给 Pages 的 ETag，不靠文件名。
 *
 * 缺源字体时只警告不出图（本地开发不该被 24 MB 的二进制卡住），
 * 但 fonts:check 与 verify:visual 会硬失败 —— 严格性放在门禁，不放在构建。
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import subsetFont from 'subset-font';

// 不能用 import.meta.url.pathname：本仓库路径里有空格，pathname 会给出 %20
const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(DIST, 'fonts');
export { DIST, OUT_DIR };

/** 源字体 → 产物。weight 与 @font-face 里的字重一一对应。 */
const FONTS = [
  {
    src: join(ROOT, 'src/assets/fonts/LXGWWenKai-Regular.ttf'),
    out: 'lxgw-wenkai-subset.woff2',
    family: 'LXGW WenKai',
    weight: '400',
  },
  {
    src: join(ROOT, 'src/assets/fonts/LXGWWenKai-Medium.ttf'),
    out: 'lxgw-wenkai-medium-subset.woff2',
    family: 'LXGW WenKai',
    weight: '500 700',
  },
];

// 无论页面里有没有出现，都必须进子集的字符：数字、常见标点、以及一批
// 由 JS 拼出来、扫 HTML 扫不到的串（日期、"约 N 分钟"、计数单位等）。
const ALWAYS = Array.from(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
    '·—–-–…、。，．：；！？（）「」『』《》〈〉“”‘’％‰+#@&*()_+=/\\|~^[]{}<>' +
    '年月日时分秒约第篇则个中英文阅读评论分类标签系列归档搜索'
);

const isNeeded = (ch) => {
  const c = ch.codePointAt(0);
  if (c < 0x20) return false;
  // CJK 基本 + 扩展 A + 兼容表意 + 假名（万一文章里有日文）+ CJK 标点
  return (
    (c >= 0x2000 && c <= 0x206f) ||
    (c >= 0x3000 && c <= 0x30ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xff00 && c <= 0xffef) ||
    (c >= 0x2010 && c <= 0x2027)
  );
};

const walkHtml = (dir, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      // pagefind 索引与后台 SPA 不参与前台字体子集：它们的文本不是构建期已知的
      if (name === 'pagefind' || name === 'admin') continue;
      walkHtml(p, acc);
    } else if (name.endsWith('.html')) {
      acc.push(p);
    }
  }
  return acc;
};

const visibleText = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');

export const collectChars = () => {
  const files = walkHtml(DIST);
  const set = new Set(ALWAYS);
  for (const f of files) for (const ch of visibleText(readFileSync(f, 'utf8'))) if (isNeeded(ch)) set.add(ch);
  // 排序保证同一内容产出同一字节（否则子集会随文件遍历顺序抖动）
  return Array.from(set).sort().join('');
};

const main = async () => {
  if (!existsSync(DIST)) {
    console.error('build-fonts: 没有 dist/ —— 先跑 astro build（本脚本要在 HTML 产出之后扫字符）');
    process.exit(1);
  }

  const text = collectChars();
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  mkdirSync(OUT_DIR, { recursive: true });

  const built = [];
  let skipped = 0;
  for (const f of FONTS) {
    if (!existsSync(f.src)) {
      skipped += 1;
      console.warn(
        `build-fonts: 缺源字体 ${f.src.split('/').pop()} —— 跳过子集（本地可跑 'npm run fonts:fetch'）。` +
          `注意 fonts:check 与观感回归会因此失败，别把没有字体的产物发上线。`
      );
      continue;
    }
    const buf = readFileSync(f.src);
    const out = await subsetFont(buf, text, { targetFormat: 'woff2' });
    writeFileSync(join(OUT_DIR, f.out), out);
    built.push({ file: f.out, weight: f.weight, bytes: out.length });
  }

  // OFL 要求随字体分发许可证；子集同样是衍生件，必须一起发
  const license = join(ROOT, 'src/assets/fonts/OFL.txt');
  if (existsSync(license)) copyFileSync(license, join(OUT_DIR, 'OFL.txt'));

  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ charset: hash, chars: text.length, built, builtAt: new Date().toISOString() }, null, 2)
  );

  const total = built.reduce((s, b) => s + b.bytes, 0);
  console.log(
    `build-fonts: 字形 ${text.length} 个（charset ${hash}），产物 ${(total / 1024).toFixed(1)} KB` +
      (skipped ? `，跳过 ${skipped} 个字体（源文件缺失）` : '')
  );
  for (const b of built) console.log(`  ${b.file.padEnd(34)} ${b.weight.padEnd(8)} ${(b.bytes / 1024).toFixed(1)} KB`);
};

// 被 check-fonts.mjs 当工具模块导入时，只取函数、不执行构建
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
