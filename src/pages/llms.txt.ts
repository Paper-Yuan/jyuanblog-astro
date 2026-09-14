/**
 * llms.txt —— 给 AI 助手的内容索引（遵循 llmstxt.org 约定）。
 *
 * 与 Shirone 的思路一致：提供一个结构化、纯文本的站点概览，
 * 让 LLM 能低成本理解本站有什么内容，而不用抓整站 HTML。
 */
import type { APIRoute } from 'astro';
import { getAllArticles } from '@/lib/api';
import { excerptFrom } from '@/lib/format';
import { SITE } from '@/config/site';

export const GET: APIRoute = async () => {
  const articles = await getAllArticles();

  const body = `# ${SITE.title}

> ${SITE.description}

${SITE.title} 是一个中文个人技术博客，内容涵盖前端、边缘计算与数据库实践。

## 站点信息

- 首页：${SITE.url}/
- 文章列表：${SITE.url}/blog
- 归档：${SITE.url}/archives
- 分类：${SITE.url}/categories
- 标签：${SITE.url}/tags
- RSS：${SITE.url}/rss.xml
- Atom：${SITE.url}/atom.xml
- 语言：${SITE.lang}

## 文章（${articles.length} 篇）

${articles
  .map(
    (a) =>
      `### ${a.title}

- URL：${SITE.url}/blog/${a.id}
- 发布：${a.createdAt}
- 分类：${a.category?.name ?? '未分类'}
- 标签：${a.tags.map((t) => t.name).join('、') || '无'}
- 摘要：${a.summary || excerptFrom(a.summary) || '（无）'}`
  )
  .join('\n\n')}

## 说明

- 本站正文为中文，技术名词保留英文原词。
- 文章以 Markdown 撰写，代码块使用 \`\`\` 围栏。
- 如需引用，请注明来源与链接。
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
