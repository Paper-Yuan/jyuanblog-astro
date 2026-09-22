# 第三方代码与资源声明（NOTICE）

本仓库整体以 MIT 许可发布（见根目录 `LICENSE`），**但下列内容不属于本项目原创，
按其各自的许可分发**。MIT 条款不适用于它们。

## `src/lib/vendor/material-color.mjs`

| | |
|---|---|
| 来源 | [`material-foundation/material-color-utilities`](https://github.com/material-foundation/material-color-utilities)（Google Material 团队） |
| 版本 | `@material/material-color-utilities@0.4.0` |
| 许可 | **Apache License 2.0** —— 原文见同目录 `material-color.LICENSE` |
| 形态 | 上游 `index.js` 的 esbuild 预打包产物，未改动逻辑 |

**为什么要打包进仓库**：上游 0.4.0 的 45 个文件里有 40 个使用省略扩展名的相对
import（如 `./dynamic_color`），Node 的严格 ESM 解析器会直接报
`ERR_MODULE_NOT_FOUND`；上游自己用宽松解析器 / pnpm，所以这个坑没在上游暴露。
预打包成单文件后，构建期的配色引擎与运行时用的是同一份实现。

**重新生成**（上游升级后执行）：

```bash
npx esbuild node_modules/@material/material-color-utilities/index.js \
  --bundle --format=esm --platform=neutral \
  --outfile=src/lib/vendor/material-color.mjs
```

⚠️ 生成后需**手工把本文件顶部那 6 行 Apache 归属注释加回去**——
esbuild 会覆盖整个文件，丢掉注释就等于丢了 Apache-2.0 要求的署名。

## `src/lib/mc-utils.ts`（配色引擎的移植部分）

HCT → M3 角色表的调度逻辑参考了
[LyraVoid/Shirone](https://github.com/LyraVoid/Shirone)（**MIT**）。
色彩计算本身来自上面那份 Apache-2.0 的库。

## 品牌字体

`/fonts/*.woff2` 是**构建期产物**，不在版本库里：
`scripts/build-fonts.mjs` 用 HarfBuzz WASM 按 dist 中真正出现的字符切子集。

| | |
|---|---|
| 字体 | 霞鹜文楷 LXGW WenKai（[`lxgw/LxgwWenKai`](https://github.com/lxgw/LxgwWenKai)） |
| 许可 | **SIL Open Font License 1.1** —— 原文见 `src/assets/fonts/OFL.txt`，构建时随字体子集一起发布到 `dist/fonts/OFL.txt` |
| 源字体 | 24 MB 的 TTF 不入库，由 `scripts/fetch-fonts.mjs` 按版本号 + sha256 拉取 |

## 图标

`src/components/Icon.astro` 内联了一小撮 24×24 描边图标（未引入 iconify / astro-icon
等依赖，也不加载图标字体）。**但这些形状与
[Feather Icons](https://feathericons.com)（MIT）/
[Lucide](https://lucide.dev)（ISC）的图标一致**，例如 `moon`、`search`、`menu`
的路径数据与两者同形。因此按图标体系的许可对待：MIT / ISC 均允许如此使用与再分发，
归属声明保留在本文件。若你复用本仓库，请把图标与本项目自有代码区分开。
