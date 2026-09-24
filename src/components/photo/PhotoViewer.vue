<script setup lang="ts">
/**
 * 全站唯一的全屏照片查看器（docs/01 §7.11、docs/02 §6.5）。
 * Wave 3 挂载到 App.vue，全局只此一个实例。
 *
 * 分工：
 * - 手势引擎交给 PhotoSwipe v5 core（原生 API，非 Lightbox）：
 *   左右滑动、双指缩放、滚轮缩放、双击放大、下滑关闭、焦点陷阱与归还；
 * - UI 完全自绘（右上计数 + 底部时间 · 描述），PhotoSwipe 自带的
 *   关闭/翻页/缩放按钮与加载指示器全部隐藏，因此屏幕上不会出现任何
 *   分享 / 下载 / 收藏 / 点赞 / 幻灯片 / 缩略图条。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PhotoSwipe from 'photoswipe'
import type { SlideData } from 'photoswipe'
import 'photoswipe/dist/photoswipe.css'

import { usePhotoViewer } from '@/composables/usePhotoViewer'
import { SCENE_LABELS } from '@/data/taxonomy'
import type { Photo } from '@/types/photo'
import { buildViewerSrcset } from './viewer-sources'

const { isOpen, photos, index, current, close } = usePhotoViewer()

const hostRef = ref<HTMLElement | null>(null)
const uiVisible = ref(true)

/** 打开后无操作多少毫秒淡出 UI（docs/02 §6.5：3 秒）。
 *  这是行为常量而不是过渡时长，过渡本身仍然只用 --d-base。 */
const UI_IDLE_DELAY = 3000
/** 位移小于这个值、时长小于下面那个值，才算「点击」而不是「拖动」 */
const TAP_SLOP = 8
const TAP_MAX_DURATION = 500

/** 大图交叉淡入用的类名，见文件底部的全局样式 */
const IMG_FADE_IN = 'viewer-img-in'
const IMG_FADE_HIDDEN = 'viewer-img-hidden'

let pswp: PhotoSwipe | null = null
let idleTimer: number | undefined
let pointerStart = { x: 0, y: 0, time: 0 }
let pointerMoved = false

const total = computed(() => photos.value.length)
const isSingle = computed(() => total.value <= 1)
const counter = computed(() => `${index.value + 1} / ${total.value}`)

/** 从 ISO 字符串里取 HH:MM。刻意不用 Date：EXIF 时间是本地墙上时间，
 *  走 Date 会被时区挪走，婚礼当天的 08:23 会变成别的钟点。 */
function formatTime(iso: string | null): string {
  if (!iso) return ''
  const matched = /T(\d{2}:\d{2})/.exec(iso)
  return matched ? matched[1] : ''
}

const timeText = computed(() => formatTime(current.value?.time ?? null))
const descriptionText = computed(() => current.value?.description?.trim() ?? '')
const hasCaption = computed(() => timeText.value !== '' || descriptionText.value !== '')

