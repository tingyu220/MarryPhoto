<script setup lang="ts">
/**
 * 这一天 —— 按婚礼当天的时间顺序，把照片组织成章（docs/01 §7.3）。
 *
 * 这一页只做三件事：说清时间、说清发生了什么、把照片排进章节。
 * 第一次来的人看完它，应该能说出「那天发生了什么」。
 *
 * 章节与照片的关联：默认按时间自动归属（[本章 time, 下一章 time)，最后一章取到当天结束），
 * story.json 里写了 photoIds 的章节以人工指定为准 —— 人工的取舍永远优先于自动规则。
 * 两种方式都只读数据层返回的数组，不排序原数组、不就地改。
 *
 * 图片档位（docs/01 §9.2）：--lead 是整幅版心的大图（≈1100px）→ preview；
 * 其余小图里"每 3 张一张的满行图"占 72%（≈800px）、两列并排每张约 540px，
 * 都超过 thumb 的 480px 长边（竖构图的 thumb 只有 320px 宽），所以一并升到 medium。
 *
 * props 是"数据入口"而不是页面契约的一部分：默认完全走 @/data/story.json + usePhotos().all，
 * 显式传入时才用传入的数据（让章节归属这类规则可以被单测式地验证）。
 */
import { computed } from 'vue'
import PageShell from '@/components/layout/PageShell.vue'
import LazyImage from '@/components/common/LazyImage.vue'
import RevealOnScroll from '@/components/common/RevealOnScroll.vue'
import { usePhotos } from '@/composables/usePhotos'
import { usePhotoViewer } from '@/composables/usePhotoViewer'
import { SCENES } from '@/data/taxonomy'
import storyJson from '@/data/story.json'
import type { Photo, Scene, StoryChapter, StoryFile } from '@/types/photo'

/** 每章最多 10 张（docs/01 §7.3：3～10 张） */
const MAX_PHOTOS = 10
/** 当天结束：最后一章的区间上界 */
const END_OF_DAY = 24 * 60
/** 同屏最多错开 6 项，每项 80ms（docs/02 §7） */
const STAGGER_MS = 80

const props = defineProps<{
  /** 照片来源；缺省用全站数据层的 all */
  photos?: Photo[]
  /** 章节数据；缺省用 src/data/story.json */
  story?: StoryFile
}>()

const source = usePhotos()
const viewer = usePhotoViewer()

const pool = computed<Photo[]>(() => props.photos ?? source.all.value)

// ───────────────────────────── JSON 是未受信的人工输入 ─────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 空字符串 / 非字符串一律当作"没有填" */
function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 只认受控词表里的场景，拼错的静默丢弃 */
function asScene(value: unknown): Scene | null {
  return typeof value === 'string' && (SCENES as string[]).includes(value) ? (value as Scene) : null
}

/**
 * photoIds：只在"字段确实是数组"时才认（空数组也算认 —— 那是人工明确写了"这一章没有照片"）；
 * 字段不存在 / 类型不对 → undefined，回到按时间自动归属。
 */
function asPhotoIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

/** 一条章节：时间与标题缺一不可，缺了就当这一章没写（不崩、不显示半截章节） */
function asChapter(value: unknown): StoryChapter | null {
  if (!isRecord(value)) return null
  const time = asText(value.time)
  const title = asText(value.title)
  if (!time || !title) return null

  const chapter: StoryChapter = { time, title, text: asText(value.text) }
  const photoIds = asPhotoIds(value.photoIds)
  if (photoIds !== undefined) chapter.photoIds = photoIds
  const scene = asScene(value.scene)
  if (scene !== null) chapter.scene = scene
  return chapter
}

function asStoryFile(value: unknown): StoryFile {
  const record: Record<string, unknown> = isRecord(value) ? value : {}
  const raw = Array.isArray(record.chapters) ? record.chapters : []
  const chapters: StoryChapter[] = []
  for (const item of raw) {
    const chapter = asChapter(item)
    if (chapter !== null) chapters.push(chapter)
  }
  return { date: asText(record.date), chapters }
}

const defaultStory = asStoryFile(storyJson)

