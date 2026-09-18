/**
 * llms-full.txt —— 全量正文汇编（遵循 llmstxt.org 约定）。
 *
 * 与 llms.txt（目录索引）的区别：这里包含每篇文章的**正文**，
 * 便于 AI 深入读取，代价是体积随文章数线性增长。
 * 文章量很大时可在 `src/config/llms.ts` 设 `generateFull: false` 关掉。
 *
 * ★ 安全（与 llms.txt 同一底线）：
 *   1. 文章一律取自公开 API `/articles`（SQL 已带 `published = 1`），
 *      **草稿不会出现在这里**。不在此处重复实现"是否已发布"的判断。
 *   2. 正文用 `plainText()` 剥掉所有尖括号标签后再输出。
 *   3. 响应是 `text/plain`，绝不经过 `set:html`，不构成 XSS 面。
 */
import type { APIRoute } from 'astro';
import { getArticle } from '@/lib/api';
import { excerptFrom } from '@/lib/format';
import { SITE } from '@/config/site';
import { LLMS, truncate } from '@/config/llms';
import { visibleArticles, siteSummary, plainText } from '@/lib/llms';

export const GET: APIRoute = async () => {
  if (!LLMS.enable || !LLMS.generateFull) {
    return new Response('Not Found', { status: 404 });
  }

  const list = await visibleArticles();

  // 逐篇取正文。详情接口同样是公开端点（带 published 过滤）。
  const details = await Promise.all(list.map((a) => getArticle(a.id)));

  const body = `# ${SITE.title} — 全量正文

> ${siteSummary()}

- 站点：${SITE.url}
- 索引：${SITE.url}/llms.txt
- 文章数：${list.length}
- 语言：${SITE.lang}

本文档包含全部公开文章的完整正文。草稿、加密与命中排除标签/分类的内容均不在此列。

${details
  .map((a) => {
    const meta = [
      `- URL：${SITE.url}/blog/${a.slug}`,
      `- 发布：${a.publishedAt ?? a.createdAt}`,
      `- 分类：${a.category?.name ?? '未分类'}`,
      `- 标签：${a.tags.map((t) => t.name).join('、') || '无'}`,
    ].join('\n');
    return `---

## ${a.title}

${meta}

- 摘要：${truncate(a.summary || excerptFrom(a.content) || '（无）')}

${plainText(a.content)}`;
  })
  .join('\n\n')}

---

## 说明

- 本文档由构建期静态生成，内容随每次构建更新。
- 引用请注明来源与对应文章链接。
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': 'noindex',
    },
  });
};
