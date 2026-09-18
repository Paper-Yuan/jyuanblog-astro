/**
 * 图标名白名单。
 *
 * 单独抽出来是为了让**配置与数据文件**也能引用它：
 * 若它们把 icon 声明成 `string`，`<Icon name={...} />` 就无法通过类型检查，
 * 而且运行时会渲染出一个空 `<path>`（静默失效，不报错）。
 * 用同一个字面量联合，拼错图标名会在构建期就报错。
 */
export type IconName =
  | 'menu'
  | 'close'
  | 'search'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'auto'
  | 'home'
  | 'archive'
  | 'tag'
  | 'folder'
  | 'rss'
  | 'github'
  | 'arrow-left'
  | 'arrow-right'
  | 'clock'
  | 'eye'
  | 'comment'
  | 'heart'
  | 'grid'
  | 'list'
  | 'link'
  | 'flag'
  | 'code'
  | 'work'
  | 'map-pin'
  | 'music'
  | 'play'
  | 'pause'
  | 'skip-back'
  | 'skip-forward'
  | 'volume'
  | 'calendar';
