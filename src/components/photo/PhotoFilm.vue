<script setup lang="ts">
/**
 * 胶片 Film（Wave 2-G，docs/01 §7.6）—— Gallery 的第四种浏览模式。
 *
 * 边界（硬约束）：
 * - 只有一个 prop：photos。数据由 /gallery 页面筛选后传入；本组件不读 JSON、
 *   不 import 其它三种浏览模式；
 * - 一屏一张大图，靠滚动一张一张看 —— 这不是幻灯片：没有播放/暂停按钮、
 *   没有自动播放、没有进度条；空格 / ↑ / ↓ 只把页面滚到上/下一张，
 *   到端点就把按键还给浏览器，绝不劫持滚动。
 *
 * 大图加载策略（「不要一上来就加载全部 2048px」的落地方式）：
 * - 第 0 张永远 eager —— 它是首屏，不能等 IntersectionObserver（也是 LCP）；
 * - 其余帧由本组件唯一的 IntersectionObserver 判定「离当前屏一张以内」
 *   （rootMargin 上下各放宽一屏），命中的帧把 eager 传给 LazyImage 提前换 preview；
 * - 没命中的帧完全交给 LazyImage 自己的懒加载：在进入视口前 400px 之前，
 *   DOM 里连 <img> 都不存在，因此不会发出任何大图请求 —— 同时最多 3 张 preview 在途。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LazyImage from '@/components/common/LazyImage.vue'
import RevealOnScroll from '@/components/common/RevealOnScroll.vue'
import { usePhotoViewer } from '@/composables/usePhotoViewer'
import type { Photo } from '@/types/photo'

const props = defineProps<{ photos: Photo[] }>()

/** 唯一的查看器入口：点击照片或按回车（button 原生行为）都走这里 */
const { open, isOpen } = usePhotoViewer()

const rootEl = ref<HTMLElement | null>(null)

/** 离当前屏一张以内的帧号。第 0 张常驻（首屏必须立刻出图） */
const near = ref<Set<number>>(new Set([0]))

const total = computed(() => props.photos?.length ?? 0)
const isEmpty = computed(() => total.value === 0)

function isNear(index: number): boolean {
  return near.value.has(index)
}

/** 单帧的宽高比，交给 CSS 算「高度不超一屏」的最大宽度 */
function ratioOf(photo: Photo): number {
  return Number.isFinite(photo.ratio) && photo.ratio > 0 ? photo.ratio : 1.5
}

/** '012' —— 底片边缘的帧号：用按拍摄时间排出的全局序号，异常时退回列表位置 */
function frameNumber(photo: Photo, index: number): string {
  const order = photo.order
  const value = Number.isFinite(order) && order > 0 ? Math.trunc(order) : index + 1
  return String(value).padStart(3, '0')
}

/**
 * '08:23' —— 刻意不走 Date：EXIF 是本地墙上时间，经 Date 会被时区挪走
 * （与 PhotoViewer 同一策略）。取不到时间就返回空串，那一格整段不渲染。
 */
function timeOf(photo: Photo): string {
  const matched = /(?:T| )(\d{2}:\d{2})/.exec(photo.time ?? '')
  return matched ? matched[1] : ''
}

/** 描述缺失（null / 空串 / 全空格）时整行不渲染，绝不输出「暂无描述」 */
function descriptionOf(photo: Photo): string {
  return photo.description?.trim() ?? ''
}

function openAt(index: number): void {
  open(props.photos, index)
}

function frameElements(): HTMLElement[] {
  const root = rootEl.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[data-film-index]'))
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 正在看的是哪一张：按键时才量一次，不挂滚动监听 */
function currentIndex(): number {
  const frames = frameElements()
  if (frames.length === 0) return 0
  const middle = (typeof window === 'undefined' ? 0 : window.innerHeight) / 2
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  frames.forEach((element, index) => {
    const rect = element.getBoundingClientRect()
    const distance = Math.abs(rect.top + rect.height / 2 - middle)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return best
}

/**
 * 空格 / ↓ 下一张，↑ 上一张。返回是否真的翻了页：
 * 已经在第一张（↑）或最后一张（↓）时返回 false，把按键还给浏览器 ——
 * 否则用户会被困在胶片里，滚不到页脚。
 */
function step(delta: number): boolean {
  if (isOpen.value) return false
  const from = currentIndex()
  const to = Math.min(Math.max(from + delta, 0), total.value - 1)
  if (to === from) return false
  const target = frameElements()[to]
  if (!target || typeof target.scrollIntoView !== 'function') return false
  target.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'center'
  })
  return true
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  /* 查看器打开时键盘归它（← → 翻页、ESC 关闭） */
  if (isOpen.value) return
  const key = event.key
  const isNext = key === ' ' || key === 'Spacebar' || key === 'ArrowDown' || key === 'Down'
  const isPrev = key === 'ArrowUp' || key === 'Up'
  if (!isNext && !isPrev) return
  /* 空格默认会滚动页面：只有真的翻了页才吞掉它，其余情况留给浏览器 */
  if (step(isNext ? 1 : -1)) event.preventDefault()
}

let preloadObserver: IntersectionObserver | null = null

/** 把「当前屏附近」标出来，作为那些帧 eager 的依据 */
function observeFrames(): void {
  preloadObserver?.disconnect()
  preloadObserver = null
  /* 没有 IntersectionObserver 时：只有第 0 张 eager，其余交给 LazyImage 自己的兜底 */
  if (typeof IntersectionObserver === 'undefined') return
  const frames = frameElements()
  if (frames.length === 0) return

  const next = new Set<number>([0])
  preloadObserver = new IntersectionObserver(
    (entries) => {
      let changed = false
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.filmIndex)
        if (!Number.isFinite(index)) continue
        if (entry.isIntersecting && !next.has(index)) {
          next.add(index)
          changed = true
        } else if (!entry.isIntersecting && index !== 0 && next.has(index)) {
          next.delete(index)
          changed = true
        }
      }
      if (changed) near.value = new Set(next)
    },
    /* 上下各放宽一屏：相邻的那张提前换 preview，更远的仍然是懒加载 */
    { rootMargin: '100% 0px 100% 0px' }
  )
  for (const frame of frames) preloadObserver.observe(frame)
}

