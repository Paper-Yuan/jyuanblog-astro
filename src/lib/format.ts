/**
 * 构建期 Markdown 渲染与文本工具。
 *
 * 全部在服务端执行（Astro 构建时），因此客户端不打包 marked。
 * 渲染结果直接是可信 HTML —— 但为稳妥仍过滤掉脚本类标签，
 * 防止管理员粘贴的外部内容带进 script/iframe。
 */
import { marked } from 'marked';
import { SITE } from '@/config/site';

marked.setOptions({ gfm: true, breaks: true });

export interface TocItem {
  depth: number;
  text: string;
  id: string;
}

export interface RenderedMarkdown {
  html: string;
  toc: TocItem[];
  readingMinutes: number;
  wordCount: number;
}

/** 生成 URL 友好的锚点 id（中文保留，其余转连字符） */
function slugifyHeading(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'section';
}

/** 粗略统计：中文按字计，西文按词计 */
export function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ');

  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + words;
}

/** 阅读时长（分钟），按 300 字/分钟估算，最少 1 分钟 */
export function readingMinutes(markdown: string): number {
  return Math.max(1, Math.round(countWords(markdown) / 300));
}

/**
 * 渲染 Markdown，同时抽取标题做 TOC、为标题注入 id 以便锚点跳转。
 */
export function renderMarkdown(markdown: string): RenderedMarkdown {
  const src = String(markdown ?? '');
  const toc: TocItem[] = [];
  const usedIds = new Map<string, number>();

  const renderer = new marked.Renderer();
  const originalHeading = renderer.heading.bind(renderer);

  renderer.heading = function (token) {
    const raw = this.parser.parseInline(token.tokens);
    let id = slugifyHeading(token.text);
    // 同名标题加序号，保证锚点唯一
    const seen = usedIds.get(id) ?? 0;
    usedIds.set(id, seen + 1);
    if (seen > 0) id = `${id}-${seen}`;

    if (token.depth === 2 || token.depth === 3) {
      toc.push({ depth: token.depth, text: token.text, id });
    }
    return `<h${token.depth} id="${id}">${raw}</h${token.depth}>\n`;
  };

  let html = marked.parse(src, { renderer, async: false }) as string;

  // 防御性清理：即使内容来自自己的后台，也不允许这些标签进入静态页面
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 外链补 rel，避免被当作 referrer 泄露来源
  html = html.replace(
    /<a href="(https?:\/\/[^"]+)"/gi,
    '<a href="$1" rel="noopener noreferrer" target="_blank"'
  );

  return {
    html,
    toc,
    readingMinutes: readingMinutes(src),
    wordCount: countWords(src),
  };
}

// ---------------------------------------------------------------- 格式化

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: SITE.timeZone,
  }).format(d);
}

export function compactNumber(n: number | null | undefined): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 10000).toFixed(1)}w`;
}

/** 从 Markdown 正文提取纯文本摘要 */
export function excerptFrom(markdown: string, max = 140): string {
  const text = String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 按年月归档分组 */
export function groupByMonth<T extends { createdAt: string }>(
  items: T[]
): { key: string; year: string; month: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const d = new Date(item.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => ({
      key,
      year: key.slice(0, 4),
      month: key.slice(5, 7),
      items: list,
    }));
}

/** 估算封面图的主色，用作占位背景（避免 CLS 时白闪） */
export function placeholderTint(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h} 40% 88%)`;
}
