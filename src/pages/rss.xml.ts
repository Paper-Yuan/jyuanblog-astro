/**
 * RSS 订阅
 */
import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getAllArticles, getArticle } from '@/lib/api';
import { excerptFrom } from '@/lib/format';
import { SITE } from '@/config/site';

export const GET: APIRoute = async () => {
  const articles = await getAllArticles();

  const items = await Promise.all(
    articles.map(async (a) => {
      const detail = await getArticle(a.id);
      return {
        title: a.title,
        description: a.summary || excerptFrom(detail.content),
        pubDate: new Date(a.createdAt),
        link: `/blog/${a.id}`,
        categories: [...(a.category ? [a.category.name] : []), ...a.tags.map((t) => t.name)],
        author: a.author.name,
      };
    })
  );

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: SITE.url,
    items,
    customData: `<language>${SITE.lang}</language>`,
  });
};
