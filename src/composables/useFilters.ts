import { computed, hasInjectionContext, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useRoute, useRouter, type RouteLocationNormalizedLoaded, type Router } from 'vue-router'
import type { GalleryView, PersonId, Photo, Scene } from '@/types/photo'
import { FILTERS, GALLERY_VIEWS, isGalleryView, PEOPLE, SCENES } from '@/data/taxonomy'
import { usePhotos } from '@/composables/usePhotos'

export interface FilterState {
  readonly view: Ref<GalleryView> // ?view=masonry|contact|film|timeline
  readonly filterId: Ref<string> // ?f=all|wedding|family|friends|candid|scene|detail
  readonly person: Ref<PersonId | null> // ?p=sister
  readonly scene: Ref<Scene | null> // ?s=ceremony
  readonly filtered: ComputedRef<Photo[]> // 应用全部条件后的结果
  readonly filterOptions: { id: string; label: string; count: number }[] // 供筛选行显示张数
  setView(v: GalleryView): void
  setFilter(id: string): void
  setPerson(p: PersonId | null): void
  setScene(s: Scene | null): void
  reset(): void
}

const DEFAULT_VIEW: GalleryView = 'masonry'
const DEFAULT_FILTER = 'all'
const QUERY_VIEW = 'view'
const QUERY_FILTER = 'f'
const QUERY_PERSON = 'p'
const QUERY_SCENE = 's'

/** 张数只跟照片本身有关，模块级算一次 */
let optionCache: { id: string; label: string; count: number }[] | null = null

function buildFilterOptions(): { id: string; label: string; count: number }[] {
  if (optionCache === null) {
    const all = usePhotos().all.value
    optionCache = FILTERS.map((filter) => ({
      id: filter.id,
      label: filter.label,
      count: all.filter(filter.match).length
    }))
  }
  return optionCache
}

const PERSON_SET = new Set<string>(PEOPLE)
const SCENE_SET = new Set<string>(SCENES)

function isPerson(value: string): value is PersonId {
  return PERSON_SET.has(value)
}

function isScene(value: string): value is Scene {
  return SCENE_SET.has(value)
}

/** query 值可能是 string、string[] 或 null；取第一个非空字符串 */
function firstQueryValue(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) if (typeof item === 'string') return item
    return ''
  }
  return typeof value === 'string' ? value : ''
}

function readView(value: unknown): GalleryView {
  const raw = firstQueryValue(value)
  return GALLERY_VIEWS.some((item) => item.id === raw) && isGalleryView(raw) ? raw : DEFAULT_VIEW
}

function readFilter(value: unknown): string {
  const raw = firstQueryValue(value)
  return FILTERS.some((filter) => filter.id === raw) ? raw : DEFAULT_FILTER
}

function readPerson(value: unknown): PersonId | null {
  const raw = firstQueryValue(value)
  return isPerson(raw) ? raw : null
}

function readScene(value: unknown): Scene | null {
  const raw = firstQueryValue(value)
  return isScene(raw) ? raw : null
}

/**
 * 筛选状态 + URL 同步。
 *
 * 单向数据流：route.query 是唯一真相源 —— setXxx() 先用 router.replace 写 query
 * （replace 不新增历史记录），再顺着 watch(route.query) 把值同步回本地 ref。
 * 本地 ref 只在写 URL 的同一帧内做一次乐观更新，保证 UI 立刻响应。
 *
 * 没有 router 上下文时（单测 / Storybook / 组件被独立挂载）：
 * hasInjectionContext() 为 false，不去调 useRoute()/useRouter()（避免 Vue 的注入告警），
 * route/router 保持 undefined —— 状态停在默认值（masonry / all / null / null），
 * setXxx() 只改本地 ref、不写 URL、不报错，filtered 照常工作。
 */
export function useFilters(): FilterState {
  const canInject = hasInjectionContext()
  const route: RouteLocationNormalizedLoaded | undefined = canInject ? useRoute() : undefined
  const router: Router | undefined = canInject ? useRouter() : undefined
  const photos = usePhotos()

  const view = ref<GalleryView>(DEFAULT_VIEW)
  const filterId = ref<string>(DEFAULT_FILTER)
  const person = ref<PersonId | null>(null)
  const scene = ref<Scene | null>(null)

  function syncFromRoute(): void {
    const query = route?.query ?? {}
    view.value = readView(query[QUERY_VIEW])
    filterId.value = readFilter(query[QUERY_FILTER])
    person.value = readPerson(query[QUERY_PERSON])
    scene.value = readScene(query[QUERY_SCENE])
  }

  // 立即同步一次，之后由 URL 单方向驱动
  watch(() => route?.query, syncFromRoute, { immediate: true, deep: true })

  function commit(patch: Record<string, string | null>): void {
    if (route === undefined || router === undefined) return
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(route.query)) {
      const first = firstQueryValue(value)
      if (first !== '') next[key] = first
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key]
      else next[key] = value
    }
    void router.replace({ query: next }).catch(() => undefined)
  }

  const filtered = computed<Photo[]>(() => {
    const definition = FILTERS.find((item) => item.id === filterId.value) ?? FILTERS[0]
    const wantedScene = scene.value
    const wantedPerson = person.value
    // 顺序：filterId 谓词 → scene → person；结果保持 all 的 order 升序
    return photos.all.value.filter((photo) => {
      if (!definition.match(photo)) return false
      if (wantedScene !== null && photo.scene !== wantedScene) return false
      if (wantedPerson !== null && !photo.people.includes(wantedPerson)) return false
      return true
    })
  })

  function setView(next: GalleryView): void {
    const value = isGalleryView(next) ? next : DEFAULT_VIEW
    view.value = value
    commit({ [QUERY_VIEW]: value })
  }

  function setFilter(id: string): void {
    const value = FILTERS.some((filter) => filter.id === id) ? id : DEFAULT_FILTER
    filterId.value = value
    commit({ [QUERY_FILTER]: value })
  }

  function setPerson(next: PersonId | null): void {
    const value: PersonId | null = next !== null && isPerson(next) ? next : null
    person.value = value
    commit({ [QUERY_PERSON]: value })
  }

  function setScene(next: Scene | null): void {
    const value: Scene | null = next !== null && isScene(next) ? next : null
    scene.value = value
    commit({ [QUERY_SCENE]: value })
  }

  function reset(): void {
    view.value = DEFAULT_VIEW
    filterId.value = DEFAULT_FILTER
    person.value = null
    scene.value = null
    commit({
      [QUERY_VIEW]: DEFAULT_VIEW,
      [QUERY_FILTER]: DEFAULT_FILTER,
      [QUERY_PERSON]: null,
      [QUERY_SCENE]: null
    })
  }

  return {
    view,
    filterId,
    person,
    scene,
    filtered,
    filterOptions: buildFilterOptions(),
    setView,
    setFilter,
    setPerson,
    setScene,
    reset
  }
}
