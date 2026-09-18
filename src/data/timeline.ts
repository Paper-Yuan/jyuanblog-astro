/**
 * 时间线数据。
 *
 * 字段与 Shirone 的 `TimelineItem` 对齐：
 *   必填 title / date / category
 *   可选 subtitle / location / description / highlights / tags / links / icon / featured
 *
 * `date` 是**自由文本**（文档明确如此）：可以写 `"2026.08"` 这样的单点，
 * 也可以写 `"2025.03 – 至今"` 这样的区间。不用 Date 类型是因为
 * 时间线常需要表达"某个时期"而非某个精确时刻，硬套日期反而要撒谎。
 *
 * ★ links 的 url 会被渲染进 <a href>，务必是 http/https。
 *   渲染层（timeline.astro）用 safeUrl() 做协议白名单兜底，
 *   但数据这里也别写奇怪的东西 —— 双重保险不等于可以在源头随意写。
 */
import type { IconName } from '@/lib/icons';

export interface TimelineLink {
  label: string;
  url: string;
  /** 取自 Icon.astro 的白名单键名，不是任意路径 */
  icon?: IconName;
}

export interface TimelineItem {
  title: string;
  date: string;
  category: string;
  subtitle?: string;
  location?: string;
  description?: string;
  highlights?: string[];
  tags?: string[];
  links?: TimelineLink[];
  icon?: IconName;
  featured?: boolean;
}

export const timelineData: TimelineItem[] = [
  {
    title: '千机志上线',
    date: '2026.09',
    category: 'milestone',
    subtitle: '个人博客',
    description:
      '把博客从早期实现重做成 Astro 静态前台 + Cloudflare Workers API + D1 的混合架构。' +
      '访客侧默认零 JS 负担，管理后台仍是独立的 Vue 应用，两者共用一个 Pages 项目。',
    highlights: [
      '访客前台改为静态生成，出厂配色在构建期算好直接内联',
      '接入 Material 3 Expressive 设计系统与 HCT 动态配色',
      '补齐账号体系、评论审核与安全响应头',
    ],
    tags: ['Astro', 'Svelte 5', 'Cloudflare Workers', 'D1'],
    icon: 'flag',
    featured: true,
  },
  {
    title: '互动小说引擎 StoryForge Lite',
    date: '2026.09',
    category: 'project',
    subtitle: '桌面端 + 安卓',
    description:
      '用 TypeScript + Vite 写的互动小说引擎，剧情用 YAML DSL 描述、Zod 校验，' +
      '打包为 Electron 桌面应用与安卓 APK。',
    highlights: [
      '事件驱动的状态机管理剧情流转',
      'AI 两阶段管线：规划 → 编译 → 校验 → 自修复',
      '可插拔的 LLM / TTS / 云存档 Provider',
    ],
    tags: ['TypeScript', 'Electron', 'Vite'],
    icon: 'code',
  },
  {
    title: '开始写技术博客',
    date: '2025 – 至今',
    category: 'life',
    subtitle: '写作',
    description:
      '把踩过的坑写下来。多数内容来自真实项目里的问题，而不是教程式的复述 —— ' +
      '能被复现的细节才有参考价值。',
    tags: ['写作'],
    icon: 'heart',
  },
];
