<script lang="ts">
  /**
   * 评论区 —— 客户端从 Worker API 拉取与提交。
   *
   * 静态页不能固化评论，所以这部分必须动态。
   */
  import { SITE } from '@/config/site';
  import {
    getCurrentUser,
    getToken,
    clearSession,
    resolveApiBase,
    type SessionUser,
  } from '@/lib/session';

  /**
   * 解析出真正可用的 API 基址。
   *
   * 正常情况 `apiBaseUrlClient` 是相对路径 `/api`，与前台同源、不走 CORS。
   * 但相对路径只在「页面本身就部署在正式域名上」时成立：预览域
   * （`*.jyuanblog.pages.dev`、以及自定义域生效前的 `jyuanblog.pages.dev`）
   * 并没有 `/api` 路由 —— Worker 的路由只绑在正式域名上，请求会 404。
   *
   * 所以当页面不在正式域名时，回退到正式域名的绝对地址。Worker 端已对
   * Pages 域放行 CORS，这条回退能让预览环境也完整可用。
   */
  const apiBase = resolveApiBase(SITE.apiBaseUrlClient, SITE.url);

  interface Props {
    articleId: number;
  }
  let { articleId }: Props = $props();

  interface CommentRow {
    id: number;
    articleId: number;
    content: string;
    author: string;
    parentId: number | null;
    likeCount: number;
    /** 是否为注册用户所发（后端只暴露这个布尔值，不暴露 user_id） */
    registered?: boolean;
    createdAt: string;
  }

  let comments = $state<CommentRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let submitting = $state(false);
  let ok = $state('');

  /** 当前登录用户。已登录时昵称由账号决定，不再让访客自填。 */
  let me = $state<SessionUser | null>(getCurrentUser());

  // 表单只保留正文：作者身份完全由服务端依令牌决定
  let form = $state({ content: '' });

  // 同页其它岛登录/登出后同步状态
  $effect(() => {
    const sync = () => {
      me = getCurrentUser();
    };
    window.addEventListener('jyuanblog:auth-changed', sync);
    return () => window.removeEventListener('jyuanblog:auth-changed', sync);
  });

  // 挂载后加载评论（静态页不能固化评论）
  $effect(() => {
    load();
  });

  function logout() {
    clearSession();
    me = null;
  }

  function fromNow(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    return new Date(iso).toLocaleDateString('zh-CN');
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await fetch(`${apiBase}/articles/${articleId}/comments?pageSize=50`);
      const body = await res.json();
      if (body.code !== 0) throw new Error(body.message || '加载失败');
      comments = body.data.list ?? [];
    } catch (e) {
      // 网络层失败的常见原因是本地端口不在 Worker 的 CORS 白名单里，
      // 显式提示，避免界面永远停在"加载中"。
      error = `评论加载失败：${(e as Error).message}`;
    } finally {
      loading = false;
    }
  }

  async function submit(e: Event) {
    e.preventDefault();
    submitting = true;
    error = '';
    ok = '';
    try {
      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      // 只发正文。作者身份完全由服务端根据令牌决定 ——
      // 客户端连"我是谁"都不参与，署名就不可能被伪造。
      const res = await fetch(`${apiBase}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ articleId, content: form.content.trim() }),
      });
      const body = await res.json().catch(() => ({}));

      // 令牌过期/被撤销时后端返回 401：清掉本地会话并让界面切回登录引导，
      // 否则用户会对着一个必然失败的输入框反复点提交。
      if (res.status === 401 || res.status === 403) {
        clearSession();
        me = null;
        throw new Error(body.message || '登录状态已失效，请重新登录');
      }
      if (!res.ok || body.code !== 0) throw new Error(body.message || '提交失败');

      form.content = '';
      ok = '评论已发表';
      await load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<section class="comments">
  <h2 class="type-title-lg head">评论（{comments.length}）</h2>

  {#if me}
    <!-- 已登录：身份由账号决定，不再提供昵称输入框。
         后端同样以账号名为准，即使有人绕过界面改请求也改不了署名。 -->
    <div class="identity">
      <span class="m3-chip">以 <strong>{me.username}</strong> 的身份发言</span>
      <button type="button" class="link-btn" onclick={logout}>退出登录</button>
    </div>

    <form class="form" onsubmit={submit}>
      <textarea
        class="m3-field area"
        rows="4"
        placeholder="说点什么… *"
        maxlength="1000"
        required
        bind:value={form.content}
      ></textarea>

      {#if error}<p class="msg err" role="alert">{error}</p>{/if}
      {#if ok}<p class="msg good">{ok}</p>{/if}

      <button class="m3-button m3-button--filled submit" type="submit" disabled={submitting}>
        {submitting ? '提交中…' : '发表评论'}
      </button>
    </form>
  {:else}
    <!-- 未登录：本站要求登录后才能评论，所以这里不放表单 ——
         放一个提交必失败的输入框只会浪费读者时间。
         直接把门槛和理由讲清楚，并给出入口。 -->
    <div class="gate">
      <p class="gate-title type-title-md">登录后才能评论</p>
      <p class="gate-note type-body-sm">
        这样可以避免匿名刷屏与冒名发言，也能让举报和封禁落到具体账号上。
      </p>
      <div class="gate-actions">
        <a href="/login" class="m3-button m3-button--filled">登录</a>
        <a href="/register" class="m3-button m3-button--outlined">注册新账号</a>
      </div>
    </div>
  {/if}

  {#if loading}
    <!-- 骨架屏：结构与真实评论一致（头像 + 两行文字），
         这样内容到位时布局不跳动，观感比一行"加载中…"稳得多 -->
    <ul class="list" aria-hidden="true">
      {#each [0, 1, 2] as i (i)}
        <li class="item">
          <span class="skeleton skeleton-avatar"></span>
          <div class="body">
            <div class="row">
              <span class="skeleton skeleton-line" style="width: 76px"></span>
              <span class="skeleton skeleton-line" style="width: 48px"></span>
            </div>
            <span class="skeleton skeleton-line" style="width: {88 - i * 12}%"></span>
          </div>
        </li>
      {/each}
    </ul>
    <span class="sr-only">评论加载中</span>
  {:else if comments.length === 0}
    <p class="state">还没有评论，来做第一个吧</p>
  {:else}
    <ul class="list">
      {#each comments as c (c.id)}
        <li class="item">
          <span class="avatar" aria-hidden="true">{c.author.slice(0, 1)}</span>
          <div class="body">
            <div class="row">
              <span class="author">{c.author}</span>
              {#if c.registered}
                <span class="badge" title="注册用户">已注册</span>
              {/if}
              <span class="time">{fromNow(c.createdAt)}</span>
            </div>
            <!-- 文本插值而非 {@html}：评论内容不可信，绝不按 HTML 渲染 -->
            <p class="text">{c.content}</p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .comments {
    margin-top: var(--m3e-space-10);
    padding-top: var(--m3e-space-6);
    border-top: 1px solid var(--outline-variant);
  }

  .head {
    margin-bottom: var(--m3e-space-4);
  }

  /* 已登录时的身份条 */
  .identity {
    display: flex;
    align-items: center;
    gap: var(--m3e-space-3);
    margin-bottom: var(--m3e-space-4);
  }

  .identity strong {
    color: var(--on-surface);
  }

  .link-btn {
    border: none;
    background: none;
    padding: 0;
    color: var(--primary);
    font-size: var(--m3e-label-lg-size);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  /* 未登录时的评论门槛提示 */
  .gate {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--m3e-space-3);
    margin-bottom: var(--m3e-space-6);
    padding: var(--m3e-space-5);
    border: 1px solid var(--outline-variant);
    border-radius: var(--shape-corner-l);
    background: var(--surface-container-low);
  }

  .gate-title {
    color: var(--on-surface);
  }

  .gate-note {
    color: var(--on-surface-variant);
    max-width: 52ch;
  }

  .gate-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--m3e-space-3);
    margin-top: var(--m3e-space-2);
  }

  .badge {
    padding: 1px 6px;
    border-radius: var(--shape-corner-xs);
    background: var(--primary-container);
    color: var(--on-primary-container);
    font-size: var(--m3e-label-sm-size);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--m3e-space-3);
    margin-bottom: var(--m3e-space-6);
  }

  .area {
    height: auto;
    padding: var(--m3e-space-3) var(--m3e-space-4);
    resize: vertical;
    font-family: inherit;
  }

  .submit {
    align-self: flex-start;
  }

  .submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .msg {
    font-size: var(--m3e-body-sm-size);
  }

  .err {
    color: var(--error);
  }

  .good {
    color: var(--primary);
  }

  .list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--m3e-space-4);
  }

  .item {
    display: flex;
    gap: var(--m3e-space-3);
  }

  /* 骨架屏里被 .skeleton-line 替换的两行需要各自占位，
     否则进度条似的细线会挤在一起看不出是"两行" */
  .item .row {
    gap: var(--m3e-space-3);
  }

  .item .body .skeleton-line {
    display: block;
    margin-top: var(--m3e-space-2);
  }

  .item .body .skeleton-line:first-child {
    margin-top: 0;
  }

  /* 只给屏幕阅读器：骨架屏本身 aria-hidden，用这条把状态播报出来 */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: var(--shape-corner-full);
    background: var(--secondary-container);
    color: var(--on-secondary-container);
    font-weight: 600;
  }

  .body {
    flex: 1;
    min-width: 0;
    padding: var(--m3e-space-3) var(--m3e-space-4);
    border-radius: var(--shape-corner-m);
    background: var(--surface-container-low);
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--m3e-space-3);
    margin-bottom: var(--m3e-space-1);
  }

  .author {
    font-weight: 600;
    font-size: var(--m3e-body-md-size);
  }

  .time {
    color: var(--on-surface-variant);
    font-size: var(--m3e-label-sm-size);
  }

  .text {
    color: var(--on-surface-variant);
    font-size: var(--m3e-body-md-size);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .state {
    padding: var(--m3e-space-6) 0;
    text-align: center;
    color: var(--on-surface-variant);
  }
</style>
