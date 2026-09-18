/**
 * 构建期 Markdown 渲染与文本工具。
 *
 * 全部在服务端执行（Astro 构建时），因此客户端不打包 marked / sanitize-html。
 * 渲染结果经 **sanitize-html 白名单**净化后才交给 set:html：
 * 文章正文理论上只由站长撰写，但它可能是从别处粘贴来的，
 * 因此仍按"不可信输入"处理。
 */
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
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

  /**
   * 白名单净化。
   *
   * 这里**替换**掉早期的正则黑名单实现（逐条删 <script>/<iframe>/on* 属性）。
   * 黑名单对 HTML 是不安全的，例如 `<svg/onload=…>` 用斜杠代替空格就绕过了
   * `\son\w+=` 这类模式；畸形标签、编码实体也各有绕过手法。
   * 白名单只放行明确认识的标签与属性，未知的一律丢弃。
   *
   * 注意 allowedAttributes 里 **不允许任何 on* 事件属性**，
   * 也不允许 style —— 前者直接等于 XSS，后者可用来做视觉欺骗。
   * 另外 CSP 里的 script-src 是哈希制，即便漏过一个内联脚本也执行不了，
   * 两层防护是独立生效的。
   */
  html = sanitizeHtml(html, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr', 'blockquote', 'pre', 'code',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'kbd', 'abbr',
      'a', 'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'span', 'div',
    ],
    // 明确不包含 style / class / id 之外的任意属性；on* 一律不在白名单内
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
      // marked 给我们生成的标题锚点 id（TOC 跳转依赖它）
      h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
      code: ['class'],
      pre: ['class'],
      th: ['align'], td: ['align'],
      // 语言标注用（如 task-list 的 checkbox 不开放，故不列 input）
      span: [],
    },
    // 链接协议白名单：挡 javascript: / data: 这类可执行伪协议
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    // 图片只允许 http(s)，避免 data: 图片把大体积内容塞进 HTML
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    // 不解析注释，直接丢弃
    allowedIframeHostnames: [],
    disallowedTagsMode: 'discard',
    transformTags: {
      // 外链统一补 rel：阻止被当作 referrer 泄露来源，并断开 window.opener
      a: (tagName, attribs) => {
        const out = { ...attribs };
        if (out.href && /^https?:\/\//i.test(out.href)) {
          out.rel = 'noopener noreferrer';
          out.target = '_blank';
        } else {
          delete out.target;
        }
        return { tagName, attribs: out };
      },
    },
  });

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

/**
 * 封面图的占位底色（图未加载完时露出）。
 *
 * 关键：必须从**主题色相**派生，而不是对标题做字符串哈希 —— 后者会算出
 * 绿/青等与主题（默认粉紫 315）完全冲突的颜色，看起来像图挂了。
 * 这里只做很小的色相偏移（±12°）与低彩度，保证任何加载态都和谐。
 */
export function placeholderTint(seed: string, hue = 315): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 25;
  const shift = h - 12; // -12 ~ +12
  return `hsl(${(hue + shift + 360) % 360} 32% 90%)`;
}

/**
 * 把用户可控的颜色字符串收敛成"只可能是十六进制色"。
 *
 * 标签色、分类色来自后台数据，会被写进 `style="--tag-color: …"`。
 * 直接透传等于开一个 CSS 注入面：`red; background-image: url(...)` 这类值
 * 能往属性里塞额外声明（CSP 的 style-src 'unsafe-inline' 是放行的）。
 * 只接受 #rgb/#rgba/#rrggbb/#rrggbbaa 四种形态，其余一律当没填 ——
 * 宁可少一个颜色，也不要多一个入口。
 */
export function safeColor(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : undefined;
}
