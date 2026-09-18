/**
 * 音乐部件配置（对齐 Shirone 的 `musicConfig`）。
 *
 * ★ 三重启用条件（缺一即零 DOM、零请求）：
 *   1. 这里的 `enable` 为 true；
 *   2. 数据源至少有一首**可播放**曲目（audioUrl 合法非空，由 getTracks 过滤）；
 *   3. 侧栏确实挂载了音乐部件（WidgetSidebar 的 slots 里含 'music'）。
 *
 * 第 2 条是当前的实际状态：线上 music 表为空，因此**页面不会渲染音乐卡片**。
 * 这是有意为之 —— 与其显示一个点了没反应的播放器，不如什么都不显示。
 *
 * ★ 与 Shirone 的一处**架构差异（必须知道）**：
 *   Shirone 用 Swup 做 SPA 式路由，播放器挂在持久容器里，所以切页能续播。
 *   本项目是 Astro **静态多页**（每次跳转是真的加载新文档），没有持久容器，
 *   因此**切页会停止播放**。这是如实降级，不是缺陷 —— 想要续播需要引入
 *   客户端路由或把播放器放进 iframe，两者都与"默认零 JS"的契约冲突。
 */
export const MUSIC = {
  /** 总开关 */
  enable: true,

  /**
   * 数据源模式。
   *   'local'  —— 构建期静态光碟（见 src/data/music.ts），无外部 API，可离线
   *   'remote' —— 运行时从本站 /api/music/list 拉取（当前实现走这条）
   *
   * 刻意**不提供 'meting' 这类第三方歌单代理**：那会让访客浏览器直接请求
   * 第三方接口，等于把访客 IP 交给对方，且对方接口不可控。
   * 需要接第三方时请自行评估并把地址加入 CSP 的 connect-src。
   */
  provider: 'remote' as 'local' | 'remote',

  /** 首次初始化的音量（0~1）。访客调整后由播放器运行时持有，不再回写 */
  defaultVolume: 0.7,

  /** 初始播放模式 */
  defaultMode: 'sequence' as 'sequence' | 'shuffle' | 'loop-one',
} as const;