onMounted(() => {
  observeFrames()
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  preloadObserver?.disconnect()
  preloadObserver = null
  window.removeEventListener('keydown', handleKeydown)
})

/* 换筛选（photos 换了数组）后重新观察；flush: 'post' 保证 DOM 已经更新 */
watch(
  () => props.photos,
  () => {
    near.value = new Set([0])
    observeFrames()
  },
  { flush: 'post' }
)
</script>

<template>
  <div ref="rootEl" class="film">
    <!-- 空结果：一行字，不画框、不给图标（docs/02 §9） -->
    <p v-if="isEmpty" class="film__empty" role="status">这一类别还没有照片</p>

    <ol v-else class="film__reel">
      <li
        v-for="(photo, index) in photos"
        :key="photo.id"
        class="film__frame"
        :data-film-index="index"
        :style="{ '--film-ratio': ratioOf(photo) }"
      >
        <RevealOnScroll as="figure" class="film__plate">
          <button type="button" class="film__print" @click="openAt(index)">
            <LazyImage :photo="photo" size="preview" object-fit="contain" :eager="isNear(index)" />
          </button>

          <figcaption class="film__caption">
            <p class="film__meta">
              <span class="film__no">{{ frameNumber(photo, index) }}</span>
              <template v-if="timeOf(photo)">
                <span class="film__sep" aria-hidden="true">·</span>
                <span class="film__time">{{ timeOf(photo) }}</span>
              </template>
            </p>
            <p v-if="descriptionOf(photo)" class="film__desc">{{ descriptionOf(photo) }}</p>
          </figcaption>
        </RevealOnScroll>
      </li>
    </ol>
  </div>
</template>

<style scoped>
/*
 * 视觉方向：35mm 胶片 / 摄影作品集。做法只有三件事 ——
 * 一张大图占满一屏、图下留一行底片边缘式的字幕（等宽帧号 + 时间 + 一句描述）、
 * 其余全是留白。没有卡片、没有边框、没有阴影、没有圆角、没有按钮底色。
 */
.film {
  display: block;
  width: 100%;
  /* 照片在这一屏里可用的最大高度；图下的字幕和上下留白要一起装进 100dvh */
  --film-stage: 62dvh;
  /*
   * 可选的分页吸附（docs/01 §7.6）。刻意用 proximity 而不是 mandatory：
   * mandatory 会和「慢慢滚」的意图打架，等于劫持滚动。
   * 页面本身是整页滚动，所以这一条只在宿主把本组件放进自己的滚动容器时才生效。
   */
  scroll-snap-type: y proximity;
}

/* 矮窗口（横屏手机）：把照片再收一点，保证图与字幕同屏 */
@media (max-height: 560px) {
  .film {
    --film-stage: 50dvh;
  }
}

.film__frame {
  display: flex;
  flex-direction: column;
  justify-content: center;
  /* 一屏一张。dvh 而不是 vh：iOS 地址栏收放时不会跳 */
  min-height: 100vh;
  min-height: 100dvh;
  /* 顶部让开固定导航的高度，照片才落在可见区中间 */
  padding: calc(var(--header-h, var(--s-12)) + var(--s-6)) var(--pad-x) var(--s-16);
  scroll-margin-top: var(--header-h, 0px);
  scroll-snap-align: center;
}

.film__plate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-8);
  width: 100%;
}

/*
 * 图按「不超一屏高」定最大宽度：ratio 由内联 --film-ratio 给出。
 * LazyImage 的盒子永远等于照片本身的宽高比，object-fit: contain 因此不会留边。
 */
.film__print {
  display: block;
  width: min(100%, calc(var(--film-stage) * var(--film-ratio, 1.5)));
  cursor: zoom-in;
}

.film__caption {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-2);
  max-width: var(--w-text);
  text-align: center;
}

/* 底片边缘的帧号与时间：等宽、宽字距、低对比度，绝不抢照片 */
.film__meta {
  display: flex;
  align-items: baseline;
  gap: var(--s-2);
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1.2;
  color: var(--c-muted);
  font-variant-numeric: tabular-nums;
}

.film__sep {
  color: var(--c-faint);
}

.film__desc {
  font-family: var(--f-serif);
  font-size: var(--t-small);
  line-height: 1.6;
  color: var(--c-muted);
}

.film__empty {
  padding: var(--s-24) var(--pad-x);
  font-family: var(--f-serif);
  font-size: var(--t-small);
  line-height: 1.6;
  color: var(--c-muted);
  text-align: center;
}

/*
 * 动效全部来自 RevealOnScroll（出现）与 LazyImage（图片淡入），
 * 两者都已处理 prefers-reduced-motion；键盘滚动在 JS 里读同一个媒体查询。
 */
</style>
