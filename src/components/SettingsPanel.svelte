<script lang="ts">
  /**
   * 访客显示设置面板。
   *
   * 性能契约：这个岛本身很小；**配色引擎（约 40KB）只在访客真正拖动色相或
   * 切换配色风格时才动态 import**。只想切明暗的访客不会付出这个代价。
   *
   * 被 TopAppBar 的 #settings-trigger 按钮打开（挂载时自行绑定）。
   */
  import {
    readSettings,
    writeSettings,
    applyAttributes,
    resolveMode,
    DEFAULT_SETTINGS,
    TEXTURE_PRESETS,
    type Settings,
    type ThemeMode,
    type WallpaperMode,
    type LayoutMode,
    type TexturePreset,
  } from '@/lib/theme';

  let open = $state(false);
  let settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  let busy = $state(false);

  const MODES: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: '亮' },
    { value: 'dark', label: '暗' },
    { value: 'auto', label: '跟随系统' },
  ];

  // 'banner' 这个值名不能改：localStorage 与 html[data-wallpaper] 选择器都依赖它。
  // 它实际做的是「叠一层表面渐变」，所以文案写「渐变」而不是「横幅壁纸」。
  const WALLPAPERS: { value: WallpaperMode; label: string }[] = [
    { value: 'banner', label: '渐变' },
    { value: 'solid', label: '纯色' },
  ];

  const LAYOUTS: { value: LayoutMode; label: string }[] = [
    { value: 'grid', label: '网格' },
    { value: 'list', label: '列表' },
  ];

  // 9 种 palette 风格（与 mc-utils 的 MC_STYLES 对应）
  const STYLES: { value: Settings['style']; label: string }[] = [
    { value: 'tonalSpot', label: '柔和' },
    { value: 'vibrant', label: '鲜艳' },
    { value: 'content', label: '内容' },
    { value: 'expressive', label: '表现' },
    { value: 'rainbow', label: '彩虹' },
    { value: 'fruitSalad', label: '果趣' },
    { value: 'monochrome', label: '单色' },
    { value: 'neutral', label: '中性' },
    { value: 'fidelity', label: '保真' },
  ];

  /** 常用色相快捷值 */
  const HUES = [315, 262, 240, 210, 160, 120, 60, 30, 0];

  /** 动态加载引擎并应用配色（只改色彩时才走这里） */
  async function applyColors() {
    busy = true;
    try {
      // 动态 import：HCT 引擎只在访客真正改配色时才下载
      const { applyCustomTheme } = await import('@/lib/theme-engine');
      applyCustomTheme(settings);
    } finally {
      busy = false;
    }
  }

  /** 只改明暗/布局/纹理等，不碰配色 -> 无需引擎 */
  function applyNonColor() {
    applyAttributes(settings);
  }

  function persist() {
    writeSettings(settings);
  }

  // ---- 事件 ----
  async function onHueInput(e: Event) {
    settings.hue = Number((e.target as HTMLInputElement).value);
    persist();
    await applyColors();
  }

  async function setHue(h: number) {
    settings.hue = h;
    persist();
    await applyColors();
  }

  async function setStyle(s: Settings['style']) {
    settings.style = s;
    persist();
    await applyColors();
  }

  function setMode(m: ThemeMode) {
    settings.mode = m;
    persist();
    applyNonColor();
    // auto 模式下切换系统主题要即时反映
    if (m === 'auto') settings.mode = 'auto';
    const eff = resolveMode(settings.mode);
    document.documentElement.classList.toggle('dark', eff === 'dark');
  }

  function setWallpaper(w: WallpaperMode) {
    settings.wallpaper = w;
    persist();
    applyNonColor();
  }

  function setLayout(l: LayoutMode) {
    settings.layout = l;
    persist();
    applyNonColor();
  }

  function setTexture(t: TexturePreset) {
    settings.texture = t;
    persist();
    applyNonColor();
  }

  function onOpacityInput(e: Event) {
    settings.textureOpacity = Number((e.target as HTMLInputElement).value);
    persist();
    applyNonColor();
  }

  function setReduceMotion(v: boolean) {
    settings.reduceMotion = v;
    persist();
    applyNonColor();
  }

  async function reset() {
    settings = { ...DEFAULT_SETTINGS };
    persist();
    applyNonColor();
    await applyColors();
  }

  function close() {
    open = false;
    document.getElementById('settings-trigger')?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) close();
  }

  $effect(() => {
    settings = readSettings();

    const trigger = document.getElementById('settings-trigger');
    const onOpen = () => (open = true);
    trigger?.addEventListener('click', onOpen);

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (settings.mode === 'auto') {
        document.documentElement.classList.toggle('dark', mql.matches);
      }
    };
    mql.addEventListener('change', onSystemChange);
    window.addEventListener('keydown', onKeydown);

    return () => {
      trigger?.removeEventListener('click', onOpen);
      mql.removeEventListener('change', onSystemChange);
      window.removeEventListener('keydown', onKeydown);
    };
  });
