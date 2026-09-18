/**
 * llms.txt —— 给 AI 助手的内容索引（遵循 llmstxt.org 约定）。
 *
 * 提供一个结构化、纯文本的站点概览，让 LLM 能低成本理解本站有什么内容，
 * 而不必抓整站 HTML。配置见 `src/config/llms.ts`。
 *
 * ★ 安全：文章来自公开 API `/articles`，其 SQL 已带 `published = 1`，
 *   因此**草稿不可能出现在这里**。不要在本地再写一遍"是否已发布"的判断 ——
 *   多一处过滤就多一处写错的地方，而这里写错的代价是草稿被公开给任意爬虫。
 *   这里只需处理"公开但被主动排除"（excludeTags / excludeCategories）。
 */
import type { APIRoute } from 'astro';
import { excerptFrom } from '@/lib/format';
import { SITE } from '@/config/site';
import { LLMS, truncate } from '@/config/llms';
import { visibleArticles, siteSummary } from '@/lib/llms';

export const GET: APIRoute = async () => {
  if (!LLMS.enable) return new Response('Not Found', { status: 404 });

  const articles = await visibleArticles();

  const corePages = LLMS.corePages
    .map((p) => `- [${p.title}](${SITE.url}${p.url})${p.note ? `：${p.note}` : ''}`)
    .join('\n');

  const custom = LLMS.customSections
    .map(
      (s) =>
        `## ${s.title}\n\n${s.items
          .map((i) => `- [${i.title}](${i.url})${i.note ? `：${i.note}` : ''}`)
          .join('\n')}`
    )
    .join('\n\n');

  const body = `# ${SITE.title}

> ${siteSummary()}

## 核心栏目

${corePages}

- RSS：${SITE.url}/rss.xml
- Atom：${SITE.url}/atom.xml
- 全量正文：${SITE.url}/llms-full.txt
- 语言：${SITE.lang}

## 文章（${articles.length} 篇）

${articles
  .map(
    (a) => `### ${a.title}

- URL：${SITE.url}/blog/${a.slug}
- 发布：${a.publishedAt ?? a.createdAt}
- 分类：${a.category?.name ?? '未分类'}
- 标签：${a.tags.map((t) => t.name).join('、') || '无'}
- 摘要：${truncate(a.summary || excerptFrom(a.summary) || '（无）')}`
  )
  .join('\n\n')}
${custom ? `\n${custom}\n` : ''}
## 说明

- 本站正文为中文，技术名词保留英文原词。
- 文章以 Markdown 撰写，代码块使用 \`\`\` 围栏。
- 索引摘要按 ${LLMS.descriptionMaxLength} 字截断；完整正文见 llms-full.txt。
- 如需引用，请注明来源与链接。
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // 与 rss/atom 一致：不希望订阅源被搜索引擎当页面收录
      'X-Robots-Tag': 'noindex',
    },
  });
};
