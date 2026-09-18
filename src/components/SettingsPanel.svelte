<script lang="ts">
  /**
   * 访客显示设置面板。
   *
   * 性能契约：这个岛本身很小；**配色引擎（约 40KB）只在访客真正拖动色相或
   * 切换配色风格时才动态 import**。只想切明暗的访客不会付出这个代价。
   *
   * 被 TopAppBar 的 #settings-trigger 按钮打开（挂载时自行绑定）。
   *
   * 三处界面（顶栏明暗按钮 / 悬浮栏视图区 / 这里）写的是同一份设置，
   * 统一走 @/lib/theme 的 updateSettings()，它改完会广播 SETTINGS_EVENT，
   * 面板据此重新读一次 —— 否则顶栏切了暗色、面板里的「明暗」还高亮着"亮"。
   */
  import { fly, fade } from 'svelte/transition';
  import {
    readSettings,
    writeSettings,
    updateSettings,
    resolveMode,
    SETTINGS_EVENT,
    DEFAULT_SETTINGS,
    TEXTURE_PRESETS,
    type Settings,
    type ThemeMode,
    type WallpaperMode,
    type LayoutMode,
  } from '@/lib/theme';

  let open = $state(false);
  let settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  let busy = $state(false);
  let panel = $state<HTMLElement | null>(null);

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

  /** 当前生效的明暗，用于在分组标题上直接标出结果（auto 时"暗"才是真状态） */
  const effectiveMode = $derived(resolveMode(settings.mode));

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

  /** 非色彩项：统一交给 updateSettings，它会落盘 + 应用 + 广播 */
  function setNonColor(patch: Partial<Settings>) {
    settings = { ...settings, ...patch };
    updateSettings(patch);
  }

  /** 恢复出厂：色彩走引擎，其余走 updateSettings，两条都要跑 */
  async function reset() {
    settings = { ...DEFAULT_SETTINGS };
    persist();
    updateSettings({
      mode: DEFAULT_SETTINGS.mode,
      wallpaper: DEFAULT_SETTINGS.wallpaper,
      layout: DEFAULT_SETTINGS.layout,
      texture: DEFAULT_SETTINGS.texture,
      textureOpacity: DEFAULT_SETTINGS.textureOpacity,
      reduceMotion: DEFAULT_SETTINGS.reduceMotion,
    });
    await applyColors();
  }

  function close() {
    open = false;
    document.getElementById('settings-trigger')?.focus();
  }

  /**
   * 焦点陷阱。
   *
   * 面板是 aria-modal 的对话框：Tab 若在面板与背后的页面之间来回跳，
   * 键盘用户会"走进正文里出不来"。这里把 Tab 圈在面板内，
   * 并把 Esc 接上（读屏与键盘用户默认认为 Esc = 关闭浮层）。
   */
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function onPanelKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab' || !panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** 打开时把当前值重新读一遍：可能访客刚在顶栏或悬浮栏改过 */
  function onTriggerClick() {
    settings = readSettings();
    open = true;
    // 初焦点放到面板本身（而不是第一个控件）：读屏会念出标题，
    // 而直接聚焦到滑杆会让人以为"我还没看标题就跳进控件了"
    queueMicrotask(() => panel?.focus({ preventScroll: true }));
  }

  $effect(() => {
    settings = readSettings();

    const trigger = document.getElementById('settings-trigger');
    trigger?.addEventListener('click', onTriggerClick);

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (settings.mode === 'auto') {
        document.documentElement.classList.toggle('dark', mql.matches);
      }
    };
    mql.addEventListener('change', onSystemChange);

    const onExternal = () => {
      if (open) settings = readSettings();
    };
    window.addEventListener(SETTINGS_EVENT, onExternal);

    return () => {
      trigger?.removeEventListener('click', onTriggerClick);
      mql.removeEventListener('change', onSystemChange);
      window.removeEventListener(SETTINGS_EVENT, onExternal);
    };
  });

  /* 打开时给触发按钮打 aria-expanded，关掉时撤掉 ——
     读屏用户需要知道"这个按钮背后有个已展开的对话框" */
  $effect(() => {
    const trigger = document.getElementById('settings-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', String(open));
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div
    class="scrim"
    role="presentation"
    transition:fade={{ duration: 150 }}
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
  >
    <div
      class="panel m3-sheet"
      bind:this={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
      transition:fly={{ x: 24, duration: 260 }}
      onkeydown={onPanelKeydown}
    >
      <header class="head">
        <span class="m3-accent-bar" aria-hidden="true"></span>
        <h2 id="settings-title" class="type-title-lg">显示设置</h2>
        <button class="m3-icon-btn" type="button" aria-label="关闭设置" onclick={close}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>

      <div class="body">
        <!-- 主题色 -->
        <section class="group">
          <h3 class="label">
            主题色相
            <span class="hint">当前 {settings.hue}°</span>
          </h3>
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
          <div class="swatches" role="group" aria-label="常用色相">
            {#each HUES as h (h)}
              <button
                type="button"
                class="swatch"
                class:active={settings.hue === h}
                style={`--sw:oklch(0.62 0.16 ${h})`}
                aria-label={`色相 ${h}`}
                aria-pressed={settings.hue === h}
                onclick={() => setHue(h)}
              ></button>
            {/each}
          </div>
        </section>

        <!-- 配色风格 -->
        <section class="group">
          <h3 class="label">
            配色风格
            <span class="hint">{STYLES.find((s) => s.value === settings.style)?.label}</span>
          </h3>
          <div class="opts" role="radiogroup" aria-label="配色风格">
            {#each STYLES as s (s.value)}
              <button
                type="button"
                class="opt"
                role="radio"
                aria-checked={settings.style === s.value}
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
          <h3 class="label">
            明暗
            <span class="hint">生效为 {effectiveMode === 'dark' ? '暗色' : '亮色'}</span>
          </h3>
          <div class="opts" role="radiogroup" aria-label="明暗模式">
            {#each MODES as m (m.value)}
              <button
                type="button"
                class="opt"
                role="radio"
                aria-checked={settings.mode === m.value}
                class:active={settings.mode === m.value}
                onclick={() => setNonColor({ mode: m.value })}
              >
                {m.label}
              </button>
            {/each}
          </div>
        </section>

        <!-- 背景 -->
        <section class="group">
          <h3 class="label">页面背景</h3>
          <div class="opts" role="radiogroup" aria-label="页面背景">
            {#each WALLPAPERS as w (w.value)}
              <button
                type="button"
                class="opt"
                role="radio"
                aria-checked={settings.wallpaper === w.value}
                class:active={settings.wallpaper === w.value}
                onclick={() => setNonColor({ wallpaper: w.value })}
              >
                {w.label}
              </button>
            {/each}
          </div>
        </section>

        <!-- 布局 -->
        <section class="group">
          <h3 class="label">文章列表布局</h3>
          <div class="opts" role="radiogroup" aria-label="文章列表布局">
            {#each LAYOUTS as l (l.value)}
              <button
                type="button"
                class="opt"
                role="radio"
                aria-checked={settings.layout === l.value}
                class:active={settings.layout === l.value}
                onclick={() => setNonColor({ layout: l.value })}
              >
                {l.label}
              </button>
            {/each}
          </div>
        </section>

        <!-- 纹理 -->
        <section class="group">
          <h3 class="label">
            背景纹理
            <span class="hint">{TEXTURE_PRESETS.find((t) => t.value === settings.texture)?.label}</span>
          </h3>
          <div class="opts" role="radiogroup" aria-label="背景纹理">
            {#each TEXTURE_PRESETS as t (t.value)}
              <button
                type="button"
                class="opt"
                role="radio"
                aria-checked={settings.texture === t.value}
                class:active={settings.texture === t.value}
                onclick={() => setNonColor({ texture: t.value })}
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
                oninput={(e) => setNonColor({ textureOpacity: Number((e.target as HTMLInputElement).value) })}
                aria-label="纹理浓度"
              />
              <span class="hue-val">{Math.round(settings.textureOpacity * 100)}%</span>
            </div>
          {/if}
        </section>

        <!-- 动效 -->
        <section class="group">
          <label class="switch-row">
            <input
              type="checkbox"
              class="m3-switch"
              checked={settings.reduceMotion}
              onchange={(e) => setNonColor({ reduceMotion: (e.target as HTMLInputElement).checked })}
            />
            <span>减少动效</span>
          </label>
          <p class="note type-body-sm">
            开启后入场、翻页与悬浮栏的动画全部退回到终态；系统的「减少动效」偏好始终优先。
          </p>
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
    z-index: var(--z-overlay);
    display: flex;
    justify-content: flex-end;
    background: color-mix(in srgb, var(--scrim) 55%, transparent);
    /* 刻意不用 backdrop-filter：浮层压在正文上时，
       背后内容被糊成一片反而更难读，且本站禁玻璃拟态 */
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(420px, 100vw);
    height: 100%;
    /* 浮层形状契约 28px：贴在视口右缘时只圆左侧两角 */
    border-radius: var(--shape-corner-xl) 0 0 var(--shape-corner-xl);
    box-shadow: var(--m3e-elevation-4);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--m3e-space-3);
    padding: var(--m3e-space-5) var(--m3e-space-5) var(--m3e-space-3);
  }

  .head h2 {
    margin: 0;
  }

  .head .m3-icon-btn {
    margin-left: auto;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--m3e-space-5) var(--m3e-space-5);
  }

  /* 面板本身获得焦点时的初焦点环：不给它 outline 会完全看不见焦点在哪 */
  .panel:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }

  .group {
    margin-bottom: var(--m3e-space-6);
  }

  .label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--m3e-space-3);
    margin-bottom: var(--m3e-space-3);
    color: var(--on-surface-variant);
    font-size: var(--m3e-label-lg-size);
    font-weight: 600;
  }

  /* 分组标题右侧的"当前值"：不点开分组也能读出现在设成了什么 */
  .hint {
    color: var(--primary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
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

  /* 选中态：外环 + 内白圈，两层才在任何色相上都看得见（单靠描边在深色色板上会消失） */
  .swatch.active {
    outline: 2px solid var(--on-surface);
    outline-offset: 2px;
    box-shadow: inset 0 0 0 3px var(--surface);
  }

  /* 选项组：网格铺开而不是 flex-wrap —— 后者会让"跟随系统"这种四字项
     单独换行并把选中圆点挤成两行。92px 是最长标签 + 圆点 + 内边距的下界。 */
  .opts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
    gap: var(--m3e-space-2);
  }

  .opt {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--m3e-space-1);
    min-height: 40px;
    padding: 0 var(--m3e-space-3);
    border: 1px solid var(--outline-variant);
    border-radius: var(--shape-corner-full);
    background: transparent;
    color: var(--on-surface-variant);
    font-size: var(--m3e-label-lg-size);
    cursor: pointer;
    transition:
      background var(--m3e-duration-short) var(--m3e-easing-standard),
      color var(--m3e-duration-short) var(--m3e-easing-standard),
      border-color var(--m3e-duration-short) var(--m3e-easing-standard);
  }

  .opt:hover {
    background: color-mix(in srgb, var(--on-surface) 8%, transparent);
  }

  /* 选中态必须"三重编码"：容器色 + 加粗 + 一枚勾。
     只靠背景色差异的话，色相调到接近中性时选中与未选中几乎分不出 */
  .opt.active {
    background: var(--secondary-container);
    border-color: var(--on-secondary-container);
    color: var(--on-secondary-container);
    font-weight: 600;
  }

  .opt.active::before {
    content: '';
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: var(--shape-corner-full);
    background: currentColor;
  }

  .switch-row {
    display: flex;
    align-items: center;
    gap: var(--m3e-space-3);
    cursor: pointer;
    font-size: var(--m3e-body-md-size);
  }

  .note {
    margin: var(--m3e-space-2) 0 0;
    color: var(--on-surface-variant);
  }

  .foot {
    display: flex;
    justify-content: space-between;
    gap: var(--m3e-space-3);
    padding: var(--m3e-space-4) var(--m3e-space-5);
    border-top: 1px solid var(--outline-variant);
  }

  .foot button:disabled {
    opacity: var(--state-disabled);
    cursor: not-allowed;
  }

  /* ---- 窄屏：面板从右侧全高改成底部抽屉 -------------------------------
     420px 的侧栏在 390px 手机上等于整屏，且"从右边推进来"在小屏没有指向性。
     收成底部抽屉后选项区还能横向铺开，不再挤成一团。 */
  @media (max-width: 640px) {
    .scrim {
      align-items: flex-end;
      justify-content: stretch;
    }

    .panel {
      width: 100%;
      height: min(86dvh, 720px);
      border-radius: var(--shape-corner-xl) var(--shape-corner-xl) 0 0;
    }

    .opts {
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    }

    .opt {
      min-height: 48px; /* 触屏最小触控目标 */
    }
  }
</style>
