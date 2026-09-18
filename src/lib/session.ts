/**
 * 访客账号的本地会话管理。
 *
 * 令牌存 localStorage，与后台（jyuanblog-frontend）用同一套字段名，
 * 但**分开放**：后台令牌只给管理界面用，访客令牌只给前台评论区用。
 * 混用会导致"随便注册一个账号就能进后台"的错觉式风险，
 * 所以这里刻意用不同的 key。
 */
export const TOKEN_KEY = 'jyuanblog:user-token';
export const USER_KEY = 'jyuanblog:user-profile';

export interface SessionUser {
  id: number;
  username: string;
  nickname: string;
  role: number;
  status: number;
}

let cached: SessionUser | null | undefined;

/** 读取当前登录用户（无则 null）。带内存缓存，避免每次渲染都 JSON.parse。 */
export function getCurrentUser(): SessionUser | null {
  if (cached !== undefined) return cached;
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    cached = raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function getToken(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveSession(token: string, user: SessionUser): void {
  cached = user;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    // 通知同页其它岛（设置面板/评论区）刷新登录态
    window.dispatchEvent(new CustomEvent('jyuanblog:auth-changed'));
  } catch {
    /* localStorage 被禁用时静默降级为"仅本次会话有效" */
  }
}

export function clearSession(): void {
  cached = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new CustomEvent('jyuanblog:auth-changed'));
  } catch {
    /* 同上 */
  }
}

/** 解析 API 基址：本地/预览域不是正式域时回退到正式域绝对地址。 */
export function resolveApiBase(configured: string, siteUrl: string): string {
  if (/^https?:\/\//.test(configured)) return configured;
  if (typeof window === 'undefined') return configured;
  const canonical = new URL(siteUrl).origin;
  return window.location.origin === canonical ? configured : canonical + configured;
}
