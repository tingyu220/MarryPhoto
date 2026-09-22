import { getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

/**
 * 滚动出现工具（Wave 2/3 的组件消费）。
 *
 * - 只依赖 IntersectionObserver，不引入任何动画库；
 * - 相同 options 的调用共用一个 observer，不会每张图建一个观察器；
 * - prefers-reduced-motion: reduce 或环境不支持 IntersectionObserver 时，
 *   visible 直接为 true —— 内容永远可见，动效只是锦上添花；
 * - resetReveal() 在路由切换时调用，断开所有观察器，并把已登记元素置为可见，
 *   避免离开页面时留下"隐藏但没被观察到"的内容。
 */

interface RevealEntry {
  visible: Ref<boolean>
  once: boolean
}

interface RevealGroup {
  observer: IntersectionObserver
  entries: Map<Element, RevealEntry>
}

const groups = new Map<string, RevealGroup>()

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getGroup(key: string, options: IntersectionObserverInit): RevealGroup {
  const existing = groups.get(key)
  if (existing !== undefined) return existing

  const entries = new Map<Element, RevealEntry>()
  const observer = new IntersectionObserver((records) => {
    for (const record of records) {
      const entry = entries.get(record.target)
      if (entry === undefined) continue
      if (record.isIntersecting) {
        entry.visible.value = true
        if (entry.once) {
          observer.unobserve(record.target)
          entries.delete(record.target)
        }
      } else if (!entry.once) {
        entry.visible.value = false
      }
    }
  }, options)

  const group: RevealGroup = { observer, entries }
  groups.set(key, group)
  return group
}

export function useReveal(options?: { once?: boolean; rootMargin?: string; threshold?: number }): {
  target: Ref<HTMLElement | null>
  visible: Ref<boolean>
} {
  const once = options?.once ?? true
  const rootMargin = options?.rootMargin ?? '0px 0px -10% 0px'
  const threshold = options?.threshold ?? 0.15

  // 元素引用用 shallowRef：DOM 元素不应该被 reactive 代理，
  // 否则 IntersectionObserver 回调里的 entry.target 与 observe() 收到的对象对不上
  const target = shallowRef<HTMLElement | null>(null)
  const visible = ref(false)

  if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
    visible.value = true
    return { target, visible }
  }

  const key = `${once}|${rootMargin}|${threshold}`
  const entry: RevealEntry = { visible, once }
  let group: RevealGroup | null = null
  let current: HTMLElement | null = null

  function detach(): void {
    if (group !== null && current !== null) {
      group.entries.delete(current)
      group.observer.unobserve(current)
    }
    current = null
  }

  const stop = watch(
    target,
    (el) => {
      detach()
      if (el === null) return
      // 每次重新取组：resetReveal() 之后的元素会挂到一个新的 observer 上
      group = getGroup(key, { rootMargin, threshold })
      current = el
      group.entries.set(el, entry)
      group.observer.observe(el)
    },
    { immediate: true, flush: 'post' }
  )

  function cleanup(): void {
    stop()
    detach()
    visible.value = true
  }

  if (getCurrentScope() !== undefined) onScopeDispose(cleanup)

  return { target, visible }
}

/** 路由切换时清理观察器；已登记的元素直接置为可见，不会永久隐藏 */
export function resetReveal(): void {
  for (const group of groups.values()) {
    group.observer.disconnect()
    for (const entry of group.entries.values()) entry.visible.value = true
    group.entries.clear()
  }
  groups.clear()
}
