<script setup lang="ts">
/**
 * VortexFallback —— 没有 3D 时的这一页（任务书 §10）。
 *
 * 什么时候会走到这里：
 *   - 浏览器没有可用的 WebGL（或上下文创建失败）；
 *   - 系统打开了"减少动态效果"（prefers-reduced-motion）——
 *     这一页的核心运动是持续旋转，与其把它降成慢动作，不如直接给出静态结构；
 *   - 3D 初始化抛错（VortexScene 的 fail 事件）。
 *
 * 它必须做到三件事：**不白屏、看得清、点得开**。
 * 所以这里是一个静态的环形版面：用的是真 <button>，键盘 / 读屏 / 触摸都能用，
 * 点击走的是同一个全站唯一查看器（由上层接上），一张照片都没有少。
 *
 * 贴图档位与 3D 一致：只用 medium（长边 1280px），不请求 preview / large / original。
 * 有意不做动画：减少动态效果的人看到的应该是一个安静的空间，而不是一个慢下来的旋转木马。
 */
import type { Photo } from '@/types/photo'
import { vortexLabel } from '@/composables/useVortex'

const props = defineProps<{ photos: Photo[] }>()

const emit = defineEmits<{ select: [index: number] }>()

/** 环上第 index 张的角度（度）：从正上方开始顺时针铺一圈 */
function angleOf(index: number, total: number): number {
  return (index / Math.max(1, total)) * 360
}
</script>

<template>
  <div class="vortex-fallback">
    <ul class="vortex-fallback__ring">
      <li
        v-for="(photo, index) in props.photos"
        :key="photo.id"
        class="vortex-fallback__slot"
        :style="{ '--a': angleOf(index, props.photos.length) + 'deg' }"
      >
        <button type="button" class="vortex-fallback__hit" @click="emit('select', index)">
          <img
            class="vortex-fallback__img"
            :src="photo.medium"
            :alt="vortexLabel(photo)"
            :width="photo.width"
            :height="photo.height"
            loading="lazy"
            decoding="async"
          >
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.vortex-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/*
 * 环形版面：外圈每一格是一个旋转过的"槽"，照片贴在这个槽的顶端，
 * 再自转回去保持水平 —— 所以布局里没有一个 JS 测量，窗口变化也不会重排。
 */
.vortex-fallback__ring {
  --ring-size: min(78vmin, 620px);
  --ring-r: 40%;
  --item-w: clamp(56px, 9vmin, 104px);
  position: relative;
  width: var(--ring-size);
  height: var(--ring-size);
  margin: 0;
  padding: 0;
  list-style: none;
}

.vortex-fallback__slot {
  position: absolute;
  inset: 0;
  transform: rotate(var(--a));
}

.vortex-fallback__hit {
  position: absolute;
  left: 50%;
  top: calc(50% - var(--ring-r));
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  transform: translate(-50%, -50%);
  -webkit-tap-highlight-color: transparent;
}

.vortex-fallback__img {
  display: block;
  width: var(--item-w);
  height: auto;
  /* 反着转回来：照片永远保持水平，环只是它们的摆放方式 */
  transform: rotate(calc(-1 * var(--a)));
}

.vortex-fallback__hit:focus-visible {
  outline: 1px solid var(--c-veil-ink);
  outline-offset: var(--s-1);
}

@media (hover: hover) and (pointer: fine) {
  .vortex-fallback__hit:hover .vortex-fallback__img {
    /* 轻微反馈，与 3D 里的 hoverScale 一个量级 */
    transform: rotate(calc(-1 * var(--a))) scale(1.04);
  }
}
</style>
