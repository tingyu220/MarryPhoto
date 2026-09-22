import type { GalleryView, PersonId, Photo, Scene, Tag } from '@/types/photo'

/**
 * 分类体系的唯一来源。代码里只出现英文 key，中文只出现在 label。
 * 冻结于 Wave 0 —— 新增分类请先改 docs/01 再改这里。
 */

export const SCENE_LABELS: Record<Scene, string> = {
  preparation: '准备',
  pickup: '接亲',
  ceremony: '仪式',
  family: '家人',
  banquet: '晚宴',
  after: '散场'
}

export const PEOPLE_LABELS: Record<PersonId, string> = {
  sister: '姐姐',
  groom: '姐夫',
  father: '爸爸',
  mother: '妈妈',
  family: '家人',
  friends: '朋友',
  bridesmaid: '伴娘',
  groomsman: '伴郎',
  kid: '小朋友'
}

export const TAG_LABELS: Record<Tag, string> = {
  portrait: '人像',
  candid: '抓拍',
  detail: '细节',
  scene: '现场',
  group: '合照',
  moment: '瞬间',
  preparation: '准备',
  emotion: '表情'
}

export const SCENES = Object.keys(SCENE_LABELS) as Scene[]
export const PEOPLE = Object.keys(PEOPLE_LABELS) as PersonId[]
export const TAGS = Object.keys(TAG_LABELS) as Tag[]

/** Gallery 顶部的筛选行。返回的谓词必须无副作用。 */
export interface FilterDef {
  id: string
  label: string
  match: (p: Photo) => boolean
}

export const FILTERS: FilterDef[] = [
  { id: 'all', label: '全部', match: () => true },
  {
    id: 'wedding',
    label: '婚礼',
    match: (p) => p.scene !== null && ['preparation', 'pickup', 'ceremony', 'banquet'].includes(p.scene)
  },
  { id: 'family', label: '家人', match: (p) => p.people.some((x) => x === 'family' || x === 'father' || x === 'mother') },
  { id: 'friends', label: '朋友', match: (p) => p.people.some((x) => x === 'friends' || x === 'bridesmaid' || x === 'groomsman') },
  { id: 'candid', label: '抓拍', match: (p) => p.tags.includes('candid') },
  { id: 'scene', label: '现场', match: (p) => p.tags.includes('scene') },
  { id: 'detail', label: '细节', match: (p) => p.tags.includes('detail') }
]

export const GALLERY_VIEWS: { id: GalleryView; label: string }[] = [
  { id: 'masonry', label: '瀑布流' },
  { id: 'contact', label: '联系表' },
  { id: 'film', label: '胶片' },
  { id: 'timeline', label: '时间线' }
]

export function isGalleryView(v: unknown): v is GalleryView {
  return v === 'masonry' || v === 'contact' || v === 'film' || v === 'timeline'
}
