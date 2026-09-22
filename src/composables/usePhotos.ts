import { computed, type ComputedRef } from 'vue'
import type { OverridesFile, PersonId, Photo, PhotoOverrides, PhotoTech, PhotosFile, Scene, Tag } from '@/types/photo'
import { PEOPLE, SCENES, TAGS } from '@/data/taxonomy'
import photosJson from '@/data/photos.json'
import overridesJson from '@/data/photos.overrides.json'

export interface PhotoSource {
  /** 全部照片，按 order 升序 */
  readonly all: ComputedRef<Photo[]>
  readonly featured: ComputedRef<Photo[]>
  readonly moments: ComputedRef<Photo[]>
  byId(id: string): Photo | undefined
  byScene(scene: Scene): Photo[]
  byPerson(person: PersonId): Photo[]
}

/**
 * 全站唯一的照片数据源（Wave 1-B）。
 *
 * - JSON 在模块顶层 merge 一次：无论多少组件调用 usePhotos()，都只解析一次；
 * - all / featured / moments 以及 byScene / byPerson 返回的是模块级缓存里的数组本身
 *   （这是"唯一数据源"的前提，也是"不重复计算大数组"的前提）：调用方只读，
 *   需要修改请先 filter / slice 出副本，不要就地 push / sort；
 * - 空结果一律现场返回新的 []（不共用同一个数组对象，避免调用方误改互相影响）；
 * - overrides 是未受信的手工输入：全字段走运行时校验，缺失即用默认值；
 * - photos.json 的 order 是唯一排序依据；overrides 里的 time 只覆盖拍摄时间，
 *   不参与重排（人工纠偏不应该打乱生成时的排序）。
 */

const photosFile: PhotosFile = photosJson

const SCENE_SET = new Set<string>(SCENES)
const PEOPLE_SET = new Set<string>(PEOPLE)
const TAG_SET = new Set<string>(TAGS)

/**
 * 人工标注来自 JSON，按"未受信数据"处理：不做类型断言，逐字段校验后再组装。
 * 必须放在上面的词表 Set 之后 —— 本行在模块初始化时就会执行。
 */
const rawOverrides: OverridesFile = asOverridesFile(overridesJson)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isScene(value: string): value is Scene {
  return SCENE_SET.has(value)
}

function isPerson(value: string): value is PersonId {
  return PEOPLE_SET.has(value)
}

function isTag(value: string): value is Tag {
  return TAG_SET.has(value)
}

/** 空字符串 / 非字符串一律当作"没有填" */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 只接受受控词表里的 key，拼错的 key 静默丢弃（不崩、不显示错误分类） */
function asScene(value: unknown): Scene | null {
  return typeof value === 'string' && isScene(value) ? value : null
}

function asPeople(value: unknown): PersonId[] {
  if (!Array.isArray(value)) return []
  const out: PersonId[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !isPerson(item) || out.includes(item)) continue
    out.push(item)
  }
  return out
}

function asTags(value: unknown): Tag[] {
  if (!Array.isArray(value)) return []
  const out: Tag[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !isTag(item) || out.includes(item)) continue
    out.push(item)
  }
  return out
}

/** 一条人工标注：逐字段校验 + 补默认值，产出受控形状 */
function asOverrides(value: unknown): PhotoOverrides {
  const record: Record<string, unknown> = isRecord(value) ? value : {}
  return {
    time: asText(record.time),
    featured: record.featured === true,
    moment: record.moment === true,
    scene: asScene(record.scene),
    people: asPeople(record.people),
    tags: asTags(record.tags),
    description: asText(record.description),
    // PhotoOverrides.focus 只允许 string | undefined（没有 null），缺失即 undefined
    focus: asText(record.focus) ?? undefined
  }
}

/** id → 人工标注；只认 photos.json 里可能出现的 id，其余在校验阶段被记录为孤立项 */
function asOverridesFile(value: unknown): OverridesFile {
  const file: OverridesFile = {}
  if (!isRecord(value)) return file
  for (const [id, entry] of Object.entries(value)) file[id] = asOverrides(entry)
  return file
}

function mergeOne(tech: PhotoTech, overrides: PhotoOverrides | undefined): Photo {
  const overrideTime = overrides?.time ?? null
  return {
    id: tech.id,
    src: tech.src,
    thumb: tech.thumb,
    medium: tech.medium,
    blur: tech.blur,
    width: tech.width,
    height: tech.height,
    ratio: tech.ratio,
    color: tech.color,
    order: tech.order,
    time: overrideTime ?? tech.time,
    featured: overrides?.featured === true,
    moment: overrides?.moment === true,
    scene: overrides?.scene ?? null,
    people: overrides?.people ?? [],
    tags: overrides?.tags ?? [],
    description: overrides?.description ?? null,
    focus: overrides?.focus ?? null
  }
}

interface PhotoStore {
  all: Photo[]
  byId: Map<string, Photo>
  byScene: Map<Scene, Photo[]>
  byPerson: Map<PersonId, Photo[]>
  featured: Photo[]
  moments: Photo[]
}

function buildStore(): PhotoStore {
  const all: Photo[] = []
  const seen = new Set<string>()
  let duplicates = 0

  for (const tech of photosFile.photos) {
    if (seen.has(tech.id)) {
      duplicates += 1
      continue
    }
    seen.add(tech.id)
    all.push(mergeOne(tech, rawOverrides[tech.id]))
  }

  // order 升序；Array.prototype.sort 自 ES2019 起稳定，order 相同时保持原文件顺序
  all.sort((a, b) => a.order - b.order)

  const byScene = new Map<Scene, Photo[]>()
  for (const scene of SCENES) byScene.set(scene, [])
  const byPerson = new Map<PersonId, Photo[]>()
  for (const person of PEOPLE) byPerson.set(person, [])

  const byId = new Map<string, Photo>()
  const featured: Photo[] = []
  const moments: Photo[] = []

  for (const photo of all) {
    byId.set(photo.id, photo)
    if (photo.featured) featured.push(photo)
    if (photo.moment) moments.push(photo)
    if (photo.scene !== null) byScene.get(photo.scene)?.push(photo)
    for (const person of photo.people) byPerson.get(person)?.push(photo)
  }

  const orphans = Object.keys(rawOverrides).filter((id) => !seen.has(id))
  if (duplicates > 0) {
    console.warn(`[usePhotos] photos.json 里有 ${duplicates} 张重复 id 的照片，已忽略`)
  }
  if (orphans.length > 0) {
    // 只提示一次（汇总），绝不抛错：photos.json 增删时 overrides 可能暂时对不上
    const sample = orphans.slice(0, 8).join('、')
    console.warn(
      `[usePhotos] photos.overrides.json 里有 ${orphans.length} 个 id 在 photos.json 中不存在，已忽略：${sample}${orphans.length > 8 ? ' 等' : ''}`
    )
  }

  return { all, byId, byScene, byPerson, featured, moments }
}

const store = buildStore()

const allPhotos = computed<Photo[]>(() => store.all)
const featuredPhotos = computed<Photo[]>(() => store.featured)
const momentPhotos = computed<Photo[]>(() => store.moments)

const source: PhotoSource = {
  all: allPhotos,
  featured: featuredPhotos,
  moments: momentPhotos,
  byId: (id: string) => store.byId.get(id),
  byScene: (scene: Scene) => store.byScene.get(scene) ?? [],
  byPerson: (person: PersonId) => store.byPerson.get(person) ?? []
}

/** 模块级单例：无论多少组件调用，只解析一次 JSON */
export function usePhotos(): PhotoSource {
  return source
}
