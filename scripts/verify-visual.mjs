/**
 * 观感/动效自动校验（headless Edge + CDP）。
 *
 * 为什么要有这个脚本：本轮重构大量依赖"规范要求的数值恰好成立"——
 * 版心 840–1040dp、按钮与 chip 的形状不能互换、滚动入场每张卡片的
 * animation-range 必须真的不同。这些都能靠肉眼"看着还行"蒙过去，
 * 但一旦被后续改动破坏也不会报错（CSS 是静默失效的）。
 * 所以固化成断言：跑一次，3 秒内给出是/否。
 *
 * 用法：node scripts/verify-visual.mjs [baseUrl]
 * 依赖：本机 Edge，以及一个已在跑的静态站点（wrangler pages dev dist）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8790';

/**
 * 找一个可用的 Chromium 内核浏览器。
 * 本机优先 Edge（Windows 默认就有），CI（ubuntu）上是 Chrome/Chromium，
 * 所以两条路都留着，并允许用 CHROME_PATH / EDGE_PATH 显式指定。
 */
function findBrowser() {
  const explicit = process.env.CHROME_PATH ?? process.env.EDGE_PATH;
  if (explicit) return explicit;
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const BROWSER = findBrowser();

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  OK  ' : ' FAIL '} ${name} :: ${detail}`);
};