/**
 * 传入的 story prop 同样过一遍校验：它可能来自路由/父组件的运行时数据，
 * 形状不对（chapters 缺失、项不是对象）时降级成空章节，而不是在模板里抛异常。
 */
const story = computed<StoryFile>(() => (props.story ? asStoryFile(props.story) : defaultStory))

// ───────────────────────────── 时间 → 分钟数 ─────────────────────────────

/** '07:30' / '7:30' → 当日分钟数；写错了返回 null（这一章就安静地没有照片） */
function clockMinutes(value: string): number | null {
  const matched = /^(\d{1,2}):(\d{2})/.exec(value)
  if (matched === null) return null
  const hours = Number(matched[1])
  const minutes = Number(matched[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** 照片的拍摄时刻 → 当日分钟数；没有时间 / 时间非法 → null（不参与归属，也不掉进 1970 年） */
function photoMinutes(photo: Photo): number | null {
  if (!photo.time) return null
  const parsed = new Date(photo.time)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getHours() * 60 + parsed.getMinutes()
}

// ───────────────────────────── 章节装配 ─────────────────────────────

interface Chapter {
  time: string
  title: string
  text: string
  scene: Scene | null
  /** 查看器的数据源：index 必须与它一致 */
  photos: Photo[]
}

/** 人工指定的照片：按给定顺序，只保留真实存在的 id（找不到的 id 不报错、占位） */
function pickByIds(ids: string[], byId: Map<string, Photo>): Photo[] {
  const picked: Photo[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    const photo = byId.get(id)
    if (photo === undefined) continue
    seen.add(id)
    picked.push(photo)
  }
  return picked
}

/** 按时间自动归属：[本章 time, 下一章 time)，按 order 升序，最多 MAX_PHOTOS 张 */
function pickByTime(start: number, end: number, pool: Photo[]): Photo[] {
  return pool
    .filter((photo) => {
      const minutes = photoMinutes(photo)
      return minutes !== null && minutes >= start && minutes < end
    })
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_PHOTOS)
}

const chapters = computed<Chapter[]>(() => {
  const list = story.value.chapters
  const photos = pool.value
  const byId = new Map<string, Photo>()
  for (const photo of photos) if (!byId.has(photo.id)) byId.set(photo.id, photo)

  return list.map((chapter, index) => {
    const next = index + 1 < list.length ? list[index + 1] : undefined
    const start = clockMinutes(chapter.time)
    const end = next === undefined ? END_OF_DAY : clockMinutes(next.time)
    const picked =
      chapter.photoIds !== undefined
        ? pickByIds(chapter.photoIds, byId)
        : start !== null && end !== null
          ? pickByTime(start, end, photos)
          : []

    return {
      time: chapter.time,
      title: chapter.title,
      text: chapter.text ?? '',
      scene: chapter.scene ?? null,
      photos: picked
    }
  })
})

/** '2026-09-16' → '2026 · 09 · 16'；写不对就原样显示 */
const dateText = computed(() => {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(story.value.date)
  return matched === null ? story.value.date : `${matched[1]} · ${matched[2]} · ${matched[3]}`
})

/**
 * 小图的错落节奏：每 3 张里第 2 张占满整行（左右交替），
 * 剩下的 2 列并排 —— 不做等宽网格（docs/02 §5.5）。
 */
function restClass(index: number): Record<string, boolean> {
  const wide = index % 3 === 1
  return {
    'story__shot--wide': wide,
    'is-right': wide && Math.floor(index / 3) % 2 === 1
  }
}

/** 点击照片：交给全站唯一的查看器，index 是本张在该章照片数组里的位置 */
function openAt(list: Photo[], index: number): void {
  viewer.open(list, index)
}
</script>

<template>
  <PageShell>
    <div class="story" data-view="story">
      <header class="story__head">
        <h1 class="t-h1">这一天</h1>
        <p class="story__date t-label">{{ dateText }}</p>
        <p class="story__intro t-caption">从清晨到夜晚，按时间顺序。</p>
      </header>

      <ol v-if="chapters.length" class="story__list">
        <li
          v-for="chapter in chapters"
          :key="chapter.time + chapter.title"
          class="story__chapter"
          :data-scene="chapter.scene ?? undefined"
        >
          <RevealOnScroll as="header" class="story__headline">
            <p class="story__time">{{ chapter.time }}</p>
            <h2 class="story__title t-h2">{{ chapter.title }}</h2>
            <p v-if="chapter.text" class="story__text t-body">{{ chapter.text }}</p>
          </RevealOnScroll>

          <div v-if="chapter.photos.length" class="story__shots">
            <!-- 第一张放大：这一章的重心 -->
            <RevealOnScroll as="figure" class="story__shot story__shot--lead">
              <button
                type="button"
                class="story__hit"
                :data-index="0"
                @click="openAt(chapter.photos, 0)"
              >
                <LazyImage :photo="chapter.photos[0]" size="preview" />
              </button>
            </RevealOnScroll>

            <!-- 其余：2 列小图，每 3 张插一张满行的，左右交替 -->
            <RevealOnScroll
              v-for="(photo, index) in chapter.photos.slice(1)"
              :key="photo.id"
              as="figure"
              class="story__shot"
              :class="restClass(index)"
              :delay="(index % 6) * STAGGER_MS"
            >
              <button
                type="button"
                class="story__hit"
                :data-index="index + 1"
                @click="openAt(chapter.photos, index + 1)"
              >
                <LazyImage :photo="photo" size="medium" />
              </button>
            </RevealOnScroll>
          </div>

          <!-- 竖线随滚动生长：attach 到本段（见 style 里的 .is-visible ~ 规则） -->
          <span class="story__line" aria-hidden="true" />
        </li>
      </ol>

      <p v-else class="story__empty t-caption">这一天还没有写下章节。</p>
    </div>
  </PageShell>
</template>

<style scoped>
.story__head {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-top: var(--s-24);
  padding-bottom: var(--s-24);
}

.story__date {
  color: var(--c-muted);
  padding-top: var(--s-2);
}

.story__intro {
  padding-top: var(--s-4);
}

.story__list {
  max-width: var(--w-page);
  margin-inline: auto;
}

.story__chapter {
  position: relative;
  padding-bottom: var(--s-24);
}

/* ---------- 大号时间：这一页最显眼的元素 ---------- */
.story__time {
  font-family: var(--f-display);
  font-size: var(--t-h1);
  letter-spacing: var(--ls-display);
  line-height: var(--lh-tight);
  color: var(--c-ink);
}

.story__title {
  padding-top: var(--s-1);
}

.story__text {
  max-width: var(--w-text);
  color: var(--c-ink-soft);
  padding-top: var(--s-4);
}

/* ---------- 照片 ---------- */
.story__shots {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--s-3);
  padding-top: var(--s-8);
}

.story__shot {
  margin: 0;
}

.story__shot--lead {
  grid-column: 1 / -1;
}

.story__shot--wide {
  grid-column: 1 / -1;
  width: 72%;
  justify-self: start;
}

.story__shot--wide.is-right {
  justify-self: end;
}

.story__hit {
  display: block;
  width: 100%;
}

/* ---------- 左侧细竖线 ---------- */
.story__line {
  display: none;
}

@media (min-width: 768px) {
  .story__chapter {
    /* 竖线的走道：线的位置在内容的左边，不压在照片上 */
    padding-left: var(--s-12);
    padding-bottom: var(--s-32);
  }

  .story__shots {
    gap: var(--s-6);
  }

  .story__line {
    display: block;
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: var(--c-line);
    transform: scaleY(0);
    transform-origin: top center;
    transition: transform var(--d-slow) var(--e-out);
  }

  /* 章节进入视口时本段竖线生长出来（转场由 RevealOnScroll 的 is-visible 触发，
     只用 transform: scaleY —— 没有 JS 逐帧改高度，也没有动画库） */
  .story__headline.is-visible ~ .story__line {
    transform: scaleY(1);
  }
}

.story__empty {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-block: var(--s-32);
}

@media (prefers-reduced-motion: reduce) {
  .story__line {
    transition: none;
  }
}
</style>
