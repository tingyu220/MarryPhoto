import { computed, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'
import type { Photo } from '@/types/photo'

/**
 * 全屏照片查看器（PhotoViewer）的模块级单例状态。
 * 签名冻结于 Wave 1-C，见 docs/01 §7.11、docs/02 §6.5。
 *
 * 约定（接口契约，不得偏离）：
 * - 其它组件**只通过** `usePhotoViewer().open(photos, index)` 打开查看器；
 * - 键盘、手势、滚动锁定、焦点归还由查看器组件（components/photo/PhotoViewer.vue）负责，
 *   这里只持有状态，因此本文件不触碰任何 DOM，可被任意组件安全 import；
 * - `index` 是唯一的位置真相：查看器组件监听它来切换幻灯片，
 *   PhotoSwipe 的 change 事件又把结果写回它，两者取值总是同步的。
 */
export interface PhotoViewerState {
  readonly isOpen: Ref<boolean>
  readonly photos: Ref<Photo[]>
  readonly index: Ref<number>
  readonly current: Ref<Photo | null>
  open(list: Photo[], startIndex?: number): void
  close(): void
  next(): void
  prev(): void
}

/** 单例状态：整个应用共享同一份，保证全站只有一个查看器实例 */
const isOpen = ref(false)
const photos = shallowRef<Photo[]>([])
const index = ref(0)

const current = computed<Photo | null>(() => {
  const list = photos.value
  const i = index.value
  return i >= 0 && i < list.length ? list[i] : null
})

/** 把任意输入收敛到 [0, length - 1]；NaN / Infinity 一律落到 0 */
function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0
  const i = Math.trunc(value)
  if (i < 0) return 0
  if (i > length - 1) return length - 1
  return i
}

function open(list: Photo[], startIndex = 0): void {
  if (list.length === 0) return
  photos.value = list
  index.value = clampIndex(startIndex, list.length)
  isOpen.value = true
}

function close(): void {
  isOpen.value = false
}

/**
 * 环形翻页：与 PhotoSwipe 的 loop 行为一致（照片不足 3 张时它本身不循环，
 * 但此时取模的结果也只是在 0/1 之间切换，不会越界）。
 */
function step(delta: number): void {
  const length = photos.value.length
  if (!isOpen.value || length === 0) return
  index.value = (((index.value + delta) % length) + length) % length
}

function next(): void {
  step(1)
}

function prev(): void {
  step(-1)
}

const state: PhotoViewerState = { isOpen, photos, index, current, open, close, next, prev }

export function usePhotoViewer(): PhotoViewerState {
  return state
}
