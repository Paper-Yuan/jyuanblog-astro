/**
 * 侧栏音乐卡片。
 *
 * 是 Svelte 岛而非 Astro 组件：播放需要状态（当前曲目、播放中、音量、进度），
 * 这部分逻辑没法在构建期固化。用 `client:visible` 水合 —— 侧栏在窄屏会被挤到
 * 主区下方，可能在视口外，此时不该加载播放器代码。
 *
 * ★ 零 DOM 契约：`tracks.length === 0` 时直接返回 null。
 *   于是"库里没有歌"不会留下一个空壳卡片，也不会产生任何音频请求。
 *
 * ★ 切页不续播：本项目是静态多页（每次导航加载新文档），没有 Swup 那样的
 *   持久容器，所以换页后播放会停止。这是架构决定的，不做假承诺。
 */
<script lang="ts">
  import type { Track } from '@/lib/api';
  import { MUSIC } from '@/config/music';

  interface Props {
    tracks?: Track[];
  }

  const { tracks = [] } = $props();

  let index = $state(0);
  let playing = $state(false);
  let volume = $state(MUSIC.defaultVolume);
  let audio = $state<HTMLAudioElement | null>(null);
  let progress = $state(0);

  // tracks 为空时整个组件不渲染，所以这里的派生是安全的
  const current = $derived(tracks[index] ?? null);

  /** 播放计数只报一次（同一曲目重复暂停/播放不重复计数） */
  const reported = new Set<number>();

  function pick(i: number) {
    index = (i + tracks.length) % tracks.length;
    playing = true;
    queueMicrotask(() => void audio?.play().catch(() => (playing = false)));
  }

  function toggle() {
    if (!audio) return;
    if (playing) {
      audio.pause();
      playing = false;
    } else {
      playing = true;
      void audio.play().catch(() => (playing = false));
    }
  }

  function onTimeUpdate() {
    if (!audio || !audio.duration) return;
    progress = (audio.currentTime / audio.duration) * 100;
  }

  function onEnded() {
    if (MUSIC.defaultMode === 'loop-one') {
      audio?.play();
      return;
    }
    // shuffle 用随机下一首；sequence 顺序推进
    const next =
      MUSIC.defaultMode === 'shuffle'
        ? Math.floor(Math.random() * tracks.length)
        : index + 1;
    if (next >= tracks.length && MUSIC.defaultMode === 'sequence') {
      playing = false;
      return;
    }
    pick(next);
  }

  /**
   * 上报播放。失败**静默忽略** —— 计数是锦上添花，
   * 不该因为一次统计请求失败就给访客弹错误。
   */
  function reportPlay(id: number) {
    if (reported.has(id)) return;
    reported.add(id);
    const base = import.meta.env.PUBLIC_API_BASE_URL || '/api';
    void fetch(`${base}/music/${id}/play`, { method: 'POST' }).catch(() => {});
  }

  function setVolume(e: Event) {
    volume = Number((e.currentTarget as HTMLInputElement).value);
    if (audio) audio.volume = volume;
  }

  // 曲目变化时重置进度显示
  $effect(() => {
    void index;
    progress = 0;
  });

  function fmt(sec: number) {
    if (!sec || !Number.isFinite(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
</script>

{#if current}
  <div class="m3-card widget music">
    <p class="head type-label-lg">
      <span>音乐</span>
      <span class="n type-label-md">{index + 1} / {tracks.length}</span>
    </p>

    <div class="now">
      {#if current.coverUrl}
        <img class="cover m3-bloom-img" src={current.coverUrl} alt="" width="48" height="48" />
      {:else}
        <span class="cover fallback" aria-hidden="true">♪</span>
      {/if}
      <div class="meta">
        <!-- 文本插值，绝不 {@html}：曲名/歌手来自数据库 -->
        <p class="title" title={current.title}>{current.title}</p>
        <p class="artist">{current.artist || '未知歌手'}</p>
      </div>
    </div>

    <div class="bar" aria-hidden="true">
      <span class="fill" style={`width:${progress}%`}></span>
    </div>

    <div class="controls">
      <button type="button" class="m3-icon-btn" aria-label="上一首" onclick={() => pick(index - 1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20 9 12l10-8v16ZM5 19V5" /></svg>
      </button>

      <button
        type="button"
        class="m3-icon-btn play"
        aria-label={playing ? '暂停' : '播放'}
        aria-pressed={playing}
        onclick={toggle}
      >
        {#if playing}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 4h3v16H8zM13 4h3v16h-3z" /></svg>
        {:else}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8Z" /></svg>
        {/if}
      </button>

      <button type="button" class="m3-icon-btn" aria-label="下一首" onclick={() => pick(index + 1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4l10 8-10 8V4ZM19 5v14" /></svg>
      </button>
    </div>

    <label class="vol">
      <span class="sr-only">音量</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        oninput={setVolume}
        aria-label="音量"
      />
    </label>

    <audio
      bind:this={audio}
      src={current.audioUrl}
      preload="none"
      ontimeupdate={onTimeUpdate}
      onended={onEnded}
      onplay={() => { playing = true; reportPlay(current.id); }}
      onpause={() => (playing = false)}
      aria-label={`正在播放：${current.title}`}
    ></audio>
  </div>
{/if}

<style>
  .widget {
    border: 1px solid var(--outline-variant);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 0 0 var(--m3e-space-3);
    color: var(--on-surface-variant);
  }

  .n {
    font-variant-numeric: tabular-nums;
  }

  .now {
    display: flex;
    align-items: center;
    gap: var(--m3e-space-3);
    min-width: 0;
  }

  .cover {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    border-radius: var(--shape-corner-m);
    object-fit: cover;
  }

  .cover.fallback {
    display: grid;
    place-items: center;
    background: var(--secondary-container);
    color: var(--on-secondary-container);
    font-size: 1.25rem;
  }

  .meta {
    min-width: 0;
  }

  .title {
    margin: 0;
    font-weight: 600;
    /* 长曲名单行省略：否则卡片高度会随曲名长度跳动 */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .artist {
    margin: 2px 0 0;
    color: var(--on-surface-variant);
    font-size: var(--m3e-body-sm-size);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    position: relative;
    height: 3px;
    margin: var(--m3e-space-3) 0;
    border-radius: var(--shape-corner-full);
    background: var(--surface-container-high);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--primary);
    transition: width 250ms linear;
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--m3e-space-3);
  }

  .play {
    background: var(--primary);
    color: var(--on-primary);
  }

  .vol {
    display: block;
    margin-top: var(--m3e-space-3);
  }

  .vol input {
    width: 100%;
    accent-color: var(--primary);
  }

  .sr-only {
    position: absolute;
    left: -9999px;
  }
</style>
