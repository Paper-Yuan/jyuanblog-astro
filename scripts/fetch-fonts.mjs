/**
 * 拉取品牌字体源文件（霞鹜文楷，OFL）。
 *
 * 为什么不进 git：单个 TTF 24 MB，而仓库里真正需要的产物只是构建期切出来的
 * 几十 KB 子集。源文件只在生成子集时用一次，所以按**固定版本 + sha256** 拉取，
 * 本地与 CI 各缓存一份。
 *
 * 用 curl 而不是 fetch：本机 Node 的 fetch 不读代理环境变量（已被 DNS 污染的
 * 网络下 github.com 直连不通），curl 会读 HTTPS_PROXY。
 *
 * 许可：OFL 允许把子集/转格式后的 web 字体保留保留字体名（见 OFL.txt 首段），
 * 但不得作为可安装的桌面字体分发 —— 我们只发 woff2 子集，且随包带 OFL.txt。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const DIR = join(ROOT, 'src/assets/fonts');

const VERSION = 'v1.520';
const BASE = `https://github.com/lxgw/LxgwWenKai/releases/download/${VERSION}`;

const PINS = [
  {
    file: 'LXGWWenKai-Regular.ttf',
    url: `${BASE}/LXGWWenKai-Regular.ttf`,
    sha256: '8d6ba638ac9553413354cfaab97637c1cd778444e259441ea1e5f8fb2c697fba',
  },
  {
    file: 'LXGWWenKai-Medium.ttf',
    url: `${BASE}/LXGWWenKai-Medium.ttf`,
    sha256: 'd7a98ff8898087f019e5617d026c3f83158926ec9e657184920dc4bc7d7d97c8',
  },
  {
    // 许可证必须随子集一起分发，所以它和字体同等对待（也要校验）
    file: 'OFL.txt',
    url: 'https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/OFL.txt',
    sha256: '1a25e35da1031c6c3436fde545bb9cb5aca954e9873afe510c834b8b79bd21a0',
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const download = (url, dest) => {
  execFileSync('curl', ['-fsSL', '--retry', '3', '--max-time', '600', '-o', dest, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
};

mkdirSync(DIR, { recursive: true });

let fetched = 0;
for (const pin of PINS) {
  const path = join(DIR, pin.file);
  if (existsSync(path)) {
    const local = sha256(readFileSync(path));
    if (local === pin.sha256) {
      console.log(`fonts: ${pin.file} 已就位且校验通过`);
      continue;
    }
    console.warn(`fonts: ${pin.file} 校验和不匹配（版本被改过？），重新下载`);
    rmSync(path);
  }
  download(pin.url, path);
  const local = sha256(readFileSync(path));
  if (local !== pin.sha256) {
    console.error(
      `fonts: ${pin.file} 下载后校验和仍不匹配\n  期望 ${pin.sha256}\n  实得 ${local}\n` +
        `上游可能在 ${VERSION} 之下重新发布过资产 —— 确认无误后更新 PINS，不要放宽校验。`
    );
    process.exit(1);
  }
  fetched += 1;
  console.log(`fonts: 已下载 ${pin.file}`);
}

console.log(fetched ? `fonts: 完成，新取 ${fetched} 个文件` : 'fonts: 完成，全部命中缓存');