</script>

{#if open}
  <div
    class="scrim"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
  >
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="head">
        <h2 id="settings-title" class="type-title-lg">显示设置</h2>
        <button class="m3-icon-btn" type="button" aria-label="关闭" onclick={close}>✕</button>
      </header>

      <div class="body">
        <!-- 主题色 -->
        <section class="group">
          <h3 class="label">主题色相</h3>
          <div class="hue-row">
            <input
              type="range"
              min="0"
              max="360"
              value={settings.hue}
              oninput={onHueInput}
              aria-label="色相"
              style={`--hue-val:${settings.hue}`}
            />
            <span class="hue-val">{settings.hue}</span>
          </div>
          <div class="swatches">
            {#each HUES as h (h)}
              <button
                type="button"
                class="swatch"
                class:active={settings.hue === h}
                style={`--sw:oklch(0.62 0.16 ${h})`}
                aria-label={`色相 ${h}`}
                onclick={() => setHue(h)}
              ></button>
            {/each}
          </div>
        </section>

        <!-- 配色风格 -->
        <section class="group">
          <h3 class="label">配色风格</h3>
          <div class="chips">
            {#each STYLES as s (s.value)}
              <button
                type="button"
                class="opt"
                class:active={settings.style === s.value}
                onclick={() => setStyle(s.value)}
              >
                {s.label}
              </button>
            {/each}
          </div>
        </section>

        <!-- 明暗 -->
        <section class="group">
          <h3 class="label">明暗</h3>
          <div class="chips">
            {#each MODES as m (m.value)}
              <button
                type="button"
                class="opt"
                class:active={settings.mode === m.value}
                onclick={() => setMode(m.value)}
              >
                {m.label}
              </button>
            {/each}
          </div>
        </section>

        <!-- 背景 -->
        <section class="group">
          <h3 class="label">页面背景</h3>
          <div class="chips">
            {#each WALLPAPERS as w (w.value)}
              <button
                type="button"
                class="opt"
                class:active={settings.wallpaper === w.value}
                onclick={() => setWallpaper(w.value)}
              >
                {w.label}
              </button>
            {/each}
          </div>
        </section>

        <!-- 布局 -->
        <section class="group">
          <h3 class="label">文章列表布局</h3>
          <div class="chips">
            {#each LAYOUTS as l (l.value)}
              <button
                type="button"
                class="opt"
                class:active={settings.layout === l.value}
                onclick={() => setLayout(l.value)}
              >
                {l.label}
              </button>
            {/each}
          </div>
        </section>

        <!-- 纹理 -->
        <section class="group">
          <h3 class="label">背景纹理</h3>
          <div class="chips">
            {#each TEXTURE_PRESETS as t (t.value)}
              <button
                type="button"
                class="opt"
                class:active={settings.texture === t.value}
                onclick={() => setTexture(t.value)}
              >
                {t.label}
              </button>
            {/each}
          </div>
          {#if settings.texture !== 'none'}
            <div class="hue-row">
              <input
                type="range"
                min="0.05"
                max="0.25"
                step="0.01"
                value={settings.textureOpacity}
                oninput={onOpacityInput}
                aria-label="纹理浓度"
              />
              <span class="hue-val">{Math.round(settings.textureOpacity * 100)}%</span>
            </div>
          {/if}
        </section>

        <!-- 动效 -->
        <section class="group">
          <label class="toggle">
            <input
              type="checkbox"
              checked={settings.reduceMotion}
              onchange={(e) => setReduceMotion((e.target as HTMLInputElement).checked)}
            />
            <span>减少动效</span>
          </label>
        </section>
      </div>

      <footer class="foot">
        <button type="button" class="m3-button" onclick={reset} disabled={busy}>恢复默认</button>
        <button type="button" class="m3-button m3-button--filled" onclick={close}>完成</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: flex-end;
    background: color-mix(in srgb, var(--scrim) 55%, transparent);
    backdrop-filter: blur(2px);
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(420px, 100vw);
    height: 100%;
    background: var(--surface-container-low);
    box-shadow: var(--m3e-elevation-3);
    animation: slide-in var(--m3e-duration-medium) var(--m3e-easing-emphasized-decelerate);
  }

  @keyframes slide-in {
    from {
      transform: translateX(16px);
      opacity: 0;
    }
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--m3e-space-5) var(--m3e-space-5) var(--m3e-space-3);
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--m3e-space-5) var(--m3e-space-5);
  }

  .group {
    margin-bottom: var(--m3e-space-6);
  }

  .label {
    margin-bottom: var(--m3e-space-3);
    color: var(--on-surface-variant);
    font-size: var(--m3e-label-lg-size);
    font-weight: 600;
  }

  .hue-row {
    display: flex;
    align-items: center;
    gap: var(--m3e-space-3);
  }

  .hue-row input[type='range'] {
    flex: 1;
    accent-color: var(--primary);
  }

  .hue-val {
    min-width: 44px;
    color: var(--on-surface-variant);
    font-size: var(--m3e-label-md-size);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--m3e-space-2);
    margin-top: var(--m3e-space-3);
  }

  .swatch {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--shape-corner-full);
    background: var(--sw);
    cursor: pointer;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--on-surface) 20%, transparent);
    transition: transform var(--m3e-duration-short) var(--m3e-easing-standard);
  }

  .swatch:hover {
    transform: scale(1.1);
  }

  .swatch.active {
    outline: 2px solid var(--on-surface);
    outline-offset: 2px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--m3e-space-2);
  }

  .opt {
    padding: 6px var(--m3e-space-4);
    border: 1px solid var(--outline-variant);
    border-radius: var(--shape-corner-full);
    background: transparent;
    color: var(--on-surface-variant);
    font-size: var(--m3e-label-lg-size);
    cursor: pointer;
    transition:
      background var(--m3e-duration-short) var(--m3e-easing-standard),
      color var(--m3e-duration-short) var(--m3e-easing-standard);
  }

  .opt:hover {
    background: color-mix(in srgb, var(--on-surface) 8%, transparent);
  }

  .opt.active {
    background: var(--secondary-container);
    border-color: transparent;
    color: var(--on-secondary-container);
    font-weight: 600;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: var(--m3e-space-3);
    cursor: pointer;
    font-size: var(--m3e-body-md-size);
  }

  .toggle input {
    width: 20px;
    height: 20px;
    accent-color: var(--primary);
  }

  .foot {
    display: flex;
    justify-content: space-between;
    gap: var(--m3e-space-3);
    padding: var(--m3e-space-4) var(--m3e-space-5);
    border-top: 1px solid var(--outline-variant);
  }

  .foot button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
