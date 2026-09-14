/**
 * Atom 订阅
 *
 * Astro 官方没有 Atom 集成，手写一份。相比 RSS 用 ISO 时间与更严格的 id。
 */
import type { APIRoute } from 'astro';
import { getAllArticles } from '@/lib/api';
import { excerptFrom } from '@/lib/format';
import { SITE } from '@/config/site';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async () => {
  const articles = await getAllArticles();
  // 用最新一篇的更新时间作为 feed 的 updated（无文章时退化为构建时间）
  const updated = articles[0]?.updatedAt || new Date().toISOString();

  const entries = articles
    .map((a) => {
      const url = `${SITE.url}/blog/${a.id}`;
      return `  <entry>
    <title type="text">${escapeXml(a.title)}</title>
    <link href="${url}" />
    <id>${url}</id>
    <updated>${new Date(a.updatedAt || a.createdAt).toISOString()}</updated>
    <published>${new Date(a.createdAt).toISOString()}</published>
    <summary type="text">${escapeXml(a.summary || excerptFrom(a.summary))}</summary>
    <author><name>${escapeXml(a.author.name)}</name></author>
${
  a.category
    ? `    <category term="${escapeXml(a.category.name)}" />\n`
    : ''
}${a.tags.map((t) => `    <category term="${escapeXml(t.name)}" />`).join('\n')}
  </entry>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${SITE.lang}">
  <title type="text">${escapeXml(SITE.title)}</title>
  <subtitle type="text">${escapeXml(SITE.subtitle)}</subtitle>
  <link href="${SITE.url}/atom.xml" rel="self" type="application/atom+xml" />
  <link href="${SITE.url}/" rel="alternate" type="text/html" />
  <id>${SITE.url}/</id>
  <updated>${new Date(updated).toISOString()}</updated>
  <generator>Astro</generator>
  <author><name>${escapeXml(SITE.author)}</name></author>
${entries}
</feed>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
};
