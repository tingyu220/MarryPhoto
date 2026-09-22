<script setup lang="ts">
/**
 * 全站唯一处理图片加载的组件（Wave 1-D）。
 * 状态机严格对应 docs/02-UI设计契约.md §6.3：
 *   idle    未加载 —— photo.color 纯色块，尺寸由 aspect-ratio 撑开（无 CLS）
 *   loading 加载中 —— photo.blur 模糊图，filter: blur(12px)，scale 略大避免边缘发虚
 *   loaded  完成   —— 300ms opacity 0→1 + blur 12px→0
 *   failed  失败   —— 保留色块 + 极小号 mono 的 ID，绝不显示破图图标
 *   hover   桌面指针 —— 最多 1.02 倍缩放（首屏 eager 大图不参与）
 * 视口外不发起任何请求；卸载时断开 IntersectionObserver。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Photo } from '@/types/photo'
import { SCENE_LABELS } from '@/data/taxonomy'

const props = withDefaults(
  defineProps<{
    photo: Photo
    /** 取哪一档产物（docs/01 §9.2）：thumb 列表 / medium 桌面中等尺寸 / preview 全屏与首屏 */
    size?: 'thumb' | 'medium' | 'preview'
    eager?: boolean
    alt?: string
    objectFit?: 'cover' | 'contain'
    /** 铺满父容器（父容器必须已有确定高度）。用于首屏全出血大图，此时不使用照片自身比例 */
    fill?: boolean
  }>(),
  {
    size: 'thumb',
    eager: false,
    alt: undefined,
    objectFit: 'cover',
    fill: false
  }
)

/*
 * 根元素刻意是 <span> 而不是 <div>：本组件经常被放进 <button>（照片的可点热区），
 * 而 button 只允许 phrasing content，<div> 在里面是不合法的 HTML。
 * <span> 配合下面已有的 display: block，视觉完全相同，但让
 * "可点元素必须是真 button" 与 HTML 规范同时成立。
 *
 * 注意：这类说明只能写在 script 里，**不能写成模板里的 HTML 注释** ——
 * 模板注释会进入渲染输出，既增加字节，也会污染基于文本的断言。
 */

type Status = 'idle' | 'loading' | 'loaded' | 'error'

const rootEl = ref<HTMLElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)

/** 进入视口前 400px（rootMargin）才置为 true，此时才真正发起请求 */
const shouldLoad = ref(props.eager)
const status = ref<Status>(props.eager ? 'loading' : 'idle')
const blurReady = ref(false)

let observer: IntersectionObserver | null = null

/** 三档映射：缺省 thumb；medium 用在"列宽 500~900px"的版面上，避免把 480px 缩略图放大 */
const src = computed(() => {
  if (props.size === 'preview') return props.photo.src
  if (props.size === 'medium') return props.photo.medium
  return props.photo.thumb
})
const fitClass = computed(() => (props.objectFit === 'contain' ? 'is-contain' : 'is-cover'))
const focusStyle = computed(() =>
  props.photo.focus ? { objectPosition: props.photo.focus } : undefined
)
const rootStyle = computed(() => {
  const style: Record<string, string> = { backgroundColor: props.photo.color }
  // fill 模式下高度由父容器决定，不写 aspect-ratio
  if (!props.fill) style.aspectRatio = `${props.photo.width} / ${props.photo.height}`
  return style
})

const loaded = computed(() => status.value === 'loaded')
const failed = computed(() => status.value === 'error')
/** 只在开始加载后才挂载 blur 图，避免视口外的图片提前发请求 */
const showBlur = computed(() => shouldLoad.value && status.value !== 'idle')

/** '08:23' —— 仅用于自动 alt */
function timeLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** alt 优先级：显式传入 → photo.description → 时间 + 场景 → ID 兜底（永不为空） */
const altText = computed(() => {
  const explicit = props.alt?.trim()
  if (explicit) return explicit
  const description = props.photo.description?.trim()
  if (description) return description
  const scene = props.photo.scene ? SCENE_LABELS[props.photo.scene] : ''
  const composed = [timeLabel(props.photo.time), scene].filter(Boolean).join(' ')
  return composed || `照片 ${props.photo.id}`
})

