/**
 * llms 导出共用的数据准备。
 *
 * 放在 lib 而不是某个 `.ts` 端点里：Astro 的 `src/pages/*.ts` 是端点模块，
 * 从一个端点 import 另一个端点会连带求值它的模块级副作用，且语义上也不对。
 * 两个端点都从这里取数据，保证过滤规则**只有一份**。
 *
 * ★ 安全核心：文章来自公开 API `/articles`，其 SQL 已带 `published = 1`。
 *   这里再写一遍"是否已发布"的判断只会造成"防线在这"的错觉 ——
 *   真正的防线在 API 那一层。这里只处理"公开但被主动排除"的标签/分类。
 */
import { getAllArticles, type Article } from '@/lib/api';
import { SITE } from '@/config/site';
import { LLMS, isExcluded } from '@/config/llms';

/** 需要导出的文章（已按配置剔除） */
export async function visibleArticles(): Promise<Article[]> {
  const all = await getAllArticles();
  return all.filter((a) => !isExcluded(a));
}

/** 站点自我介绍：配置优先，留空回退副标题 */
export function siteSummary(): string {
  return LLMS.siteSummary || SITE.subtitle;
}

/**
 * 把 Markdown 正文压成适合放进纯文本导出的形态。
 *
 * 为什么不用 renderMarkdown 再剥 HTML：那要先渲染成 HTML 再转回文本，
 * 多一次转换就多一个注入面，而且会丢掉代码块的围栏（对 AI 反而更有用）。
 * 这里直接对原始 Markdown 做最小清理。
 *
 * ★ 剥离所有尖括号标签：文章理论上只由站长撰写，但可能是从别处粘贴来的。
 *   `<llm-only>` / `<llm-exclude>` 这类标记（Shirone 的约定）本仓库不产出，
 *   但万一将来粘贴进 HTML，导出纯文本时不该原样泄漏成一个"看起来像标签"的东西。
 *   注意这是**文本清理，不是 XSS 防线** —— 导出物是 text/plain，不经过 set:html。
 */
export function plainText(markdown: string): string {
  return String(markdown ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export { isExcluded };