/** docs/02 §9：alt 优先用 description，其次「时间 + 场景」，不允许出现空 alt */
function buildAlt(photo: Photo): string {
  const description = photo.description?.trim()
  if (description) return description
  const parts = [formatTime(photo.time), photo.scene ? SCENE_LABELS[photo.scene] : ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : `照片 ${photo.id}`
}

/**
 * 大图默认用 preview（2048px），宽高取 preview 的真实像素；msrc 是 20px 的 blur 占位。
 *
 * srcset 交给浏览器挑（Phase 2 · Ultra HD）：只有高 DPI 大屏才会真正去取 3840 的 large，
 * 手机与普通屏仍然只下 2048。选档规则见 viewer-sources.ts，sizes 由 PhotoSwipe 自己算。
 */
function toSlideData(photo: Photo): SlideData {
  const data: SlideData = {
    src: photo.src,
    width: photo.width,
    height: photo.height,
    msrc: photo.blur,
    alt: buildAlt(photo),
    /* 下面两个字段不参与渲染，只供事件回调给单张幻灯片铺底色 / 显示失败态 ID */
    id: photo.id,
    color: photo.color
  }
  const srcset = buildViewerSrcset(photo)
  if (srcset) data.srcset = srcset
  return data
}

/** 单张幻灯片的底色：photo.color，避免加载前露出近黑的空洞 */
function paintSlide(container: HTMLElement | null | undefined, color: unknown): void {
  if (!container || typeof color !== 'string' || color === '') return
  container.style.backgroundColor = color
}

function paintBackdrop(instance: PhotoSwipe): void {
  const photo = photos.value[instance.currIndex]
  if (!photo || !instance.element) return
  instance.element.style.setProperty('--pswp-placeholder-bg', photo.color)
}

/**
 * 加载完成后 300ms 级别的 opacity 淡入。
 * PhotoSwipe 把 blur 占位保留约 1s 才移除（slide/content.js removePlaceholder），
 * 所以这里让大图从 0 淡到 1，天然与下方的 blur 形成交叉淡入。
 * 万一 loadComplete 没触发，大图只是「直接出现」，不会变成空白 —— 失败是安全的。
 */
function revealImage(element: HTMLElement | null | undefined): void {
  if (!element || element.tagName !== 'IMG') return
  element.classList.remove(IMG_FADE_IN)
  element.classList.add(IMG_FADE_HIDDEN)
  void element.offsetWidth /* 强制样式计算，否则两帧的 opacity 会被合并成一次赋值 */
  element.classList.remove(IMG_FADE_HIDDEN)
  element.classList.add(IMG_FADE_IN)
}

function clearIdleTimer(): void {
  if (idleTimer !== undefined) {
    window.clearTimeout(idleTimer)
    idleTimer = undefined
  }
}

function scheduleUiHide(): void {
  clearIdleTimer()
  idleTimer = window.setTimeout(() => {
    uiVisible.value = false
  }, UI_IDLE_DELAY)
}

/** 鼠标移动 / 触摸 / 滚轮 / 按键后淡入，并重新计时 */
function revealUi(): void {
  uiVisible.value = true
  scheduleUiHide()
}

function toggleUi(): void {
  if (uiVisible.value) {
    clearIdleTimer()
    uiVisible.value = false
  } else {
    revealUi()
  }
}

function handlePointerDown(event: PointerEvent): void {
  if (!event.isPrimary) return
  pointerStart = { x: event.clientX, y: event.clientY, time: Date.now() }
  pointerMoved = false
}

function handlePointerMove(event: PointerEvent): void {
  if (!event.isPrimary) return
  const dx = Math.abs(event.clientX - pointerStart.x)
  const dy = Math.abs(event.clientY - pointerStart.y)
  if (dx + dy > TAP_SLOP) pointerMoved = true
  /* 鼠标只要动就淡入；手指则要真的拖动过（避免轻触被当成移动） */
  if (event.pointerType === 'mouse' || pointerMoved) revealUi()
}

function handlePointerUp(event: PointerEvent): void {
  if (!event.isPrimary || pointerMoved) return
  if (Date.now() - pointerStart.time > TAP_MAX_DURATION) return
  toggleUi()
}

/** 双指缩放会被指针事件打断，取消时按「已拖动」处理，避免误触发 UI 显隐 */
function handlePointerCancel(): void {
  pointerMoved = true
}

function handleWheel(): void {
  revealUi()
}

function handleKeydown(): void {
  revealUi()
}

/** 契约：打开时锁滚动（body overflow hidden），关闭时移除 */
function lockScroll(): void {
  document.body.style.overflow = 'hidden'
}

function unlockScroll(): void {
  document.body.style.overflow = ''
}

function buildInstance(host: HTMLElement): PhotoSwipe {
  const instance = new PhotoSwipe({
    dataSource: photos.value.map(toSlideData),
    index: index.value,
    appendToEl: host,
    /* 近黑底（--c-veil）而不是站点的纸色 */
    bgOpacity: 1,
    /* PC：← → 切换、ESC 关闭、滚轮缩放、双击放大 */
    escKey: true,
    arrowKeys: true,
    wheelToZoom: true,
    doubleTapAction: 'zoom',
    /* 手机：左右滑动、双指缩放、下滑关闭 */
    loop: true,
    pinchToClose: true,
    closeOnVerticalDrag: true,
    /* 键盘焦点：打开时进入查看器，关闭时回到触发它的元素 */
    trapFocus: true,
    returnFocus: true,
    /* 单击 / 轻触不缩放也不关闭，只用来显隐 UI（docs/01 §7.11 手机行）；
     * 缩小回不去时点背景关闭，是桌面端唯一的鼠标关闭方式 */
    imageClickAction: false,
    bgClickAction: 'close',
    tapAction: false,
    /* 失败态由 contentErrorElement 过滤器渲染成「色块 + ID」（docs/02 §9） */
    errorMsg: ''
  })

  /* 让 blur 占位在每一张幻灯片上都生效：PhotoSwipe 默认只给第一张用 msrc */
  instance.addFilter('placeholderSrc', (src, content) => content.data.msrc || src)

  /* 失败时显示极小号 ID，而不是破图或英文报错 */
  instance.addFilter('contentErrorElement', (element, content) => {
    element.textContent = content.data.id ?? ''
    return element
  })

  instance.on('afterInit', () => {
    /* role="dialog" 需要一个可读的名字，否则读屏只会念 "dialog" */
    instance.element?.setAttribute('aria-label', '照片查看器')
  })

  instance.on('change', () => {
    index.value = instance.currIndex
    paintBackdrop(instance)
    revealUi()
  })

  instance.on('afterSetContent', (event) => {
    paintSlide(event.slide.container, event.slide.data.color)
  })

  instance.on('loadComplete', (event) => {
    if (event.isError) return
    revealImage(event.content.element)
  })

  /* ESC / 点背景 / 下滑 / 双指捏合关闭，都从这条路径回流到共享状态 */
  instance.on('close', () => {
    close()
  })

  instance.on('destroy', () => {
    if (pswp === instance) pswp = null
    clearIdleTimer()
    unlockScroll()
  })

  return instance
}

function openViewer(): void {
  const host = hostRef.value
  if (!host || pswp || photos.value.length === 0) return
  uiVisible.value = true
  lockScroll()
  const instance = buildInstance(host)
  pswp = instance
  instance.init()
  scheduleUiHide()
}

watch(isOpen, (opened) => {
  if (opened) openViewer()
  else pswp?.close()
})

/* 反向同步：usePhotoViewer().next() / prev()（以及任何直接改 index 的调用方）
 * 改的是共享状态，这里把它推给 PhotoSwipe。
 * 相等时提前返回，避免与 change 事件形成来回写。 */
watch(index, (value) => {
  if (pswp && pswp.currIndex !== value) pswp.goTo(value)
})

onMounted(() => {
  const host = hostRef.value
  if (!host) return
  host.addEventListener('pointerdown', handlePointerDown)
  host.addEventListener('pointermove', handlePointerMove)
  host.addEventListener('pointerup', handlePointerUp)
  host.addEventListener('pointercancel', handlePointerCancel)
  host.addEventListener('wheel', handleWheel, { passive: true })
  window.addEventListener('keydown', handleKeydown)
  /* 万一在挂载前就有人调用了 open()，这里补上 */
  if (isOpen.value) openViewer()
})

onBeforeUnmount(() => {
  const host = hostRef.value
  if (host) {
    host.removeEventListener('pointerdown', handlePointerDown)
    host.removeEventListener('pointermove', handlePointerMove)
    host.removeEventListener('pointerup', handlePointerUp)
    host.removeEventListener('pointercancel', handlePointerCancel)
    host.removeEventListener('wheel', handleWheel)
  }
  window.removeEventListener('keydown', handleKeydown)
  clearIdleTimer()
  unlockScroll()
  pswp?.destroy()
  pswp = null
})
</script>

<template>
  <div ref="hostRef" class="viewer-host">
    <!--
      UI 层始终留在 DOM 里，只靠 opacity 显隐：
      关闭时一起淡出，不留生硬的块状消失；pointer-events 全为 none，
      因此它不会抢走查看器的任何手势。
    -->
    <div class="viewer-ui" :class="{ 'is-ui-hidden': !uiVisible || !isOpen }" :aria-hidden="!isOpen">
      <p v-if="!isSingle" class="viewer-ui__counter">{{ counter }}</p>
      <p v-if="hasCaption" class="viewer-ui__caption">
        <span v-if="timeText" class="viewer-ui__time">{{ timeText }}</span>
        <span v-if="timeText && descriptionText"> · </span>
        <span v-if="descriptionText">{{ descriptionText }}</span>
      </p>
    </div>
  </div>
</template>

<style lang="scss">
/*
 * 全屏查看器的全局样式。
 * 刻意不用 scoped：.pswp 这棵树由 PhotoSwipe 在运行时创建，scoped 的
 * data-v 属性不会落在它身上。所有选择器都以 .viewer-host 命名空间限定，
 * 且只引用 tokens.scss 里的 CSS 变量，不出现任何魔法色值 / 间距 / 字号 / 时长。
 */

.viewer-host {
  position: fixed;
  inset: 0;
  z-index: var(--z-veil);
  /* 关闭时完全不拦截页面点击；.pswp--open 时再放开 */
  pointer-events: none;

  /* ---- 把 PhotoSwipe 主题化到观看态 ---- */
  --pswp-bg: var(--c-veil);
  --pswp-placeholder-bg: var(--c-veil);
  /* 观众态的底色由 --c-veil 提供，PhotoSwipe 默认的纯黑不再出现 */
  --pswp-root-z-index: var(--z-nav);
  --pswp-icon-color: var(--c-veil-ink);
  --pswp-icon-color-secondary: var(--c-veil-muted);
  --pswp-icon-stroke-color: var(--c-veil-muted);
  --pswp-error-text-color: var(--c-veil-muted);
  --pswp-preloader-color: transparent;
  --pswp-preloader-color-secondary: transparent;
}

.viewer-host .pswp {
  border-radius: var(--r);
}

.viewer-host .pswp--open {
  pointer-events: auto;
}

/* 20px 的 blur 占位：先模糊铺满，再由大图交叉淡入 */
.viewer-host .pswp__img--placeholder {
  filter: blur(12px);
  object-fit: cover;
}

/* 大图淡入的两帧：先隐身，强制样式计算后带 transition 回到 1 */
.viewer-host .pswp__img.viewer-img-hidden {
  opacity: 0;
}

.viewer-host .pswp__img.viewer-img-in {
  opacity: 1;
  transition: opacity var(--d-image) var(--e-out);
}

/*
 * 禁止出现的东西：分享 / 下载 / 收藏 / 点赞 / 幻灯片按钮 / 底部缩略图条 —— 全站没有。
 * PhotoSwipe 自带的关闭、翻页、缩放按钮、计数器和加载转圈也一并隐藏
 * （关掉它们才符合「UI 极简、屏幕 80% 给照片」；关闭与翻页由
 *  ESC / ← → / 左右滑动 / 下滑 / 点背景承担，缩放的缩放动效不受影响）。
 * 选择器写到三层，是为了压过 photoswipe.css 里
 *  .pswp--zoom-allowed .pswp__button--zoom 这类同权重规则。
 */
.viewer-host .pswp .pswp__button,
.viewer-host .pswp .pswp__counter,
.viewer-host .pswp .pswp__preloader {
  display: none;
}

/* 缩放光标（PC：滚轮缩放、双击放大） */
.viewer-host .pswp__img:not(.pswp__img--placeholder) {
  cursor: zoom-in;
}

.viewer-host .pswp--zoomed-in .pswp__img {
  cursor: grab;
}

/* 失败态：色块（photo.color）+ 极小号 ID，不出现破图图标（docs/02 §9） */
.viewer-host .pswp__error-msg {
  color: var(--c-veil-muted);
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1.2;
}

/* ---- 自绘 UI 层：只有计数与一行信息，没有第三个元素 ---- */

.viewer-ui {
  position: absolute;
  inset: 0;
  /* 比 .pswp 的 --pswp-root-z-index 高一层，保证 UI 永远压在大图之上 */
  z-index: var(--z-veil);
  pointer-events: none;
  opacity: 1;
  transition: opacity var(--d-base) var(--e-out);
}

.viewer-ui.is-ui-hidden {
  opacity: 0;
}

.viewer-ui__counter {
  position: absolute;
  top: var(--s-6);
  right: var(--s-6);
  color: var(--c-veil-muted);
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1.2;
}

.viewer-ui__caption {
  position: absolute;
  right: var(--s-6);
  bottom: var(--s-6);
  left: var(--s-6);
  overflow: hidden;
  color: var(--c-veil-muted);
  font-family: var(--f-serif);
  font-size: var(--t-small);
  line-height: 1.6;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-ui__time {
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
}

/*
 * base.scss 已经把全站动效在 reduced-motion 下压成「直接显示」；
 * 这里再显式声明一次，保证本组件被单独引入时行为不变。
 * PhotoSwipe 自己也检查 prefers-reduced-motion（photoswipe.js _prepareOptions），
 * 会把 showHideAnimationType 设为 none、zoomAnimationDuration 设为 0。
 */
@media (prefers-reduced-motion: reduce) {
  .viewer-ui,
  .viewer-host .pswp__img.viewer-img-in {
    transition: none;
  }
}
</style>