function markLoaded() {
  status.value = 'loaded'
}

function markError() {
  status.value = 'error'
}

function markBlurReady() {
  blurReady.value = true
}

/** 命中缓存时 load 事件可能早于监听器绑定，挂载后补一次同步 */
function syncFromDom() {
  const el = imgEl.value
  if (!el || loaded.value || failed.value) return
  if (!el.complete) return
  if (el.naturalWidth > 0) markLoaded()
  else markError()
}

function startLoading() {
  if (shouldLoad.value) return
  shouldLoad.value = true
  status.value = 'loading'
}

onMounted(async () => {
  if (!props.eager) {
    if (typeof IntersectionObserver === 'undefined') {
      // 极老的浏览器：直接加载，不牺牲可用性
      startLoading()
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return
          startLoading()
          observer?.disconnect()
          observer = null
        },
        // 进入视口前 400px 就开始加载（docs/01 §7.4）
        { rootMargin: '400px 0px' }
      )
      if (rootEl.value) observer.observe(rootEl.value)
      else startLoading()
    }
  }
  await nextTick()
  syncFromDom()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <span
    ref="rootEl"
    class="lazy-image"
    :class="{ 'is-eager': eager, 'is-loaded': loaded, 'is-failed': failed, 'is-fill': fill }"
    :style="rootStyle"
    :data-photo-id="photo.id"
  >
    <img
      v-if="showBlur"
      class="lazy-image__blur"
      :class="[{ 'is-ready': blurReady }, fitClass]"
      :src="photo.blur"
      :style="focusStyle"
      alt=""
      aria-hidden="true"
      decoding="async"
      @load="markBlurReady"
    />
    <img
      v-if="shouldLoad"
      ref="imgEl"
      class="lazy-image__img"
      :class="fitClass"
      :src="src"
      :style="focusStyle"
      :alt="altText"
      :width="photo.width"
      :height="photo.height"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      :fetchpriority="eager ? 'high' : 'auto'"
      @load="markLoaded"
      @error="markError"
    />
    <span v-if="failed" class="lazy-image__id">{{ photo.id }}</span>
  </span>
</template>

<style scoped>
.lazy-image {
  position: relative;
  display: block;
  width: 100%;
  overflow: hidden;
  /* 兜底底色；真实的 photo.color 由内联样式给出 */
  background-color: var(--c-bg-sunk);
}

/* 铺满父容器：父容器自带高度，例如 100dvh 的首屏 */
.lazy-image.is-fill {
  height: 100%;
}

.lazy-image__img,
.lazy-image__blur {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.is-cover {
  object-fit: cover;
}

.is-contain {
  object-fit: contain;
}

/* ---- 加载中：blur 占位图（略放大，避免模糊后四周发虚）---- */
.lazy-image__blur {
  opacity: 0;
  transform: scale(1.06);
  filter: blur(12px);
  transition: opacity var(--d-fast) var(--e-out);
}

.lazy-image__blur.is-ready {
  opacity: 1;
}

/* ---- 加载完成：300ms opacity 0→1 + blur 12px→0（docs/02 §6.3）---- */
.lazy-image__img {
  opacity: 0;
  filter: blur(12px);
  transition:
    opacity var(--d-image) var(--e-out),
    filter var(--d-image) var(--e-out),
    transform var(--d-fast) var(--e-out);
}

.lazy-image.is-loaded .lazy-image__img {
  opacity: 1;
  filter: blur(0);
}

.lazy-image.is-loaded .lazy-image__blur,
.lazy-image.is-failed .lazy-image__blur {
  opacity: 0;
}

/* ---- 失败：只留色块 + 极小号 mono ID ---- */
.lazy-image__id {
  position: absolute;
  right: var(--s-2);
  bottom: var(--s-2);
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1;
  color: var(--c-ink-soft);
}

/* ---- hover（仅桌面指针设备）：最多 1.02 倍 ---- */
@media (hover: hover) and (pointer: fine) {
  .lazy-image:not(.is-eager):hover .lazy-image__img {
    transform: scale(1.02);
  }
}

/* 减弱动态效果：styles/base.scss 已统一把 transition 归零，无需重复。 */
</style>
