<script lang="ts">
  /**
   * 登录 / 注册表单（Svelte 岛）。
   *
   * 前端校验只是为了即时反馈，**权威校验在 Worker 端**——
   * 这里放宽或漏掉的规则，后端都会再挡一次。
   */
  import { SITE } from '@/config/site';
  import { resolveApiBase, saveSession, type SessionUser } from '@/lib/session';

  interface Props {
    mode: 'login' | 'register';
  }
  let { mode }: Props = $props();

  const apiBase = resolveApiBase(SITE.apiBaseUrlClient, SITE.url);

  let username = $state('');
  let password = $state('');
  let password2 = $state('');
  let email = $state('');
  let submitting = $state(false);
  let error = $state('');
  let ok = $state('');

  const isRegister = mode === 'register';

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    ok = '';

    if (isRegister && password !== password2) {
      error = '两次输入的密码不一致';
      return;
    }

    submitting = true;
    try {
      const path = isRegister ? '/auth/register' : '/auth/login';
      const payload: Record<string, string> = { username: username.trim(), password };
      if (isRegister && email.trim()) payload.email = email.trim();

      const res = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || body.code !== 0) {
        error = body.message || `请求失败（HTTP ${res.status}）`;
        return;
      }

      saveSession(body.data.token, body.data.user as SessionUser);
      ok = isRegister ? '注册成功，正在跳转…' : '登录成功，正在跳转…';

      // 管理员账号直接进后台；访客回首页评论区
      const target = body.data.user?.role === 9 ? '/admin/' : '/';
      setTimeout(() => {
        window.location.href = target;
      }, 600);
    } catch (err) {
      error = `网络错误：${(err as Error).message}`;
    } finally {
      submitting = false;
    }
  }
</script>

<form class="auth" onsubmit={submit}>
  <h1 class="type-headline-sm">{isRegister ? '注册账号' : '登录'}</h1>
  <p class="hint type-body-sm">
    {isRegister
      ? '注册后评论会显示你的用户名，且发言额度更宽。'
      : '登录后即可用账号身份参与评论。'}
  </p>

  <label class="field">
    <span class="label type-label-md">用户名</span>
    <input
      class="m3-field"
      bind:value={username}
      required
      minlength="3"
      maxlength="20"
      autocomplete="username"
      placeholder={isRegister ? '3–20 位，字母数字下划线' : ''}
    />
  </label>

  {#if isRegister}
    <label class="field">
      <span class="label type-label-md">邮箱 <em class="opt">（可选，不公开）</em></span>
      <input class="m3-field" type="email" bind:value={email} maxlength="200" autocomplete="email" />
    </label>
  {/if}

  <label class="field">
    <span class="label type-label-md">密码</span>
    <input
      class="m3-field"
      type="password"
      bind:value={password}
      required
      minlength="8"
      maxlength="128"
      autocomplete={isRegister ? 'new-password' : 'current-password'}
      placeholder={isRegister ? '至少 8 位，含字母/数字/符号两类' : ''}
    />
  </label>

  {#if isRegister}
    <label class="field">
      <span class="label type-label-md">确认密码</span>
      <input
        class="m3-field"
        type="password"
        bind:value={password2}
        required
        autocomplete="new-password"
      />
    </label>
  {/if}

  {#if error}<p class="msg err" role="alert">{error}</p>{/if}
  {#if ok}<p class="msg good">{ok}</p>{/if}

  <button class="m3-button m3-button--filled submit" type="submit" disabled={submitting}>
    {submitting ? '提交中…' : isRegister ? '注册' : '登录'}
  </button>

  <p class="switch type-body-sm">
    {#if isRegister}
      已有账号？<a href="/login">去登录</a>
    {:else}
      还没有账号？<a href="/register">注册一个</a>
    {/if}
  </p>
</form>

<style>
  .auth {
    max-width: 420px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--m3e-space-4);
  }

  .hint {
    color: var(--on-surface-variant);
    margin-top: calc(var(--m3e-space-2) * -1);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--m3e-space-2);
  }

  .label {
    color: var(--on-surface-variant);
  }

  .opt {
    font-style: normal;
    opacity: 0.75;
  }

  .submit {
    margin-top: var(--m3e-space-2);
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

  .switch {
    text-align: center;
    color: var(--on-surface-variant);
  }
</style>
