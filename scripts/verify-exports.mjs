/**
 * 导出端点健全性检查。
 *
 * 核心不变量（本次新增，最要紧的一条）：
 *   **llms-full.txt 里出现的每一个文章 slug，都必须同时出现在公开 API 的
 *   已发布列表里。**
 *
 * 为什么用"子集关系"而不是直接查草稿：脚本运行在构建产物这一侧，
 * 拿不到数据库直连。但公开 API 的 SQL 已经带 `published = 1`，
 * 因此"导出是公开列表的子集"等价于"导出里不可能有草稿" ——
 * 这个断言不需要信任任何本地过滤代码，它验证的是最终结果。
 *
 * 一旦将来有人把 llms 的数据源从公开 API 换成直连数据库、
 * 或误加了 includeUnpublished 之类的参数，这条断言会立刻失败。
 *
 * 用法：node scripts/verify-exports.mjs <distDir> <apiBase>
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const distDir = resolve(process.argv[2] ?? 'dist');
const apiBase = process.argv[3] ?? 'http://127.0.0.1:8787/api';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

// ---- 1. 文件存在 ----
const llmsPath = join(distDir, 'llms.txt');
const fullPath = join(distDir, 'llms-full.txt');

check('llms.txt 已生成', existsSync(llmsPath));
check('llms-full.txt 已生成', existsSync(fullPath));
check('timeline 页面已生成', existsSync(join(distDir, 'timeline', 'index.html')));

if (!existsSync(llmsPath) && !existsSync(fullPath)) {
  console.error('\n两个导出端点都不存在，无法继续校验。');
  process.exit(1);
}

// ---- 2. 结构 ----
const llms = existsSync(llmsPath) ? readFileSync(llmsPath, 'utf8') : '';
const full = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';

check('llms.txt 是 llmstxt 结构（有 H1 与摘要引用行）', /^# .+/m.test(llms) && /^> .+/m.test(llms));

// ---- 3. 核心不变量：导出 ⊂ 已发布 ----
let published = [];
try {
  const res = await fetch(`${apiBase}/articles?pageSize=100`);
  const json = await res.json();
  published = (json?.data?.list ?? []).map((a) => a.slug);
} catch (e) {
  console.error(`\n无法访问公开 API（${apiBase}），跳过子集断言：${e.message}`);
  console.error('（这一条是本脚本最重要的检查 —— 请在有 API 的环境下重跑。）');
  process.exit(2);
}

/** 从导出文本里抽取所有 /blog/<slug> 形式的 slug */
function slugsIn(text) {
  return [...new Set([...text.matchAll(/\/blog\/([A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
}

for (const [label, text] of [
  ['llms.txt', llms],
  ['llms-full.txt', full],
]) {
  const found = slugsIn(text);
  const leaked = found.filter((s) => !published.includes(s));
  check(
    `${label} 中所有 slug 均属已发布文章`,
    leaked.length === 0,
    leaked.length
      ? `疑似泄漏：${leaked.join(', ')}`
      : `${found.length} 篇，全部在公开列表中`
  );
}

// ---- 4. 与公开列表数量一致（不该少） ----
if (full) {
  const found = slugsIn(full);
  check(
    'llms-full.txt 覆盖了全部已发布文章',
    published.every((s) => found.includes(s)),
    `公开 ${published.length} 篇 / 导出 ${found.length} 篇`
  );
}

console.log(
  `\n${fails.length === 0 ? '全部通过' : `${fails.length} 项未通过`}`
);
process.exit(fails.length ? 1 : 0);
