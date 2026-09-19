/**
 * llms.txt / llms-full.txt 导出配置。
 *
 * 字段与 Shirone 的 `llmsConfig` 对齐（见 SHIRONE-OPTIMIZATION.md 第 2 节）。
 *
 * ★ 安全底线（勿绕开）：两个导出端点**只能包含已发布文章**。
 *   实现上不自己写过滤条件，而是复用公开 API（`/articles`，
 *   其 SQL 已带 `published = 1`）。自己再写一遍过滤条件等于多一处可能写错的地方，
 *   而这里写错的代价是"草稿被公开给任意爬虫"。构建脚本会再断言一次。
 */
export const LLMS = {
  /** 总开关。false 时不产出任何 llms 文件（路由直接 404）。 */
  enable: true,

  /**
   * 是否生成 llms-full.txt（含正文）。
   * 文章量极大时建议关掉：全文汇编的体积会随文章数线性增长。
   */
  generateFull: true,

  /**
   * 站点在大模型眼中的自我介绍。
   * 留空则回退到 SITE.subtitle —— 不要在这里重复描述，那句已经在副标题里了。
   */
  siteSummary: '',

  /** 索引里单篇摘要的截断长度。只影响索引，不影响全量正文。 */
  descriptionMaxLength: 200,

  /**
   * 命中任一标签的文章从**两个端点同时剔除**（即使文章公开）。
   * 用于"公开但不希望进 AI 语料"的内容。
   */
  excludeTags: ['secret', 'private'],

  /** 命中分类的文章彻底排除。 */
  excludeCategories: [] as string[],

  /** 向 AI 重点介绍的核心栏目。 */
  corePages: [
    { title: '文章列表', url: '/blog', note: '全部文章按时间倒序' },
    {
      title: '归档',
      url: '/archives',
      note: '按年月归拢的全部文章；分类与标签筛选走 ?category=slug 与 ?tag=slug',
    },
  ],

  /** 自定义扩展章节（外部项目/API 文档等）。 */
  customSections: [] as { title: string; items: { title: string; url: string; note?: string }[] }[],
} as const;

/**
 * 判断一篇文章是否应被导出。
 *
 * 注意：**草稿过滤不在这里** —— 文章来自公开 API，那一层已经排除了未发布内容。
 * 这里只处理"公开但被主动排除"的情况。若把草稿判断也写进来会给人
 * "这里才是防线"的错觉，而真正的防线在 API 的 SQL 里。
 */
export function isExcluded(article: {
  tags?: { name: string }[];
  category?: { name: string } | null;
}): boolean {
  const tagHit = (article.tags ?? []).some((t) =>
    (LLMS.excludeTags as readonly string[]).includes(t.name)
  );
  const catHit = article.category
    ? (LLMS.excludeCategories as readonly string[]).includes(article.category.name)
    : false;
  return tagHit || catHit;
}

/** 按配置截断。超出补省略号。 */
export function truncate(text: string, max: number = LLMS.descriptionMaxLength): string {
  const t = String(text ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
