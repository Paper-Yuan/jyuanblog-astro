/**
 * 构建期数据层：从现有 Worker API 拉取文章。
 *
 * 前台是静态生成的，所以这里只在 `astro build` / `astro dev` 时执行。
 * 发新文章后需要重新构建（或触发部署钩子）。
 *
 * 若 API 不可达，构建不会失败 —— 会退回内置的示例数据，避免"后端挂了
 * 就整站构建不出来"。真实数据回来了自然覆盖。
 */
import { SITE } from '@/config/site';

export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  articleCount?: number;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  color?: string;
  articleCount?: number;
}

export interface Author {
  id: number;
  name: string;
  avatar: string;
}

export interface Article {
  id: number;
  title: string;
  slug: string;
  summary: string;
  coverImage: string;
  author: Author;
  category: Category | null;
  tags: Tag[];
  status: number;
  isTop: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ArticleDetail extends Article {
  content: string;
  contentHtml: string;
}

export interface Paged<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 构建期的服务端 API 基址。
 *
 * 刻意不放进 SITE：SITE 会被客户端岛（Comments.svelte）整对象打进浏览器 bundle，
 * 而本地址在本地开发时是 http://127.0.0.1:8787/api —— 那是构建机内网地址，
 * 泄漏到产物里既无意义也叫人误以为线上要配。此模块只在 .astro frontmatter
 * （Node 侧）被 import，读 import.meta.env 不会进客户端。
 */
const API_BASE_URL = import.meta.env.JYUANBLOG_API_URL || 'http://127.0.0.1:8787/api';

async function apiGet<T>(path: string): Promise<T | null> {
  const url = `${API_BASE_URL}${path}`;
  // 必须带超时：构建期若 API 不可达，不该让 astro build 挂住几分钟才降级
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[api] ${path} -> HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as Envelope<T>;
    if (body.code !== 0) {
      console.warn(`[api] ${path} -> code ${body.code}: ${body.message}`);
      return null;
    }
    return body.data;
  } catch (err) {
    const e = err as Error;
    console.warn(`[api] ${path} -> ${e.name === 'AbortError' ? '超时(8s)' : e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 示例数据
// 仅在 API 不可达时使用，让构建仍能产出可用站点。
const FALLBACK_ARTICLES: Article[] = [
  {
    id: 1,
    title: '欢迎来到千机志',
    slug: 'welcome-to-jyuanblog',
    summary: '这是一个采用 Material 3 Expressive 设计的个人博客。',
    coverImage: '',
    author: { id: 1, name: SITE.author, avatar: '' },
    category: { id: 1, name: '技术', slug: 'tech' },
    tags: [],
    status: 1,
    isTop: true,
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
  },
];

const FALLBACK_DETAIL: ArticleDetail = {
  ...FALLBACK_ARTICLES[0],
  content:
    '# 欢迎来到千机志\n\n本文是离线占位内容。\n\n请确认 Worker API 可访问后重新构建，即可看到真实文章。\n',
  contentHtml: '',
};

/**
 * API 不可达时的处理。
 *
 * 生产构建**绝不能静默用示例数据上线**：那样占位文章会被当成真内容发布，
 * 而且构建还是"成功"的，谁也不会发现。所以这里默认直接中止构建；
 * 确实需要离线构建时才用 JYUANBLOG_ALLOW_FALLBACK=1 显式放行。
 */
function onFallback(what: string): void {
  const allow = import.meta.env.JYUANBLOG_ALLOW_FALLBACK === '1';
  const msg = [
    `[api] ${what}拉取失败。数据源：${API_BASE_URL}`,
    allow
      ? '  JYUANBLOG_ALLOW_FALLBACK=1，退回示例数据继续构建。'
      : '  生产构建已中止，避免把示例数据当成真内容发布。',
    ...(allow ? [] : ['  修好数据源，或设 JYUANBLOG_ALLOW_FALLBACK=1 明确允许降级。']),
  ].join('\n');
  if (import.meta.env.PROD && !allow) throw new Error(msg);
  console.warn(msg);
}

export async function getArticles(params: {
  page?: number;
  pageSize?: number;
  categoryId?: number;
  tagId?: number;
  keyword?: string;
} = {}): Promise<Paged<Article>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? SITE.pageSize));
  if (params.categoryId) qs.set('categoryId', String(params.categoryId));
  if (params.tagId) qs.set('tagId', String(params.tagId));
  if (params.keyword) qs.set('keyword', params.keyword);

  const data = await apiGet<Paged<Article>>(`/articles?${qs}`);
  if (data) return data;

  onFallback('文章列表');
  return {
    list: FALLBACK_ARTICLES,
    total: FALLBACK_ARTICLES.length,
    page: 1,
    pageSize: SITE.pageSize,
    totalPages: 1,
  };
}

/** 拉取全部已发布文章（用于归档/分类/标签聚合与 sitemap） */
export async function getAllArticles(): Promise<Article[]> {
  const first = await getArticles({ page: 1, pageSize: 100 });
  const all = [...first.list];
  for (let p = 2; p <= first.totalPages; p++) {
    const next = await getArticles({ page: p, pageSize: 100 });
    all.push(...next.list);
  }
  return all;
}

export async function getArticle(idOrSlug: string | number): Promise<ArticleDetail> {
  const data = await apiGet<ArticleDetail>(`/articles/${idOrSlug}`);
  if (data) return data;
  onFallback(`文章详情（${idOrSlug}）`);
  return FALLBACK_DETAIL;
}

export async function getCategories(): Promise<Category[]> {
  return (await apiGet<Category[]>('/categories')) ?? [];
}

export async function getTags(): Promise<Tag[]> {
  return (await apiGet<Tag[]>('/tags')) ?? [];
}

export async function getRecommended(limit = 5): Promise<Article[]> {
  return (await apiGet<Article[]>(`/articles/recommended?limit=${limit}`)) ?? [];
}

/** 热门文章（按浏览量，后端 /articles/popular） */
export async function getPopular(limit = 5): Promise<Article[]> {
  return (await apiGet<Article[]>(`/articles/popular?limit=${limit}`)) ?? [];
}

/** 文章详情页的评论由客户端拉取（静态页不能构建期固化评论） */
export async function getComments(articleId: number): Promise<
  { list: CommentRow[] } | null
> {
  return apiGet<{ list: CommentRow[] }>(`/articles/${articleId}/comments?pageSize=50`);
}

export interface CommentRow {
  id: number;
  articleId: number;
  content: string;
  author: string;
  authorEmail?: string;
  parentId: number | null;
  likeCount: number;
  status: number;
  createdAt: string;
}

/** 该 API 是否可达（构建日志用，避免静默降级） */
export async function apiReachable(): Promise<boolean> {
  const data = await apiGet<{ status: string }>('/health');
  return Boolean(data?.status === 'ok');
}

// ---------------------------------------------------------------- 音乐
export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  audioUrl: string;
  duration: number;
  lyric: string;
  playCount: number;
  createdAt: string;
}

/**
 * 取可播放曲目。
 *
 * ★ 这里做了两道过滤，缺一不可：
 *   1. `audioUrl` 非空 —— 后端 `safeMediaUrl()` 会把非法协议清成空串，
 *      所以"地址为空"既表示本来就没填，也表示地址不可信。
 *   2. 只保留 http(s) 或站内相对路径 —— 二次确认（前端不该假设后端一定过了校验）。
 *
 * 返回空数组时，调用方（MusicWidget）**不渲染任何 DOM**，
 * 这样"库里没有歌"与"功能被关掉"在页面上是同一种表现：什么都不显示。
 */
export async function getTracks(): Promise<Track[]> {
  const list = (await apiGet<Track[]>('/music/list')) ?? [];
  return list.filter((t) => {
    const u = String(t.audioUrl ?? '').trim();
    if (!u) return false;
    if (u.startsWith('/') && !u.startsWith('//')) return true;
    try {
      return ['http:', 'https:'].includes(new URL(u).protocol);
    } catch {
      return false;
    }
  });
}
