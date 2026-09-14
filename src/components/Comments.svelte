<script lang="ts">
  /**
   * 评论区 —— 客户端从 Worker API 拉取与提交。
   *
   * 静态页不能固化评论，所以这部分必须动态。用 client:visible 让它
   * 滚到视口才启动，首屏不受影响。
   */
  import { SITE } from '@/config/site';

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
    createdAt: string;
  }

  let comments = $state<CommentRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let submitting = $state(false);
  let ok = $state('');

  let form = $state({ authorName: '', content: '', authorEmail: '' });

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
      const res = await fetch(`${SITE.apiBaseUrlClient}/articles/${articleId}/comments?pageSize=50`);
      const body = await res.json();
      if (body.code !== 0) throw new Error(body.message || '加载失败');
      comments = body.data.list ?? [];
    } catch (e) {
      // 网络层失败最常见的原因是本地端口不在 Worker 的 CORS 白名单里，
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
      const res = await fetch(`${SITE.apiBaseUrlClient}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId,
          authorName: form.authorName.trim(),
          content: form.content.trim(),
          authorEmail: form.authorEmail.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (body.code !== 0) throw new Error(body.message || '提交失败');
      form.content = '';
      ok = '评论已发表';
      await load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      submitting = false;
    }
  }

  $effect(() => {
    load();
  });
</script>

<section class="comments">
  <h2 class="type-title-lg head">评论（{comments.length}）</h2>

  <form class="form" onsubmit={submit}>
    <input
      class="m3-field"
      placeholder="你的昵称 *"
      maxlength="50"
      required
      bind:value={form.authorName}
    />
    <input
      class="m3-field"
      type="email"
      placeholder="邮箱（可选，不公开）"
      bind:value={form.authorEmail}
    />
    <textarea
      class="m3-field area"
      rows="4"
      placeholder="说点什么… *"
      maxlength="1000"
      required
      bind:value={form.content}
    ></textarea>

    {#if error}<p class="msg err">{error}</p>{/if}
    {#if ok}<p class="msg good">{ok}</p>{/if}

    <button class="m3-button m3-button--filled submit" type="submit" disabled={submitting}>
      {submitting ? '提交中…' : '发表评论'}
    </button>
  </form>

  {#if loading}
    <p class="state">加载中…</p>
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
              <span class="time">{fromNow(c.createdAt)}</span>
            </div>
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
