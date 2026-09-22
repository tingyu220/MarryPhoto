<script setup lang="ts">
/**
 * 滚动出现包装器（Wave 1-D）。
 * 出现时：opacity 0→1 + translateY(12px→0)，时长 --d-slow，缓动 --e-out（docs/02 §7）。
 *
 * 观察器来自 Wave 1-B 的 useReveal()：相同 options 共用一个 IntersectionObserver，
 * 并且已经在 prefers-reduced-motion: reduce / 无 IntersectionObserver 时直接返回
 * visible = true —— 内容永远不会被锁在 opacity: 0。
 * 本组件只负责"位移 + 时长 + 延迟"的视觉部分。
 */
import { useReveal } from '@/composables/useReveal'

const props = withDefaults(
  defineProps<{
    /** 出现延迟，毫秒。同屏错开最多 6 项、每项 60～80ms（docs/02 §7） */
    delay?: number
    /** 渲染成什么标签，默认 div */
    as?: string
    /** 只出现一次（默认），false 时离开视口会复位 */
    once?: boolean
  }>(),
  { delay: 0, as: 'div', once: true }
)

const { target, visible } = useReveal({ once: props.once })
</script>

<template>
  <component
    :is="as"
    ref="target"
    class="reveal"
    :class="{ 'is-visible': visible }"
    :style="{ transitionDelay: `${delay}ms` }"
  >
    <slot />
  </component>
</template>

<style scoped>
.reveal {
  opacity: 0;
  transform: translateY(12px);
  transition:
    opacity var(--d-slow) var(--e-out),
    transform var(--d-slow) var(--e-out);
}

.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
}

/* 减弱动态效果：直接显示，无位移、无延迟 */
@media (prefers-reduced-motion: reduce) {
  .reveal,
  .reveal.is-visible {
    opacity: 1;
    transform: none;
    transition: none;
    transition-delay: 0ms !important;
  }
}
</style>
