/**
 * 时间线配置（对齐 Shirone 的 `timelineConfig`）。
 *
 * ★ `enable: false` 时导航项不渲染，且 `/timeline` 在构建期就不产出页面
 *   ——比"产出后运行时报 404"更彻底：产物里根本没有这个文件。
 *   实现见 `src/pages/timeline.astro` 的 getStaticPaths。
 */
import type { IconName } from '@/lib/icons';

export const TIMELINE = {
  enable: true,

  /**
   * 筛选分类。**数组顺序即页面上筛选片的顺序**。
   * key 必须与 `src/data/timeline.ts` 里条目的 category 对应，
   * 否则那条目不会被任何筛选片显示（但仍会在"全部"里出现）。
   *
   * icon 用 `IconName` 而非 string：拼错会在构建期报错。
   */
  categories: [
    { key: 'milestone', label: '里程碑', icon: 'flag' },
    { key: 'project', label: '项目', icon: 'code' },
    { key: 'career', label: '经历', icon: 'work' },
    { key: 'life', label: '生活', icon: 'heart' },
  ] as { key: string; label: string; icon: IconName }[],

  /** 'desc' 最新在前（默认）；'asc' 最早在前，适合写成长期成长故事 */
  order: 'desc' as 'desc' | 'asc',

  /**
   * 按标题禁用单条（保留数据但不上屏）。
   * 用途：临时隐藏一条还没想好怎么写的经历，而不必删掉它。
   */
  disabledTitles: [] as string[],
} as const;

export type TimelineCategoryKey = (typeof TIMELINE)['categories'][number]['key'];
