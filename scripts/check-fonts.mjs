/**
 * 字体门禁（npm run fonts:check）。构建只警告，这里才硬失败 ——
 * 因为「产物里没有字体」和「字体偷偷涨到 2 MB」都是不会报错的回归。
 *
 * 四条断言：
 *   1. 子集产物存在、且与 manifest 记录的字节一致（有人手工删过 dist/fonts 会发现）
 *   2. 总体积不超过预算（默认 400 KB，可用 FONT_BUDGET_KB 覆盖）
 *   3. 字符集指纹与当前 dist 内容一致（改了文案没重跑构建 → 新字会掉回系统字体）
 *   4. dist 里没有 TTF/OTF/TTC 源字体、也没有外链字体 CDN
 *      （源字体是构建输入，发出去等于白送 24 MB；外链字体则把访客 IP 泄漏给第三方）
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIST, collectChars } from './build-fonts.mjs';

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const OUT_DIR = join(DIST, 'fonts');
const BUDGET_KB = Number(process.env.FONT_BUDGET_KB ?? 400);

const fail = (msg) => {
  console.error(`fonts:check: ${msg}`);
  process.exit(1);
};

const walk = (dir, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
};

const manifestPath = join(OUT_DIR, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('没有 dist/fonts/manifest.json —— 构建里没跑 build-fonts（或它在缺源字体时跳过了）。跑 npm run fonts:fetch && npm run build');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const files = walk(DIST);
let total = 0;
for (const b of manifest.built) {
  const p = join(OUT_DIR, b.file);
  if (!existsSync(p)) fail(`manifest 声明了 ${b.file}，但产物里没有`);
  const size = statSync(p).size;
  if (size !== b.bytes) fail(`${b.file} 字节数与 manifest 不符（${size} ≠ ${b.bytes}），产物被改过？`);
  total += size;
}
if (manifest.built.length === 0) fail('manifest 里一个子集都没有（源字体缺失？）');

const kb = total / 1024;
if (kb > BUDGET_KB) {
  fail(`子集合计 ${kb.toFixed(1)} KB，超出预算 ${BUDGET_KB} KB。要么收紧字形集（少放几个部件/文案），要么明确改预算再提交`);
}

const now = createHash('sha256').update(collectChars()).digest('hex').slice(0, 16);
if (now !== manifest.charset) {
  fail(`字符集指纹已变（manifest ${manifest.charset} → 当前 ${now}）：改了文案但没重跑字体子集，新字会回落到系统字体`);
}

if (!existsSync(join(OUT_DIR, 'OFL.txt'))) fail('缺 dist/fonts/OFL.txt —— OFL 要求许可证随字体分发');

const badSources = files.filter((f) => /\.(ttf|otf|ttc|woff(?!2)$)$/i.test(f));
if (badSources.length) fail(`产物里混进了源字体格式：\n  ${badSources.map((f) => f.replace(ROOT, '')).join('\n  ')}`);

const cdnRef = files
  .filter((f) => /\.(html|css)$/.test(f))
  .find((f) => /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net\/fonts/i.test(readFileSync(f, 'utf8')));
if (cdnRef) fail(`外链字体（会向第三方泄漏访客 IP）：${cdnRef.replace(ROOT, '')}`);

console.log(
  `fonts:check OK —— ${manifest.built.length} 个子集共 ${kb.toFixed(1)} KB（预算 ${BUDGET_KB} KB），` +
    `字形 ${manifest.chars} 个，字符集指纹 ${now} 与内容一致`
);
