/**
 * 冻结于 Wave 0。并行开发期间不得修改。
 * 若必须修改：总控改本文件 → 通知所有相关代理 → 各自适配。
 */

/** 场景（受控词表，见 taxonomy.ts 的中文标签） */
export type Scene = 'preparation' | 'pickup' | 'ceremony' | 'family' | 'banquet' | 'after'

/** 人物（受控词表） */
export type PersonId =
  | 'sister' | 'groom' | 'father' | 'mother'
  | 'family' | 'friends' | 'bridesmaid' | 'groomsman' | 'kid'

/** 照片类型 / 标签（受控词表） */
export type Tag =
  | 'portrait' | 'candid' | 'detail' | 'scene'
  | 'group' | 'moment' | 'preparation' | 'emotion'

/** Gallery 的四种浏览模式（同一批数据，四种看法） */
export type GalleryView = 'masonry' | 'contact' | 'film' | 'timeline'

/** 由 scripts/process-images.mjs 生成的技术信息，禁止手改 */
export interface PhotoTech {
  id: string
  /** 长边 2048px WebP —— 仅全屏大图时加载 */
  src: string
  /** 长边 480px WebP —— 所有列表使用（网格、联系表、时间线缩略图） */
  thumb: string
  /** 长边 1280px WebP —— 桌面端中等尺寸展示（画册版面、Story 错落图、瞬间页）；小图不放大 */
  medium: string
  /** 20px WebP 模糊占位 */
  blur: string
  /** preview 的实际像素，用于 aspect-ratio 占位 */
  width: number
  height: number
  /** width / height，避免组件里重复计算 */
  ratio: number
  /** EXIF 拍摄时间（ISO 字符串），缺失为 null */
  time: string | null
  /** 主色，加载前的背景色，避免白闪 */
  color: string
  /** 按拍摄时间排出的全局序号 */
  order: number
}

/** 人工在 src/data/photos.overrides.json 中维护，脚本永不覆盖 */
export interface PhotoOverrides {
  featured?: boolean
  moment?: boolean
  scene?: Scene | null
  people?: PersonId[]
  tags?: Tag[]
  description?: string | null
  /** 允许人工纠正 EXIF 缺失/错误的时间 */
  time?: string | null
  /** 全屏裁切焦点，如 '50% 30%' */
  focus?: string
}

/**
 * 应用内唯一使用的照片类型（技术信息 + 人工标注合并后的结果）。
 * 所有组件只认这个类型。
 */
export interface Photo extends PhotoTech {
  featured: boolean
  moment: boolean
  scene: Scene | null
  people: PersonId[]
  tags: Tag[]
  description: string | null
  focus: string | null
}

export interface PhotosFile {
  generatedAt: string
  /** 是否来自占位图（true 时界面上不显示"暂无描述"之类的提示） */
  placeholder: boolean
  photos: PhotoTech[]
}

export type OverridesFile = Record<string, PhotoOverrides>

/** Story 章节（人工撰写，src/data/story.json） */
export interface StoryChapter {
  /** '08:23' */
  time: string
  title: string
  text?: string
  /** 显式指定照片；缺省时按时间段自动归属 */
  photoIds?: string[]
  scene?: Scene
}

export interface StoryFile {
  date: string
  chapters: StoryChapter[]
}

export interface PeopleFile {
  [id: string]: { label: string; note?: string }
}

export interface SiteFile {
  name: string
  heroTitle: string
  couple: string
  date: string
  dateDisplay: string
  secondScreen: { lines: string[]; cta: string }
  nav: { label: string; to: string }[]
  footer: string
}

export interface LetterFile {
  greeting: string
  paragraphs: string[]
  signature: string
  photoId: string | null
}