// ---- CDP 最小客户端 ---------------------------------------------------------
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} 超时`));
      }, 20000);
    });
  }

  /** 在页面里求值并取回结果（awaitPromise 让 async IIFE 可用） */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? '页面求值异常');
    }
    return r.result.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * ⚠️ 端口不能自己挑，也不能写死。
 *   写死 9333：上一轮残留的 Edge 还占着它时，connect() 会连到**那个**浏览器 ——
 *     带的是旧 profile 与旧 HTTP 缓存，量到的是上一轮的产物（本地踩过，报出来的
 *     失败看着像设计错了，其实是数据串台）。
 *   随机挑一个（9400+pid%400）：CI 上直接"调试端口未就绪"，因为没人知道那个端口
 *     上到底有没有人听。
 * 正确做法是让浏览器自己挑（--remote-debugging-port=0），它会把真实端口写进
 * 我们那个临时 profile 里的 DevToolsActivePort —— 文件在我们的目录下，
 * 读到的端口按定义就是我们亲手起的那个进程，既不会撞也不会串台。
 */
let debugPort = 0;

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (res.ok) return;
    } catch {
      /* 还没起 */
    }
    await sleep(250);
  }
  throw new Error(`Edge 调试端口 ${debugPort} 未就绪`);
}

async function openTarget(url) {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error(`新建标签页失败: ${res.status}`);
  return res.json();
}

const profileDir = mkdtempSync(join(tmpdir(), 'jyuan-visual-'));
if (!BROWSER) {
  console.error(
    '找不到 Chromium 内核浏览器。请设置 CHROME_PATH 或 EDGE_PATH 指向可执行文件。'
  );
  process.exit(2);
}
const edgeErr = [];
const edge = spawn(
  BROWSER,
  [
    '--headless=new',
    // 0 = 让浏览器自己挑一个空闲端口，再从上面临时 profile 里的
    // DevToolsActivePort 读回来（理由见上面 debugPort 的注释）
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1440,1000',
    'about:blank',
  ],
  // stderr 收起来：浏览器起不来时（缺依赖、profile 被锁、端口策略）
  // 唯一能看见原因的地方就是它，stdio 直接 ignore 等于把线索扔了
  { stdio: ['ignore', 'ignore', 'pipe'] }
);
edge.stderr.on('data', (chunk) => edgeErr.push(chunk.toString()));

/** 等浏览器把自己挑到的端口写进 profile/DevToolsActivePort */
async function readDevToolsPort() {
  const file = join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 60; i++) {
    if (existsSync(file)) {
      const port = parseInt(readFileSync(file, 'utf-8').split('\n')[0], 10);
      if (port > 0) return port;
    }
    if (edge.exitCode !== null) break;
    await sleep(250);
  }
  throw new Error(
    `拿不到 DevToolsActivePort（浏览器退出码 ${edge.exitCode}）。stderr：` +
      (edgeErr.join('').trim().slice(-400) || '(无输出)')
  );
}

let exitCode = 0;
try {
  debugPort = await readDevToolsPort();
  await connect();
  const target = await openTarget(`${BASE}/`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
  });

  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  /*
   * 显式关缓存：改完 CSS 立刻重跑时必须量到新产物。
   * 带着缓存时断言读到的是上一轮的样式表，报出来的尺寸错得毫无头绪。
   */
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  /** 收集 CSP 违规与页面错误 */
  const violations = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (/Content Security Policy|Refused to/i.test(e.text)) violations.push(e.text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      violations.push(msg.params.exceptionDetails.text);
    }
  });

  /** 打开一个地址并等它加载完 */
  const goto = async (path) => {
    await cdp.send('Page.navigate', { url: `${BASE}${path}` });
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      const ready = await cdp
        .evaluate('document.readyState === "complete" && !!document.querySelector("main")')
        .catch(() => false);
      if (ready) break;
    }
    // 等字体与懒加载稳定，否则量到的宽度会随字体回退而漂移
    await sleep(700);
  };

  /*
   * 静态服务必须在跑。它挂了的时候症状是"跑到一半 Page.navigate 超时"，
   * 看起来像页面自己卡死，其实是没人在 8790 上应答 —— 而 astro build 会清空
   * 并重写 dist，正在服务 dist 的 wrangler pages dev 常常就死在那一步。
   * 所以开跑前先用 Node 探一次，把话说明白。
   */
  try {
    const pre = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
    if (!pre.ok) throw new Error(`HTTP ${pre.status}`);
  } catch (e) {
    throw new Error(
      `静态站点没在 ${BASE} 上响应（${e.message}）。` +
        '先跑 npx wrangler pages dev dist --port 8790 再校验；' +
        '注意 astro build 会清空 dist，构建之后要重启这个服务。'
    );
  }

  // =========================================================================
  // 1. 形状契约：按钮 12px 核心控件圆角，chip 全圆，卡片大圆角，图标按钮全圆
  // =========================================================================
  await goto('/');
  const shapes = await cdp.evaluate(`(() => {
    const r = (el) => el ? getComputedStyle(el).borderTopLeftRadius : '(无)';
    return {
      button: r(document.querySelector('.m3-button:not(.m3-button--icon)')),
      icon:   r(document.querySelector('.m3-icon-btn')),
      chip:   r(document.querySelector('.m3-chip')),
      card:   r(document.querySelector('.m3-card')),
    };
  })()`);

  const px = (s) => parseFloat(s);
  /*
   * 从计算后的颜色里取 alpha。
   * 必须同时认三种写法：`rgba(r,g,b,a)`、空格语法 `rgb(r g b / a)`、
   * 以及 Chrome 对 color-mix() 的返回值 `color(srgb r g b / a)`。
   * 只按逗号语法找的话，玻璃的半透明底色会被读成"不透明"（返回 1），
   * 于是"必须有透明度"的断言在真的玻璃上失败 —— 看着像设计没生效。
   */
  const alphaOf = (color = '') => {
    const slash = color.match(/\/\s*([\d.]+)(%)?\s*\)/);
    if (slash) return Math.min(1, parseFloat(slash[1]) / (slash[2] ? 100 : 1));
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x));
    return parts.length >= 4 ? parts[3] : 1;
  };
  check(
    '按钮 = 12px 核心控件圆角（非胶囊）',
    px(shapes.button) === 12,
    `按钮 ${shapes.button}`
  );
  check('图标按钮 = 全圆', px(shapes.icon) >= 999, `图标按钮 ${shapes.icon}`);
  check('chip = 全圆（药丸）', px(shapes.chip) >= 999, `chip ${shapes.chip}`);
  check('卡片 = 16px 大圆角', px(shapes.card) === 16, `卡片 ${shapes.card}`);

  // =========================================================================
  // 1b. 品牌字体：CSS 里写了字族名不代表字真的在。
  // 子集没生成 / 文件名不对 / 构建顺序错，浏览器都会静默回落到系统字，
  // 页面看起来"只是字体不太一样" —— 正是最难靠肉眼发现的那类回归。
  // 所以量三件事：计算样式里的字族、字体是否已加载、以及实测字宽是否真的变了。
  // =========================================================================
  const font = await cdp.evaluate(`(async () => {
    await document.fonts.ready;
    const h1 = document.querySelector('.hero h1') || document.querySelector('h1');
    if (!h1) return null;
    const fam = getComputedStyle(h1).fontFamily;
    const loaded = document.fonts.check('400 16px "LXGW WenKai"');
    const c = document.createElement('canvas').getContext('2d');
    // 探针必须用拉丁字母：汉字在 LXGW 与系统回落字体下都是 1em 等宽，
    // 量不出差别 —— 第一版这里用 h1 的中文，导致断言假失败。
    const probe = 'AzgW123ffi';
    c.font = '48px "LXGW WenKai", monospace';
    const a = c.measureText(probe).width;
    c.font = '48px monospace';
    const b = c.measureText(probe).width;
    return { fam, loaded, glyphDiff: Math.abs(a - b) > 1, a: Math.round(a), b: Math.round(b) };
  })()`);
  if (font) {
    check(
      '标题命中品牌字体（子集已生成且真的在用）',
      /lxgw wenkai/i.test(font.fam) && font.loaded === true && font.glyphDiff === true,
      `family="${font.fam.slice(0, 34)}…" 已加载=${font.loaded} 拉丁探针字宽 ${font.a}px vs 回落 ${font.b}px`
    );
  } else {
    check('标题命中品牌字体', false, '页面上找不到 h1，断言无法生效');
  }

  // =========================================================================
  // 2. 顶栏：禁止毛玻璃；且必须是页面过渡的锚点（不跟着淡入淡出）
  // =========================================================================
  const topbar = await cdp.evaluate(`(() => {
    const el = document.querySelector('.m3-topbar, header');
    if (!el) return null;
    const s = getComputedStyle(el);
    const vt = getComputedStyle(document.documentElement);
    return {
      backdrop: s.backdropFilter || s.webkitBackdropFilter || 'none',
      name: el.style.viewTransitionName || s.viewTransitionName,
      hasWallpaper: document.body.classList.contains('has-wallpaper'),
    };
  })()`);
  check('顶栏无 backdrop-filter（规范禁止玻璃拟态）', topbar?.backdrop === 'none', `backdrop-filter: ${topbar?.backdrop}`);
  check('顶栏是 view-transition 锚点', topbar?.name === 'topbar', `view-transition-name: ${topbar?.name}`);

  // 壁纸模式下顶栏必须是不透明的，否则正文会从底下透出来
  if (topbar?.hasWallpaper) {
    const bg = await cdp.evaluate(
      `getComputedStyle(document.querySelector('.m3-topbar, header')).backgroundColor`
    );
    const alpha = (() => {
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) return 1;
      const parts = m[1].split(',').map((x) => x.trim());
      return parts.length === 4 ? parseFloat(parts[3]) : 1;
    })();
    check('有壁纸时顶栏底色不透明', alpha >= 0.99, `background: ${bg}`);
  }

  // =========================================================================
  // 3. 跨文档页面过渡：CSS 原生，零 JS
  // =========================================================================
  const vt = await cdp.evaluate(`(() => {
    // CSS.supports 没有 "at-rule" 这种用法（那是无效调用，永远返回 false）。
    // 真正可靠的探测是插进一张临时样式表：不支持的 at-rule 会被丢弃/抛错。
    let atRuleOk = false;
    try {
      const s = document.createElement('style');
      document.head.appendChild(s);
      s.sheet.insertRule('@view-transition { navigation: auto; }', 0);
      atRuleOk = s.sheet.cssRules.length > 0 &&
        /view-transition/i.test(s.sheet.cssRules[0].cssText);
      s.remove();
    } catch {
      atRuleOk = false;
    }
    return {
      startViewTransition: typeof document.startViewTransition === 'function',
      atRuleOk,
      sheetHasRule: Array.from(document.styleSheets).some((sh) => {
        try { return Array.from(sh.cssRules).some((r) => /view-transition|m3-page-(in|out)/.test(r.cssText)); }
        catch { return false; }
      }),
    };
  })()`);
  check('支持 @view-transition at-rule', vt.atRuleOk, `at-rule 可用: ${vt.atRuleOk}`);
  check('样式表含页面过渡规则', vt.sheetHasRule, `含 m3-page-in/out: ${vt.sheetHasRule}`);

  // =========================================================================
  // 4. 错落入场：每张卡片的 animation-range 必须互不相同
  //    —— 这是本轮唯一容易"看着有动画但其实全一样"的点
  // =========================================================================
  const stagger = await cdp.evaluate(`(() => {
    const containers = Array.from(document.querySelectorAll('.m3-stagger'));
    return containers.map((box) => ({
      label: box.className.replace(/\\s+/g, ' ').trim(),
      cards: Array.from(box.querySelectorAll(':scope > .m3-reveal')).map((c) => {
        const s = getComputedStyle(c);
        return {
          range: s.animationRange || s.animationRangeStart || '',
          name: s.animationName,
          timeline: s.animationTimeline || '',
        };
      }),
    }));
  })()`);

  const allRevealed = stagger.reduce((n, c) => n + c.cards.length, 0);
  check(
    '存在 .m3-stagger 容器且命中直接子卡片',
    allRevealed > 0,
    `${stagger.length} 个容器 / ${allRevealed} 张：${stagger.map((c) => c.label).join(' | ')}`
  );
  const ranges = stagger.flatMap((c) => c.cards.map((r) => r.range)).filter(Boolean);
  check('滚动入场动画已挂上', ranges.length > 0, `已挂 ${ranges.length}/${allRevealed}`);
  /*
   * 错落必须**在每个容器内部**都成立。
   * 早先这里把所有容器的 range 混在一个集合里比大小，于是"给侧栏部件也加上
   * .m3-stagger"就会让断言假报警（两个容器各自 1/2/3 号，range 自然重复）。
   * 真正的契约是"同一组里不重复"，不是"全站不重复"。
   */
  for (const box of stagger) {
    const rs = box.cards.map((r) => r.range).filter(Boolean);
    if (rs.length > 1) {
      const distinct = new Set(rs);
      check(
        `容器「${box.label}」内每张卡片 animation-range 各不相同`,
        distinct.size === rs.length,
        `${distinct.size} 种 / ${rs.length} 张\n       ${rs.join('\n       ')}`
      );
    }
  }

  // =========================================================================
  // 5. 正文版心：必须落在规范要求的 840–1040dp
  // =========================================================================
  const articlePath = await cdp.evaluate(`(async () => {
    const a = document.querySelector('a[href^="/blog/"]');
    return a ? a.getAttribute('href') : null;
  })()`);
  if (articlePath) {
    await goto(articlePath);
    const prose = await cdp.evaluate(`(() => {
      const p = document.querySelector('.prose');
      if (!p) return null;
      const s = getComputedStyle(p);
      const post = document.querySelector('.post');
      const postW = post ? getComputedStyle(post).maxWidth : '(无)';
      const parse = (v) => v.endsWith('px') ? parseFloat(v) : null;
      const pv = p.getBoundingClientRect();
      return {
        maxWidth: parse(s.maxWidth),
        actual: Math.round(pv.width),
        left: Math.round(pv.left),
        right: Math.round(window.innerWidth - pv.right),
        postMax: postW,
        lineHeight: s.lineHeight,
        fontSize: s.fontSize,
      };
    })()`);

    if (prose) {
      const w = prose.actual;
      check('正文有效宽度落在 840–1040px', w >= 840 && w <= 1040, `max-width ${prose.maxWidth}px → 实测 ${w}px`);
      const lh = px(prose.lineHeight) / px(prose.fontSize);
      check('正文行高 >= 1.7（中文可读性）', lh >= 1.7, `line-height ${lh.toFixed(2)}`);

      // 左右留白只在**没有侧栏**时才应该对称。
      // 有 TOC 时版面本来就是「正文 + 侧栏」的非对称栅格，
      // 要求两边留白相等是错的 —— 那时该管的是正文列宽度，不是留白。
      const tocShown = await cdp.evaluate(`(() => {
        const el = document.querySelector('.toc-wrap');
        return !!el && getComputedStyle(el).display !== 'none';
      })()`);
      if (!tocShown) {
        check(
          '无侧栏时正文左右留白对称',
          Math.abs(prose.left - prose.right) <= 2,
          `左 ${prose.left}px / 右 ${prose.right}px`
        );
      } else {
        check('有侧栏时正文贴左（栅格预期行为）', prose.left < prose.right, `左 ${prose.left}px / 右 ${prose.right}px（右含 TOC）`);
      }
    } else {
      check('正文容器存在', false, '未找到 .prose');
    }

    // TOC 侧栏出现时，正文列不能被挤到 840px 以下
    const withToc = await cdp.evaluate(`(() => {
      const wrap = document.querySelector('.wrap:has(.toc-wrap)');
      const post = document.querySelector('.post');
      if (!post) return null;
      return { postW: Math.round(post.getBoundingClientRect().width), vw: window.innerWidth };
    })()`);
    if (withToc && withToc.vw >= 1200) {
      check(
        '侧栏 TOC 展开时正文列仍 >= 840px',
        withToc.postW >= 840,
        `视口 ${withToc.vw}px 下正文列 ${withToc.postW}px`
      );
    }

    // =======================================================================
    // 代码面板：暗色下不得翻成白板。
    // inverse-* 是**相对角色**（实测亮 #100d11 / 暗 #fff7fd），早先 .prose pre
    // 直接拿它当底色，于是暗色读者每段代码都看到一块刺眼的白 —— 而 CSS 不报错。
    // 现在走 --code-bg/--code-fg（由 mc-utils.codeRoleCss 钉住亮色配对）。
    // 这条断言量的是浏览器算出来的实际 rgb，不读源码。
    // =======================================================================
    const probeCode = () =>
      cdp.evaluate(`(() => {
        const pre = document.querySelector('.prose pre');
        if (!pre) return null;
        const s = getComputedStyle(pre);
        return { bg: s.backgroundColor, fg: s.color };
      })()`);

    let code = await probeCode();
    if (!code) {
      // 当前这篇文章没有代码块 —— 回首页换一篇有代码的，别让断言静默跳过
      await goto('/');
      const hrefs = await cdp.evaluate(
        `Array.from(document.querySelectorAll('a[href^="/blog/"]')).map((a) => a.getAttribute('href'))`
      );
      for (const h of hrefs.slice(0, 6)) {
        await goto(h);
        code = await probeCode();
        if (code) break;
      }
    }

    if (code) {
      await cdp.evaluate(`document.documentElement.classList.add('dark')`);
      const dark = await probeCode();
      await cdp.evaluate(`document.documentElement.classList.remove('dark')`);

      const lum = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c || '');
        if (!m) return null;
        const [r, g, b] = m[1].split(',').slice(0, 3).map((v) => parseFloat(v) / 255);
        const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = [Math.max(a, b), Math.min(a, b)];
        return (hi + 0.05) / (lo + 0.05);
      };

      const bgL = lum(code.bg);
      const bgLdark = dark ? lum(dark.bg) : null;
      check(
        '暗色下代码块仍是深底（不随 inverse 角色翻转）',
        bgL !== null && bgL < 0.25 && bgLdark !== null && bgLdark < 0.25,
        `亮度 亮=${bgL?.toFixed(3)} 暗=${bgLdark?.toFixed(3)}（>0.25 即翻成白板）`
      );
      check(
        '代码块底色明暗两态同值',
        !!dark && code.bg === dark.bg,
        `亮 ${code.bg} / 暗 ${dark?.bg ?? '(未取到)'}`
      );
      const fgL = lum(code.fg);
      check(
        '代码块前景对底色对比度 >= 4.5:1',
        fgL !== null && bgL !== null && ratio(fgL, bgL) >= 4.5,
        `对比度 ${fgL !== null && bgL !== null ? ratio(fgL, bgL).toFixed(1) : '?'}:1（字 ${code.fg} / 底 ${code.bg}）`
      );
    } else {
      check('代码面板契约', false, '站内没有任何一篇文章含代码块 —— 断言无法生效');
    }
  } else {
    check('首页能找到文章链接', false, '未找到 /blog/ 链接');
  }

  // =========================================================================
  // 5b. 图片色调辉光：兜底方向必须是「动画不跑 → 图片正常可见」
  //     这是最要紧的一条：若写反成 img { opacity: 0 }，动画一旦没跑
  //     （浏览器不支持 / 用户关了动效 / CSP 拦了脚本），封面会永久空白。
  //     所以这里断言的是 img 自身的可见性，而不是动画有没有跑。
  // =========================================================================
  await goto('/');
  const bloom = await cdp.evaluate(`(() => {
    const wrap = document.querySelector('.m3-bloom');
    if (!wrap) return null;
    const img = wrap.querySelector('img');
    const before = getComputedStyle(wrap, '::before');
    const imgStyle = img ? getComputedStyle(img) : null;
    return {
      hasSkin: !!img,
      imgOpacity: imgStyle ? imgStyle.opacity : null,
      coverOpacity: imgStyle ? getComputedStyle(wrap).opacity : null,
      placeholderOpacity: before.opacity,
      placeholderBg: before.backgroundColor || before.backgroundImage,
      placeholderFilter: before.filter,
      wrapHasAspect: getComputedStyle(wrap).aspectRatio || '(无)',
    };
  })()`);

  if (bloom) {
    check(
      '辉光占位层默认不可见（否则会永久盖住图片）',
      // 默认状态 opacity 必须是 0：动画负责把它"演出来再淡掉"。
      // 若初始为 1，一旦动画不跑，色块就永久压在图上。
      px(bloom.placeholderOpacity) === 0 || bloom.placeholderFilter === 'none',
      `::before opacity=${bloom.placeholderOpacity} filter=${bloom.placeholderFilter}`
    );
    check(
      '图片自身不依赖 JS/动画即可见',
      bloom.hasSkin && px(bloom.imgOpacity) >= 0.99 && px(bloom.coverOpacity) >= 0.99,
      `img opacity=${bloom.imgOpacity} 容器 opacity=${bloom.coverOpacity}`
    );
    check(
      '封面容器锁定了宽高比（CLS=0 的前提）',
      /[0-9]/.test(String(bloom.wrapHasAspect)),
      `aspect-ratio: ${bloom.wrapHasAspect}`
    );
  } else {
    check('首页存在 .m3-bloom 图片容器', false, '未找到 —— 辉光未被应用？');
  }

  // =========================================================================
  // 5c. 侧栏部件（Shirone widgets）已渲染，且主列宽度不被挤破
  // =========================================================================
  const widgets = await cdp.evaluate(`(() => {
    const side = document.querySelector('.widgets');
    const main = document.querySelector('.main-col');
    if (!side) return { present: false };
    // .widget 的类名里带部件标识（profile/stats/...），但 Astro 会给 scoped
    // 样式加 data-astro-cid-* 属性，类名本身是干净的。这里把所有类名拼起来找。
    const known = ['profile', 'music', 'stats', 'categories', 'tags', 'calendar'];
    const names = Array.from(side.querySelectorAll('.widget')).map((w) => {
      const cls = w.getAttribute('class') || '';
      return known.find((k) => cls.split(/\\s+/).includes(k)) || '(未识别:' + cls + ')';
    });
    return {
      present: true,
      count: side.querySelectorAll('.widget').length,
      names,
      mainW: main ? Math.round(main.getBoundingClientRect().width) : null,
      vw: window.innerWidth,
      sidebarVisible: getComputedStyle(side).display !== 'none',
    };
  })()`);

  if (widgets.present) {
    check('侧栏部件已渲染', widgets.count > 0, `${widgets.count} 个：${widgets.names.join('、')}`);
    if (widgets.vw >= 1200) {
      check(
        '侧栏展开时主列仍 >= 640px（栅格不塌）',
        widgets.mainW >= 640,
        `视口 ${widgets.vw}px 下主列 ${widgets.mainW}px`
      );
    }

    /*
     * 音乐部件：断言**不变量**而不是当前数据状态。
     *
     * 写成"必须没有音乐部件"是错的 —— 那只是在当前（库为空）这个特定数据下成立，
     * 一旦真加了曲子，测试就会假报警。真正的不变量是：
     *   「音乐部件存在」必须**当且仅当**「API 里确实有可播放曲目」。
     * 这条在任何数据状态下都成立，且能抓住"渲染了空壳播放器"这类退化。
     *
     * 选择器同时看侧栏与悬浮栏：播放器已从首页侧栏搬进跨页常驻的悬浮栏，
     * 只查 .widgets 会在搬家之后永远查不到（然后"通过"—— 那是最坏的通过）。
     */
    const audio = await cdp.evaluate(`(() => {
      const el = document.querySelector('.widgets .music, .dock .music');
      if (!el) return { present: false };
      const src = el.querySelector('audio')?.getAttribute('src') ?? '';
      return { present: true, src, hasControls: !!el.querySelector('audio[controls], .controls') };
    })()`);

    let playable = 0;
    try {
      const r = await fetch(`${BASE}/api/music/list`);
      const j = await r.json();
      playable = (j?.data ?? []).filter((t) => String(t.audioUrl ?? '').trim()).length;
    } catch {
      playable = -1; // 拿不到就不判，避免误报
    }

    if (playable >= 0) {
      check(
        '音乐部件当且仅当有可播放曲目时出现',
        audio.present === playable > 0,
        `API 可播放曲目 ${playable} 首 / 部件${audio.present ? '已渲染' : '未渲染'}`
      );
    }
    if (audio.present) {
      check(
        '音乐部件有音频元素与控件',
        audio.hasControls && /^(\/|https?:)/.test(audio.src),
        `src=${audio.src || '(空)'}`
      );
    }
  } else {
    check('首页存在侧栏部件容器', false, '未找到 .widgets');
  }

  // =========================================================================
  // 5c-2. 首屏站格：不能是"居中大标题 + 两个按钮"的模板脸
  // =========================================================================
  const mast = await cdp.evaluate(`(() => {
    const w = document.querySelector('.wordmark');
    const loom = document.querySelector('.loom-plate');
    const acts = document.querySelector('.mast-actions');
    if (!w || !loom || !acts) return { present: false };
    const wr = w.getBoundingClientRect();
    const lr = loom.getBoundingClientRect();
    const cs = getComputedStyle(w);
    return {
      present: true,
      align: cs.textAlign,
      font: cs.fontFamily,
      loomSide: lr.left >= wr.right - 2 ? 'right' : lr.top >= wr.bottom ? 'below' : 'overlap',
      actionsJustify: getComputedStyle(acts).justifyContent,
      bars: document.querySelectorAll('.bars .bar').length,
      barsWithPosts: document.querySelectorAll('.bars .bar.has').length,
      kite: !!document.querySelector('.loom-kite'),
      thread: !!document.querySelector('.thread-rule'),
      /*
       * 渐变字指纹：-webkit-text-fill-color 在 Chrome 里永远解析成一个颜色
       * （不设它也会返回当前 color 值），拿它判断"有没有用渐变字"是错的。
       * 真正做渐变字必须同时出现 background-clip: text + 一层渐变背景，
       * 所以量这两样。
       */
      clipText: cs.webkitBackgroundClip || cs.backgroundClip,
      bgImage: cs.backgroundImage,
      /*
       * 布的编码：一趟纬 = 一篇，各月等厚。
       * 量 computed height 而不是 rect 高度 —— 入场动画是 scaleY，
       * rect 会在动画途中量出偏小的高度（悬浮栏那边已经踩过一次）。
       */
      cloths: Array.from(document.querySelectorAll('.bars .bar')).map((b) => ({
        has: b.classList.contains('has'),
        n: Number((b.querySelector('.bar-n') || {}).textContent || 0),
        h: Math.round(parseFloat(getComputedStyle(b.querySelector('.bar-fill')).height)),
      })),
      yearTick: !!document.querySelector('.bar[data-year-start]'),
      nowLab: getComputedStyle(document.querySelector('.bar.now .bar-lab') || document.body).color,
      plainLab: getComputedStyle(document.querySelector('.bar:not(.now) .bar-lab') || document.body).color,
    };
  })()`);
  if (mast.present) {
    check(
      '首屏是左右分栏的站格（非居中模板脸）',
      mast.align !== 'center' && (mast.loomSide === 'right' || mast.loomSide === 'below') && mast.actionsJustify !== 'center',
      `标题对齐=${mast.align} 机杼板位置=${mast.loomSide} 按钮排布=${mast.actionsJustify}`
    );
    check(
      '首屏机杼板是数据（12 格发布节奏），不是空装饰',
      mast.bars === 12 && mast.kite && mast.thread,
      `${mast.bars} 格（其中有发布 ${mast.barsWithPosts} 格）· 纸鸢=${mast.kite} · 纬线=${mast.thread}`
    );
    /*
     * 布的编码契约：一趟纬 = 一篇，各月等厚，空档不留东西。
     * 这三条是"把柱状图改成织布"的全部承诺，破一条就退回成普通图表。
     */
    const bare = mast.cloths.filter((c) => !c.has);
    check(
      '机杼板：没发布的月份布高为 0（不留 3% 的假柱子）',
      bare.every((c) => c.h === 0),
      `${bare.length} 个空档，最高的空档 ${bare.length ? Math.max(...bare.map((c) => c.h)) : 0}px`
    );
    const woven = mast.cloths.filter((c) => c.has && c.n > 0);
    /* h = n*band + (n-1)*2  →  band = (h+2)/n - 2 */
    const bands = woven.map((c) => (c.h + 2) / c.n - 2);
    check(
      '机杼板：布按"一趟纬 = 一篇"等厚，且顶不破格子',
      woven.length > 0 &&
        bands.every((b) => Math.abs(b - bands[0]) <= 1 && b >= 3) &&
        woven.every((c) => c.h <= 72),
      woven.map((c) => `${c.n} 篇→${c.h}px`).join(' / ') || '这一年没有发布'
    );
    check(
      '机杼板：跨年的那一格有分经线，当月刻度被点名',
      mast.yearTick && mast.nowLab !== mast.plainLab,
      `分经=${mast.yearTick} 当月刻度 ${mast.nowLab} / 其它月份刻度 ${mast.plainLab}`
    );
    check(
      '站名不用渐变字（AI 风指纹），且命中品牌字',
      mast.clipText !== 'text' && !/gradient/i.test(mast.bgImage) && /lxgw wenkai/i.test(mast.font),
      `background-clip=${mast.clipText} background-image=${mast.bgImage.slice(0, 24)} family="${mast.font.slice(0, 26)}…"`
    );
  } else {
    check('首屏站格元素齐全', false, '未找到 .wordmark / .loom-plate / .mast-actions');
  }

  // =========================================================================
  // 5c-3. 社交入口：RSS 已从名片区移除，但 <head> 的订阅声明必须留着
  // =========================================================================
  const rss = await cdp.evaluate(`(() => {
    const scope = document.querySelectorAll('header, footer, .profile, .dock');
    const hits = [];
    for (const box of scope) {
      for (const el of box.querySelectorAll('a, button')) {
        const text = \`\${el.textContent || ''} \${el.getAttribute('aria-label') || ''} \${el.getAttribute('title') || ''}\`;
        if (/rss|订阅|feed/i.test(text)) hits.push(text.trim());
      }
    }
    const social = Array.from(document.querySelectorAll('.profile .social a')).map((a) => a.textContent.trim());
    return {
      hits,
      social,
      alternate: !!document.querySelector('link[rel="alternate"][type="application/rss+xml"]'),
    };
  })()`);
  check(
    '顶栏/页脚/名片/悬浮栏里没有 RSS 按钮',
    rss.hits.length === 0,
    rss.hits.length ? `仍残留：${rss.hits.join(' | ')}` : '干净'
  );
  check(
    '名片区社交入口是 B 站 + GitHub',
    rss.social.join(',') === 'B 站,GitHub',
    `实际：${rss.social.join('、') || '(空)'}`
  );
  check('head 里的 RSS 订阅声明保留', rss.alternate, `link rel=alternate application/rss+xml: ${rss.alternate}`);

  // =========================================================================
  // 5c-4. 常驻悬浮栏（机杼匣）：存在、默认折叠、左置、毛玻璃、可展开、状态持久化
  //
  // ★ 量玻璃之前必须显式把 prefers-reduced-transparency 钉成 no-preference。
  //   这台机器的 Windows 关了「透明效果」，Chromium 会把它映射成 reduce，
  //   于是 .m3-glass 走进实底兜底分支 —— 量到的 backdrop-filter: none 会被
  //   误读成"玻璃没做出来"。真实访客里有一样的情况，所以兜底那条分支
  //   在下面也单独验一次（.m3-glass 的两个方向都要有断言，否则谁都不敢改）。
  // =========================================================================
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }],
  });
  await goto('/');
  const dockIdle = await cdp.evaluate(`(() => {
    const dock = document.querySelector('.dock');
    if (!dock) return { present: false };
    const rail = dock.querySelector('.rail');
    const panel = dock.querySelector('.panel');
    const main = document.querySelector('.main-col');
    const rr = rail.getBoundingClientRect();
    const mr = main ? main.getBoundingClientRect() : null;
    const rs = getComputedStyle(rail);
    const ps = getComputedStyle(panel);
    return {
      present: true,
      vw: window.innerWidth,
      collapsed: dock.dataset.collapsed,
      storedAtLoad: localStorage.getItem('jyuanblog:dock'),
      transparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      href: location.pathname,
      dockW: Math.round(dock.getBoundingClientRect().width),
      sections: Array.from(dock.querySelectorAll('.rail-btn[data-section]')).map((b) => b.dataset.section),
      railPos: rs.position,
      railW: Math.round(rr.width),
      railH: Math.round(rr.height),
      railLeft: Math.round(rr.left),
      railRight: Math.round(rr.right),
      railBackdrop: rs.backdropFilter || 'none',
      railBg: rs.backgroundColor,
      /* 几何串台时这三条是唯一能说清事实的东西：容器盒、条的实际偏移、
         面板的 left 计算值。少了它们只能靠猜（猜错过一次，代价两轮回归）。 */
      dockRect: {
        left: Math.round(dock.getBoundingClientRect().left),
        w: Math.round(dock.getBoundingClientRect().width),
      },
      railStyleLeft: rs.left,
      railStyleWidth: rs.width,
      panelStyleLeft: ps.left,

      mainW: mr ? Math.round(mr.width) : null,
      mainLeft: mr ? Math.round(mr.left) : null,
      mainRight: mr ? Math.round(mr.right) : null,
      panelShown: ps.display !== 'none',
      panelRadius: ps.borderTopLeftRadius,
      panelBackdrop: ps.backdropFilter || 'none',
      panelBg: ps.backgroundColor,
      panelFlow: ps.animationName,
      dockVtn: getComputedStyle(dock).viewTransitionName,
      // 玻璃类断言失败时先分清是"浏览器不支持"还是"样式没挂上"，
      // 两者的修法完全相反（前者要兜底，后者要查选择器/优先级）。
      probe: {
        supportsBackdrop: CSS.supports('backdrop-filter', 'blur(2px)'),
        supportsColorMix: CSS.supports('background-color', 'color-mix(in srgb, red 74%, transparent)'),
        matches: panel.matches('.m3-glass'),
        tokens: {
          bg: ps.getPropertyValue('--glass-bg').trim(),
          blur: ps.getPropertyValue('--glass-blur').trim(),
        },
        glassRules: [...document.styleSheets].reduce((n, s) => {
          try { return n + Array.from(s.cssRules).filter((r) => r.cssText.includes('m3-glass')).length; } catch { return n; }
        }, 0),
        sheets: document.styleSheets.length,
        ua: navigator.userAgent.slice(-14),
      },
      // 已删掉的路由不许从任何地方重新长出链接
      deadLinks: Array.from(document.querySelectorAll('a[href^="/categories"], a[href^="/tags"]'))
        .map((a) => a.getAttribute('href')),
      // 玻璃必须带实底兜底：@supports 与 prefers-reduced-transparency 两条
      glassFallbacks: [...document.styleSheets]
        .flatMap((s) => {
          try { return Array.from(s.cssRules).map((r) => r.cssText); } catch { return []; }
        })
        .filter((t) => /prefers-reduced-transparency|@supports not/.test(t) && /m3-glass/.test(t)).length,
    };
  })()`);
  check('常驻悬浮栏存在', dockIdle.present, `分区：${(dockIdle.sections || []).join('、')}`);
  if (dockIdle.present) {
    check(
      '悬浮栏默认折叠（只留图标条，面板不出现）',
      dockIdle.collapsed === 'true' && dockIdle.panelShown === false,
      `data-collapsed=${dockIdle.collapsed} 面板可见=${dockIdle.panelShown} 存储=${dockIdle.storedAtLoad} 页面=${dockIdle.href}`
    );
    /*
     * 用户 2026-09-19 明确要求悬浮栏是半透明毛玻璃 —— 原「禁玻璃拟态」契约
     * 只在悬浮栏这一处作废。所以这里的断言方向是"必须有 blur + 必须有透明度"，
     * 而顶栏与设置面板那两条仍然要求 backdrop-filter: none。
     */
    check(
      '悬浮栏面板是毛玻璃（backdrop-filter 有 blur）',
      /blur\(\s*[0-9.]+px\s*\)/.test(dockIdle.panelBackdrop),
      `backdrop-filter=${dockIdle.panelBackdrop} · 探针 ${JSON.stringify(dockIdle.probe)}`
    );
    check(
      '悬浮栏面板底色半透明（玻璃不是实底刷个名）',
      alphaOf(dockIdle.panelBg) < 0.96 && alphaOf(dockIdle.panelBg) > 0.5,
      `background-color=${dockIdle.panelBg}`
    );
    check(
      '图标条也是玻璃，且比面板更通透（两档强度各自成立）',
      /blur\(/.test(dockIdle.railBackdrop) && alphaOf(dockIdle.railBg) < alphaOf(dockIdle.panelBg),
      `条 ${dockIdle.railBg}（backdrop=${dockIdle.railBackdrop}） / 面板 ${dockIdle.panelBg}`
    );
    check(
      '玻璃有两套实底兜底（@supports 与 reduced-transparency）',
      dockIdle.glassFallbacks >= 2,
      `命中 ${dockIdle.glassFallbacks} 条兜底规则`
    );
    /*
     * 兜底那一支不是"以防万一"的死代码：Windows 关掉「透明效果」的访客
     * 会命中 prefers-reduced-transparency: reduce，Chromium 量到的就是它。
     * 所以这里反过来验一次：reduce 时必须退回"不透明 + 无 blur"，
     * 而不是留一块半透明又糊不住的板子（那种最难读）。
     */
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    });
    await goto('/');
    const glassSolid = await cdp.evaluate(`(() => {
      const panel = document.querySelector('.dock .panel');
      const ps = getComputedStyle(panel);
      return {
        reduce: matchMedia('(prefers-reduced-transparency: reduce)').matches,
        backdrop: ps.backdropFilter || 'none',
        bg: ps.backgroundColor,
      };
    })()`);
    check(
      '系统要求减少透明度时，玻璃退回实底且不 blur',
      glassSolid.reduce && glassSolid.backdrop === 'none' && alphaOf(glassSolid.bg) >= 0.99,
      `reduce=${glassSolid.reduce} backdrop-filter=${glassSolid.backdrop} 底色=${glassSolid.bg}`
    );
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }],
    });
    await goto('/');
    check(
      '不再链向已删除的分类/标签路由',
      dockIdle.deadLinks.length === 0,
      dockIdle.deadLinks.join(', ') || '干净'
    );
    check('悬浮栏翻页时保持同一元素身份', dockIdle.dockVtn === 'dock', `view-transition-name=${dockIdle.dockVtn}`);
    if (dockIdle.vw >= 1280) {
      check(
        '≥1280px：图标条竖排在正文**左**侧且不侵入正文',
        dockIdle.railPos === 'relative' &&
          dockIdle.railW <= 72 &&
          dockIdle.railH > dockIdle.railW &&
          dockIdle.railRight <= dockIdle.mainLeft,
        `rail ${dockIdle.railW}×${dockIdle.railH} 右缘 ${dockIdle.railRight} ≤ 主列左缘 ${dockIdle.mainLeft}`
      );
      check(
        '≥1280px：加了悬浮栏之后主列仍 >= 840px（版心不变量）',
        dockIdle.mainW >= 840,
        `视口 ${dockIdle.vw}px 下主列 ${dockIdle.mainW}px`
      );
    }

    /* ---- 展开：点图标 → 面板出现 → 状态写进 jyuanblog:dock ---- */
    const dockOpen = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const btn = document.querySelector('.rail-btn[data-section]');
      if (!btn) return null;
      // 悬浮栏的脚本是外部模块，水合需要一点时间：点不开就重试
      for (let i = 0; i < 40; i++) {
        btn.click();
        await wait(50);
        if (document.querySelector('.dock').dataset.collapsed === 'false') break;
      }
      const dock = document.querySelector('.dock');
      const panel = dock.querySelector('.panel');
      /*
       * 等入场动画跑完再量。面板的进场是 translateX(-14px) + scale(.97)，
       * 半途量到的 rect 会整体偏左 14px、宽度少 10px —— 报出来像"面板压在
       * 图标条上、宽度不对"，其实是量早了。动画被系统关掉时 getAnimations()
       * 返回空数组，这里等价于直接量，不会多等。
       */
      try {
        await Promise.race([
          Promise.all(panel.getAnimations({ subtree: true }).map((a) => a.finished)),
          wait(900),
        ]);
      } catch {
        /* 动画被取消时 finished 会 reject，不影响测量 */
      }
      const pr = panel.getBoundingClientRect();
      const rr = dock.querySelector('.rail').getBoundingClientRect();
      const main = document.querySelector('.main-col');
      const mr = main ? main.getBoundingClientRect() : null;
      return {
        collapsed: dock.dataset.collapsed,
        pane: dock.dataset.pane,
        shown: getComputedStyle(panel).display !== 'none',
        w: Math.round(pr.width),
        left: Math.round(pr.left),
        right: Math.round(pr.right),
        top: Math.round(pr.top),
        bottom: Math.round(pr.bottom),
        railRight: Math.round(rr.right),
        vw: window.innerWidth,
        vh: window.innerHeight,
        // 面板向右展开之后仍然整块在视口内（左置最容易犯的错是把它顶出左边界）
        inViewport: pr.left >= 0 && pr.right <= window.innerWidth && pr.bottom <= window.innerHeight,
        aria: btn.getAttribute('aria-expanded'),
        visiblePane: panel.querySelector('.pane:not([style*="display: none"])') ? true : false,
        stored: localStorage.getItem('jyuanblog:dock'),
        allKeys: Object.keys(localStorage),
        mainW: mr ? Math.round(mr.width) : null,
      };
    })()`);
    if (dockOpen) {
      check(
        '点图标可展开面板，且图标上有展开态回显',
        dockOpen.collapsed === 'false' && dockOpen.shown && dockOpen.aria === 'true',
        `data-collapsed=${dockOpen.collapsed} 面板=${dockOpen.shown} aria-expanded=${dockOpen.aria}`
      );
      check(
        '展开的面板是浮层（344px 档 + 28px 圆角），不占栅格宽度',
        dockOpen.w >= 320 && dockOpen.w <= 370 && parseFloat(dockIdle.panelRadius) === 28,
        `面板宽 ${dockOpen.w}px 圆角 ${dockIdle.panelRadius}`
      );
      check(
        '面板从图标条右侧展开，且整块在视口内',
        dockIdle.vw >= 768 ? dockOpen.left >= dockOpen.railRight && dockOpen.inViewport : true,
        `面板 L${dockOpen.left} R${dockOpen.right} B${dockOpen.bottom} · 视口 ${dockOpen.vw}×${dockOpen.vh} · 在视口内=${dockOpen.inViewport} · 容器 dock[${dockIdle.dockRect.left} w${dockIdle.dockRect.w}] 条[${dockIdle.railLeft}..${dockIdle.railRight}] 条样式 left=${dockIdle.railStyleLeft} width=${dockIdle.railStyleWidth} 面板 left=${dockIdle.panelStyleLeft}`
      );
      check(
        '展开动效挂在面板上（有 keyframes，不是瞬间切换）',
        /^m3-dock-/.test(dockIdle.panelFlow || ''),
        `animation-name=${dockIdle.panelFlow}`
      );
      if (dockIdle.vw >= 1280) {
        check(
          '面板展开时主列宽度不变（浮层没把正文挤窄）',
          dockOpen.mainW === dockIdle.mainW,
          `展开前 ${dockIdle.mainW}px → 展开后 ${dockOpen.mainW}px`
        );
      }
      check(
        '折叠状态持久化，键名以 jyuanblog: 开头',
        !!dockOpen.stored && JSON.parse(dockOpen.stored).pinned === true,
        `jyuanblog:dock = ${dockOpen.stored}`
      );
      const stray = dockOpen.allKeys.filter((k) => !k.startsWith('jyuanblog:'));
      check('本地存储键全部在 jyuanblog: 命名空间下', stray.length === 0, stray.join(', ') || '干净');

      /* ---- 跨页保持：钉住之后翻页仍是展开态 ---- */
      await goto('/blog/');
      const dockKept = await cdp.evaluate(`(() => {
        const dock = document.querySelector('.dock');
        if (!dock) return null;
        const panel = dock.querySelector('.panel');
        return {
          collapsed: dock.dataset.collapsed,
          pane: dock.dataset.pane,
          shown: getComputedStyle(panel).display !== 'none',
        };
      })()`);
      check(
        '钉住的面板跨页保持展开（悬浮栏真的跨页常驻）',
        !!dockKept && dockKept.collapsed === 'false' && dockKept.shown,
        dockKept ? `翻页后 data-collapsed=${dockKept.collapsed} 面板可见=${dockKept.shown}` : '文章页找不到悬浮栏'
      );

      /* ---- Esc 收起 ---- */
      const dockEsc = await cdp.evaluate(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await wait(80);
        const dock = document.querySelector('.dock');
        return {
          collapsed: dock.dataset.collapsed,
          stored: JSON.parse(localStorage.getItem('jyuanblog:dock') || '{}'),
        };
      })()`);
      check(
        'Esc 能收起悬浮栏并落盘',
        dockEsc.collapsed === 'true' && dockEsc.stored.pinned === false,
        `data-collapsed=${dockEsc.collapsed} 存储=${JSON.stringify(dockEsc.stored)}`
      );
    } else {
      check('悬浮栏可展开', false, '页面上找不到图标条');
    }

    await goto('/');
  }

  // =========================================================================
  // 5c-5. 顶栏明暗一键切换 + 设置面板（焦点陷阱 / Esc / 选中态 / 浮层形状）
  // =========================================================================
  const toggle = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const btn = document.getElementById('theme-toggle');
    if (!btn) return null;
    const before = document.documentElement.classList.contains('dark');
    btn.click();
    await wait(120);
    const after = document.documentElement.classList.contains('dark');
    const echo = btn.dataset.mode;
    const stored = JSON.parse(localStorage.getItem('jyuanblog:settings') || '{}');
    const label = btn.getAttribute('aria-label');
    btn.click();
    await wait(120);
    return {
      before,
      after,
      echo,
      mode: stored.mode,
      label,
      back: document.documentElement.classList.contains('dark') === before,
      hasIcon: !!btn.querySelector('.ico svg'),
    };
  })()`);
  if (toggle) {
    check(
      '顶栏一键切换明暗：点一下真的翻转',
      toggle.before !== toggle.after,
      `点击前 dark=${toggle.before} → 后 ${toggle.after}`
    );
    check(
      '切换结果落盘且按钮有状态回显',
      (toggle.mode === 'dark' || toggle.mode === 'light') && toggle.echo === toggle.mode && toggle.hasIcon,
      `settings.mode=${toggle.mode} 按钮 data-mode=${toggle.echo} 文案「${toggle.label}」`
    );
    check('再点一次回到原状态', toggle.back, `dark=${toggle.back}`);
  } else {
    check('顶栏有明暗切换按钮', false, '未找到 #theme-toggle');
  }

  const sheet = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
    const trigger = document.getElementById('settings-trigger');
    if (!trigger) return { found: false };
    for (let i = 0; i < 40; i++) {
      trigger.click();
      await wait(60);
      if (document.querySelector('[role="dialog"]')) break;
    }
    const panel = document.querySelector('[role="dialog"]');
    if (!panel) return { found: false };
    const s = getComputedStyle(panel);
    const items = Array.from(panel.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    // 焦点陷阱：Tab 从最后一个可聚焦元素应当绕回第一个，而不是掉到背后的页面里
    items[items.length - 1].focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    panel.dispatchEvent(ev);
    const wrappedTo = document.activeElement === items[0];
    const outside = !panel.contains(document.activeElement);
    const activeOpt = panel.querySelector('[role="radio"][aria-checked="true"]');
    const inactive = panel.querySelector('[role="radio"][aria-checked="false"]');
    /*
     * 计算样式必须在关闭之前**取值快照**。getComputedStyle 返回的是活对象，
     * 而面板关掉后已从文档里移除 —— 事后再读它的属性只会拿到空字符串，
     * 于是断言拿着 '' 判失败，看起来像"圆角没生效"，其实是取值时机错了。
     */
    const snap = {
      radius: s.borderTopLeftRadius,
      backdrop: s.backdropFilter,
      activeBg: activeOpt ? getComputedStyle(activeOpt).backgroundColor : null,
      activeWeight: activeOpt ? getComputedStyle(activeOpt).fontWeight : null,
      inactiveBg: inactive ? getComputedStyle(inactive).backgroundColor : null,
      count: panel.querySelectorAll('[role="radio"]').length,
      checked: panel.querySelectorAll('[role="radio"][aria-checked="true"]').length,
    };
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    panel.dispatchEvent(esc);
    await wait(400);
    return {
      found: true,
      ...snap,
      expandedAttr: trigger.getAttribute('aria-expanded'),
      wrappedTo,
      outside,
      closed: !document.querySelector('[role="dialog"]'),
      focusBack: document.activeElement === trigger,
    };
  })()`);
  if (sheet.found) {
    check(
      '设置面板是浮层形状契约（28px），且不用毛玻璃',
      parseFloat(sheet.radius) === 28 && (sheet.backdrop === 'none' || !sheet.backdrop),
      `圆角 ${sheet.radius} backdrop-filter=${sheet.backdrop}`
    );
    check(
      '面板里当前值有可见的选中态（radio + 容器色 + 加粗）',
      sheet.count > 8 && sheet.checked >= 3 && sheet.activeBg !== sheet.inactiveBg && Number(sheet.activeWeight) >= 600,
      `${sheet.count} 个选项 / ${sheet.checked} 个选中；选中底 ${sheet.activeBg} 未选底 ${sheet.inactiveBg} 字重 ${sheet.activeWeight}`
    );
    check(
      '面板有焦点陷阱：Tab 从末元素绕回首元素，不逃到背后页面',
      sheet.wrappedTo && !sheet.outside,
      `绕回首元素=${sheet.wrappedTo} 焦点在面板外=${sheet.outside}`
    );
    check(
      'Esc 关闭面板并把焦点还给触发按钮',
      sheet.closed && sheet.focusBack,
      `面板已关=${sheet.closed} 焦点回到按钮=${sheet.focusBack} aria-expanded=${sheet.expandedAttr}`
    );
  } else {
    check('设置面板能打开', false, '点 #settings-trigger 之后找不到 [role=dialog]');
  }

  // 清掉这一节写下的本地存储，后面的窄屏检查要从"新访客"状态开始
  await cdp.evaluate(`(() => { localStorage.clear(); return 1 })()`);

  // =========================================================================
  // 5d. 时间线页：能渲染、链路协议安全
  // =========================================================================
  await goto('/timeline/');
  const tl = await cdp.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll('#stream .node'));
    const links = Array.from(document.querySelectorAll('#stream a[href]'));
    const bad = links
      .map((a) => a.getAttribute('href') || '')
      .filter((h) => /^javascript:/i.test(h.replace(/\\s/g, '')));
    const buttons = document.querySelectorAll('.filters [data-filter]');
    return { nodes: nodes.length, links: links.length, bad: bad.length, buttons: buttons.length };
  })()`);
  check('时间线页有节点渲染', tl.nodes > 0, `${tl.nodes} 个节点`);
  check('时间线页有分类筛选片', tl.buttons > 1, `${tl.buttons} 个按钮`);
  check('时间线页无 javascript: 链接', tl.bad === 0, `检查 ${tl.links} 个链接，可疑 ${tl.bad} 个`);

  // 筛选交互真的生效（点第二个筛选片后节点数应变化），且归位动画只在筛过之后才挂
  const filtered = await cdp.evaluate(`(async () => {
    const btns = Array.from(document.querySelectorAll('.filters [data-filter]'));
    const stream = document.getElementById('stream');
    const before = document.querySelectorAll('#stream .node:not([hidden])').length;
    const beforeAnim = getComputedStyle(document.querySelector('#stream .node')).animationName;
    const target = btns.find((b) => b.dataset.filter !== 'all');
    if (!target) return null;
    target.click();
    await new Promise((r) => setTimeout(r, 60));
    const after = document.querySelectorAll('#stream .node:not([hidden])').length;
    const afterAnim = getComputedStyle(document.querySelector('#stream .node:not([hidden])')).animationName;
    const marked = stream.getAttribute('data-filtered');
    btns[0].click(); // 还原，避免影响后续断言
    await new Promise((r) => setTimeout(r, 60));
    return { before, after, filter: target.dataset.filter, beforeAnim, afterAnim, marked };
  })()`);
  if (filtered) {
    check(
      '分类筛选真的改变了可见节点数',
      filtered.after !== filtered.before,
      `筛选「${filtered.filter}」前 ${filtered.before} → 后 ${filtered.after}`
    );
    check(
      '筛选归位动画只在筛过之后挂上（首屏不无端飞卡片）',
      filtered.beforeAnim === 'none' && filtered.afterAnim !== 'none' && filtered.marked === filtered.filter,
      `筛前 animation-name=${filtered.beforeAnim} → 筛后 ${filtered.afterAnim}（data-filtered=${filtered.marked}）`
    );
  }

  // =========================================================================
  // 5e. 归档页承接了分类页与标签页（2026-09-19 四个路由并进来的去处）
  //     筛选是客户端的：静态站的 /archives?category=x 与 /archives 同一个文件，
  //     所以必须验"全量列表本来就在 HTML 里"（禁 JS 时退化成不过滤，不是空页）
  // =========================================================================
  await goto('/archives/');
  const archAll = await cdp.evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('[data-item]'));
    const catChip = document.querySelector('[data-filter-cat]');
    const tagChip = document.querySelector('[data-filter-tag]');
    return {
      items: items.length,
      blogLinks: document.querySelectorAll('#archive-stream a[href^="/blog/"]').length,
      cat: catChip ? catChip.dataset.filterCat : null,
      tag: tagChip ? tagChip.dataset.filterTag : null,
      catChips: document.querySelectorAll('[data-filter-cat]').length,
      status: (document.querySelector('.filter-status') || {}).textContent,
      hiddenByDefault: items.filter((el) => el.hidden).length,
    };
  })()`);
  check('归档页有分类与标签的筛选入口', archAll.catChips > 0 && !!archAll.tag, `${archAll.catChips} 枚分类片块 / 标签 ${archAll.tag ? '有' : '无'}`);
  check('未筛选时归档列出全部条目', archAll.items > 0 && archAll.hiddenByDefault === 0, `${archAll.items} 条，隐藏 ${archAll.hiddenByDefault} 条`);

  const rawArch = await fetch(`${BASE}/archives/`).then((r) => r.text());
  const rawBlogLinks = (rawArch.match(/href="\/blog\//g) || []).length;
  check(
    '禁用 JS 也拿得到全量列表（筛选是渐进增强）',
    rawBlogLinks >= archAll.blogLinks && rawBlogLinks > 0,
    `HTML 里 ${rawBlogLinks} 条文章链接 / 渲染后 ${archAll.blogLinks} 条`
  );

  if (archAll.cat) {
    await goto(`/archives/?category=${encodeURIComponent(archAll.cat)}`);
    const one = await cdp.evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const items = Array.from(document.querySelectorAll('[data-item]'));
      const slug = ${JSON.stringify(archAll.cat)};
      let status = document.querySelector('.filter-status');
      for (let i = 0; i < 40; i++) {
        if (status && /命中/.test(status.textContent || '')) break;
        await wait(50);
        status = document.querySelector('.filter-status');
      }
      const visible = items.filter((el) => !el.hidden);
      return {
        visible: visible.length,
        wrongCat: visible.filter((el) => el.dataset.cat !== slug).length,
        emptyGroups: Array.from(document.querySelectorAll('[data-group]')).filter((g) => g.hidden).length,
        totalGroups: document.querySelectorAll('[data-group]').length,
        status: status ? status.textContent : null,
        // 页内片块与悬浮栏那条链接要一起点亮（栏的意义就是"告诉读者站在哪"）
        lit: document.querySelectorAll('[data-filter-cat][aria-current="true"]').length,
        inDock: document.querySelectorAll('.dock [data-filter-cat][aria-current="true"]').length,
        clear: !document.querySelector('[data-clear]').hidden,
      };
    })()`);
    check(
      '带 ?category= 时只留下该分类的文章',
      one.visible > 0 && one.wrongCat === 0 && one.visible < archAll.items,
      `可见 ${one.visible} / ${archAll.items}，串类 ${one.wrongCat} 条`
    );
    check('筛选状态有文字回显（role=status）', /命中/.test(one.status || ''), one.status || '(空)');
    check(
      '页内片块与悬浮栏里的同一条分类一起点亮',
      one.lit >= 2 && one.inDock >= 1,
      `点亮 ${one.lit} 处，其中悬浮栏 ${one.inDock} 处`
    );
    check('给出「清除筛选」的出口', one.clear, 'data-clear 可见');

    if (archAll.tag) {
      await goto(`/archives/?category=${encodeURIComponent(archAll.cat)}&tag=${encodeURIComponent(archAll.tag)}`);
      const both = await cdp.evaluate(`(() => {
        const cat = ${JSON.stringify(archAll.cat)};
        const tag = ${JSON.stringify(archAll.tag)};
        const visible = Array.from(document.querySelectorAll('[data-item]')).filter((el) => !el.hidden);
        return {
          n: visible.length,
          bad: visible.filter((el) => el.dataset.cat !== cat || !(el.dataset.tags || '').split(' ').includes(tag)).length,
          anyEmpty: document.querySelectorAll('[data-group]:not([hidden])').length,
        };
      })()`);
      check(
        '分类与标签两个参数可以叠加',
        both.bad === 0 && both.n <= one.visible,
        `叠加后 ${both.n} 条（单筛 ${one.visible} 条），不匹配的 ${both.bad} 条`
      );
    }

    /* 旧地址必须 301 到对应的筛选态，否则会留下搜索引擎里的 404 */
    for (const [from, to] of [
      ['/categories/', '/archives/'],
      [`/categories/${archAll.cat}`, `/archives/?category=${archAll.cat}`],
      ...(archAll.tag ? [[`/tags/${archAll.tag}`, `/archives/?tag=${archAll.tag}`]] : []),
    ]) {
      const r = await fetch(BASE + from, { redirect: 'follow' }).catch((e) => ({ url: '', err: e.message }));
      const landed = String(r.url || '');
      check(
        `旧地址 ${from} 被 301 接到 ${to}`,
        landed.startsWith(BASE) && landed.includes(to),
        r.err ? `请求失败：${r.err}` : `实际落到 ${landed || '(没跳，可能已 404)'}`
      );
    }
  }
  await goto('/');

  // =========================================================================
  // 6. 降低动效偏好必须真正生效（无障碍：这不是装饰性开关）
  //    注意有两套独立机制，别混为一谈：
  //      a) 系统偏好 -> @media (prefers-reduced-motion: reduce)，纯 CSS 生效
  //      b) 访客在显示设置里手动关闭 -> :root.motion-reduced 类，靠 JS 打标
  //    这里验的是 (a)。断言必须落在"动画真的没跑"上，而不是类名上。
  // =========================================================================
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await goto('/');
  const reduced = await cdp.evaluate(`(() => {
    const c = document.querySelector('.m3-stagger > .m3-reveal');
    const card = document.querySelector('.m3-card');
    const root = getComputedStyle(document.documentElement);
    const cs = c ? getComputedStyle(c) : null;
    return {
      mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      revealName: cs ? cs.animationName : '(无元素)',
      revealTimeline: cs ? (cs.animationTimeline || 'auto') : '',
      revealDuration: cs ? cs.animationDuration : '',
      cardTransition: card ? getComputedStyle(card).transitionDuration : '',
      pageTransitionName: root.viewTransitionName,
    };
  })()`);
  check('媒体查询在模拟下确实命中', reduced.mediaMatches, `prefers-reduced-motion: reduce = ${reduced.mediaMatches}`);
  check(
    '系统偏好 reduce 时入场动画不生效',
    reduced.revealName === 'none' || px(reduced.revealDuration) < 0.01,
    `animation-name=${reduced.revealName} duration=${reduced.revealDuration} timeline=${reduced.revealTimeline}`
  );
  check(
    '系统偏好 reduce 时交互过渡被压到 ~0',
    px(reduced.cardTransition) < 0.01,
    `transition-duration=${reduced.cardTransition}`
  );
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });

  // 手动开关（:root.motion-reduced）走另一条路径，单独验一次 ——
  // 它同时还要关掉翻页过渡（view-transition-name: none）。
  const manual = await cdp.evaluate(`(() => {
    document.documentElement.classList.add('motion-reduced');
    const card = document.querySelector('.m3-card');
    const c = document.querySelector('.m3-stagger > .m3-reveal');
    const out = {
      cardTransition: card ? getComputedStyle(card).transitionDuration : '',
      revealTimeline: c ? (getComputedStyle(c).animationTimeline || 'auto') : '',
      pageTransitionName: getComputedStyle(document.documentElement).viewTransitionName,
    };
    document.documentElement.classList.remove('motion-reduced');
    return out;
  })()`);
  check(
    '手动关闭动效时时间轴被移除且翻页过渡关闭',
    manual.revealTimeline === 'none' && (manual.pageTransitionName === 'none' || manual.pageTransitionName === ''),
    `animation-timeline=${manual.revealTimeline} view-transition-name=${manual.pageTransitionName || 'none'}`
  );

  // =========================================================================
  // 7. 多端：窄屏（390px 手机）贴底药丸 + 悬浮玻璃卡；平板（900px）左侧竖条。
  //    两者都不许撑出横向滚动。
  //    放在最后跑：设备指标覆写会让后续量到的宽度全部变形，
  //    而且模拟完必须显式 clear，否则前面那些 1280px 档的断言会集体误判。
  // =========================================================================
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await goto('/');
  const mobile = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const dock = document.querySelector('.dock');
    if (!dock) return { present: false };
    const rail = dock.querySelector('.rail');
    const rr = rail.getBoundingClientRect();
    const s = getComputedStyle(rail);
    const btn = dock.querySelector('.rail-btn[data-section]');
    let opened = null;
    for (let i = 0; i < 40; i++) {
      btn.click();
      await wait(50);
      if (dock.dataset.collapsed === 'false') break;
    }
    const panel = dock.querySelector('.panel');
    await wait(400); // 等进场动画跑完，半途量到的 rect 偏左且窄（见上面 dockOpen 的注释）
    const pr = panel.getBoundingClientRect();
    const ps = getComputedStyle(panel);
    const scrimCS = getComputedStyle(dock.querySelector('[data-dock-scrim]'));
    const railCS = getComputedStyle(rail);
    opened = {
      shown: ps.display !== 'none',
      full: Math.round(pr.width),
      topRadius: ps.borderTopLeftRadius,
      bottom: Math.round(pr.bottom),
      scrim: scrimCS.display,
      scrimAlpha: scrimCS.backgroundColor,
      // 遮罩不许盖住图标条：否则手机上"换分区"只能关一次再开一次
      railAboveScrim: parseInt(railCS.zIndex, 10) > parseInt(scrimCS.zIndex, 10),
      pinned: dock.dataset.collapsed === 'false',
    };
    const main = document.querySelector('main');
    return {
      present: true,
      vw: window.innerWidth,
      railPos: s.position,
      horizontal: rr.width > rr.height,
      railW: Math.round(rr.width),
      railH: Math.round(rr.height),
      railTop: Math.round(rr.top),
      gapToBottom: Math.round(window.innerHeight - rr.bottom),
      overflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
      bodyPadBottom: Math.round(parseFloat(getComputedStyle(document.body).paddingBottom)),
      smallestTarget: Math.min(
        ...Array.from(dock.querySelectorAll('.rail-btn')).map((b) => Math.round(b.getBoundingClientRect().height))
      ),
      opened,
      mainW: Math.round(main.getBoundingClientRect().width),
    };
  })()`);
  if (mobile.present) {
    check(
      '窄屏：悬浮栏收成贴底的横向图标条',
      mobile.railPos === 'fixed' && mobile.horizontal && mobile.gapToBottom >= 8 && mobile.gapToBottom <= 40,
      `position=${mobile.railPos} ${mobile.railW}×${mobile.railH} 距底 ${mobile.gapToBottom}px`
    );
    check(
      '窄屏：图标条不撑出横向滚动，且给页脚留了高度',
      mobile.overflowX <= 0 && mobile.bodyPadBottom >= mobile.railH,
      `横向溢出 ${mobile.overflowX}px / body padding-bottom ${mobile.bodyPadBottom}px（条高 ${mobile.railH}px）`
    );
    check(
      '窄屏：触控目标不小于 48dp（M3 硬指标）',
      mobile.smallestTarget >= 48,
      `最矮的图标按钮 ${mobile.smallestTarget}px`
    );
    check(
      '窄屏：面板是一张浮在图标条上方的玻璃卡（28px 圆角 + 遮罩）',
      mobile.opened.shown &&
        mobile.opened.full >= 340 &&
        mobile.opened.full <= 380 &&
        parseFloat(mobile.opened.topRadius) === 28 &&
        mobile.opened.scrim !== 'none',
      `宽 ${mobile.opened.full}px 圆角 ${mobile.opened.topRadius} 遮罩 ${mobile.opened.scrim}`
    );
    check(
      '窄屏：展开的面板不压住图标条，且点得到别的分区',
      mobile.opened.bottom <= mobile.railTop && mobile.opened.railAboveScrim,
      `面板底边 ${mobile.opened.bottom} ≤ 条顶 ${mobile.railTop} · 条在遮罩之上=${mobile.opened.railAboveScrim}`
    );
  } else {
    check('窄屏存在悬浮栏', false, '390px 下找不到 .dock');
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  /* ---- 平板档（900×1180）：这一档不该退回手机形态，也不该硬套宽屏版心 ---- */
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 1180,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await goto('/');
  const tablet = await cdp.evaluate(`(() => {
    const dock = document.querySelector('.dock');
    if (!dock) return { present: false };
    const rail = dock.querySelector('.rail');
    const rr = rail.getBoundingClientRect();
    const main = document.querySelector('main');
    const mr = main.getBoundingClientRect();
    return {
      present: true,
      vw: window.innerWidth,
      railPos: getComputedStyle(rail).position,
      vertical: rr.height > rr.width,
      railLeft: Math.round(rr.left),
      railRight: Math.round(rr.right),
      mainLeft: Math.round(mr.left),
      mainW: Math.round(mr.width),
      bottomRail: rr.bottom > window.innerHeight - 8,
      railBottom: Math.round(rr.bottom),
      vh: window.innerHeight,
      overflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    };
  })()`);
  if (tablet.present) {
    check(
      '平板档（768–1279）：图标条是贴在正文左侧的竖条，不是贴底药丸',
      tablet.railPos === 'relative' && tablet.vertical && !tablet.bottomRail && tablet.railRight <= tablet.mainLeft,
      `position=${tablet.railPos} 竖排=${tablet.vertical} 贴底=${tablet.bottomRail}（条底 ${tablet.railBottom} / 视口高 ${tablet.vh}） 条右缘 ${tablet.railRight} ≤ 正文左缘 ${tablet.mainLeft}`
    );
    check(
      '平板档：正文拿剩下的宽度且没有横向溢出',
      tablet.mainW >= 560 && tablet.overflowX <= 0,
      `视口 ${tablet.vw}px → 正文 ${tablet.mainW}px，横向溢出 ${tablet.overflowX}px`
    );
  } else {
    check('平板档存在悬浮栏', false, '900px 下找不到 .dock');
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  /* ---- 横屏手机（844×390）：按宽度它属于左侧竖条那一档，但视口很矮 ------
     这一档最容易翻车的地方是面板比屏幕高 —— 竖排图标条 210px + 顶栏 64，
     390 的高度里已经没有余量了。 */
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 844,
    height: 390,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await goto('/');
  const land = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const dock = document.querySelector('.dock');
    if (!dock) return { present: false };
    const btn = dock.querySelector('.rail-btn[data-section]');
    for (let i = 0; i < 40; i++) {
      btn.click();
      await wait(50);
      if (dock.dataset.collapsed === 'false') break;
    }
    const panel = dock.querySelector('.panel');
    await wait(400); // 同上：等进场动画结束再量
    const pr = panel.getBoundingClientRect();
    const rail = dock.querySelector('.rail');
    const rr = rail.getBoundingClientRect();
    return {
      present: true,
      vertical: rr.height > rr.width,
      railFits: rr.bottom <= window.innerHeight,
      panelTop: Math.round(pr.top),
      panelBottom: Math.round(pr.bottom),
      panelFits: pr.top >= 0 && pr.bottom <= window.innerHeight,
      scrollable: getComputedStyle(panel.querySelector('.panel-body')).overflowY,
      vh: window.innerHeight,
      overflowX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    };
  })()`);
  if (land.present) {
    check(
      '横屏手机（844×390）：图标条与展开的面板都整块装得下',
      land.vertical && land.railFits && land.panelFits && land.scrollable === 'auto',
      `条竖排=${land.vertical} 条装得下=${land.railFits} 面板 ${land.panelTop}…${land.panelBottom} / 视口高 ${land.vh} 内部滚动=${land.scrollable}`
    );
    check('横屏手机：不撑出横向滚动', land.overflowX <= 0, `横向溢出 ${land.overflowX}px`);
  } else {
    check('横屏手机存在悬浮栏', false, '844×390 下找不到 .dock');
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  check('无 CSP 违规 / 无页面异常', violations.length === 0, violations.length ? violations.slice(0, 5).join(' | ') : '干净');

  ws.close();

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${failed.length === 0 ? '全部通过' : `${failed.length} 项未通过`}：${results.length - failed.length}/${results.length}`
  );
  if (failed.length) {
    console.log(failed.map((f) => `  × ${f.name} — ${f.detail}`).join('\n'));
    exitCode = 1;
  }
} catch (err) {
  console.error('校验脚本自身出错：', err.message);
  exitCode = 2;
} finally {
  edge.kill();
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* 目录可能仍被占用，忽略 */
  }
}
process.exit(exitCode);
