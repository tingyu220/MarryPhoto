<script setup lang="ts">
/**
 * MemoryVortex —— /experience 的大脑，只做三件事：
 *
 *   1. 决定这一页走 3D（VortexScene）还是走静态兜底（VortexFallback）——
 *      WebGL 不可用、系统要求减少动态效果、3D 初始化失败，三种情况都落到兜底，
 *      绝不白屏；
 *   2. 把照片交给全站唯一的查看器：viewer.open(photos, index)，不新建第二套查看器；
 *   3. 贴图还没到位时给出**极简**的 loading 文案（没有进度条、没有 HUD、没有大 Loader）。
 *
 * 刻意不做的事：**不监听查看器的开合**。打开大图时这个 3D 场景继续挂载、继续极慢地转，
 * 关闭之后旋转角度、相机距离、照片位置全部保持原样 —— 没有任何重建。
 *
 * 照片来源只有一个：usePhotos()（featured 优先，不足 12 张从 all 按 order 补足），
 * 见 useVortex()。这里不读 JSON、不扫目录、不复制数组。
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import { usePhotoViewer } from '@/composables/usePhotoViewer'
import { isVortexReady, useVortex, vortexLabel } from '@/composables/useVortex'
import VortexFallback from './VortexFallback.vue'

/**
 * three 只在真的进 3D 时才下载：
 * 兜底路径连这一行都不会执行，因此 three 的字节也不会下载。
 */
const VortexScene = defineAsyncComponent(() => import('./VortexScene.vue'))

const vortex = useVortex()
const viewer = usePhotoViewer()

const photos = vortex.photos
const points = vortex.points
const preset = vortex.preset

/** 初始化失败（例如上下文创建抛错）→ 降级到 2D，绝不白屏 */
const sceneFailed = ref(false)
const frames = ref(0)
const loadedTextures = ref(0)
/** 有结果的贴图（成功或失败）：失败也要算，否则 loading 文案会挂死 */
const settledTextures = ref(0)

const mode = computed(() => (sceneFailed.value ? 'fallback' : vortex.mode.value))
/** 兜底模式下没有旋转/缩放可言，提示语要跟着变，不能承诺做不到的操作 */
const hint = computed(() =>
  mode.value === 'scene' ? '拖动旋转 · 滚轮远近 · 点击照片看大图' : '点击照片看大图'
)
const showLoading = computed(() => mode.value === 'scene' && !isVortexReady({
  frames: frames.value,
  loaded: loadedTextures.value,
  settled: settledTextures.value,
  total: photos.value.length
}))

/**
 * 点击第 index 张：整个数组交给查看器，下标就是螺旋上的下标。
 * 查看器是全站唯一实例（App.vue 里那个），这一页不碰它、也不销毁自己。
 */
function open(index: number): void {
  viewer.open(photos.value, index)
}

function onSceneReady(): void {
  frames.value = 1
}

function onSceneProgress(loaded: number, settled: number): void {
  loadedTextures.value = loaded
  settledTextures.value = settled
}

function onSceneFail(): void {
  sceneFailed.value = true
}
</script>

<template>
  <div class="vortex">
    <VortexScene
      v-if="mode === 'scene'"
      :photos="photos"
      :points="points"
      :preset="preset"
      @select="open"
      @ready="onSceneReady"
      @progress="onSceneProgress"
      @fail="onSceneFail"
    />

    <VortexFallback v-else-if="mode === 'fallback'" :photos="photos" @select="open" />

    <p v-else class="vortex__empty t-caption">这一天还没有照片。</p>

    <p v-if="showLoading" class="vortex__loading t-caption">正在打开这一天…</p>

    <p class="vortex__hint t-caption">{{ hint }}</p>

    <!--
      键盘与读屏的入口：3D 画布本身对它们是不可见的，所以这里保留一份真实按钮列表，
      默认视觉隐藏、聚焦时整块浮现（不是 display:none —— 那样键盘就够不到）。
    -->
    <ul v-if="mode === 'scene'" class="vortex__list" aria-label="照片（键盘可达）">
      <li v-for="(photo, index) in photos" :key="photo.id" class="vortex__list-item">
        <button type="button" class="vortex__list-button" @click="open(index)">
          <span class="vortex__list-index t-label">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="vortex__list-label">{{ vortexLabel(photo) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.vortex {
  position: absolute;
  inset: 0;
}

.vortex__loading,
.vortex__empty {
  position: absolute;
  left: 50%;
  top: 50%;
  margin: 0;
  transform: translate(-50%, -50%);
  color: var(--c-veil-muted);
  letter-spacing: 0.08em;
  animation: vortex-in var(--d-base) var(--e-out) both;
}

.vortex__empty {
  color: var(--c-veil-muted);
}

/* 底部一行操作提示：唯一一处"告诉用户怎么用"的文字，没有 HUD、没有图标 */
.vortex__hint {
  position: absolute;
  inset-inline: 0;
  bottom: var(--s-6);
  margin: 0;
  padding-inline: var(--pad-x);
  color: var(--c-veil-muted);
  text-align: center;
  letter-spacing: 0.08em;
  pointer-events: none;
}

@keyframes vortex-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* ---- 键盘入口：默认视觉隐藏，聚焦时作为一块面板浮现 ---- */
.vortex__list {
  position: absolute;
  left: 50%;
  top: 50%;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--s-1);
  width: min(90vw, 44rem);
  max-height: 70vh;
  margin: 0;
  padding: var(--s-4);
  overflow: auto;
  list-style: none;
  background: var(--c-veil);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.vortex__list:focus-within {
  opacity: 1;
  pointer-events: auto;
}

.vortex__list-button {
  display: flex;
  align-items: baseline;
  gap: var(--s-2);
  margin: 0;
  padding: var(--s-1) var(--s-2);
  border: 0;
  background: none;
  color: var(--c-veil-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.vortex__list-button:focus-visible {
  outline: 1px solid var(--c-veil-ink);
  outline-offset: 1px;
}

.vortex__list-index {
  color: var(--c-veil-muted);
}

.vortex__list-label {
  font-family: var(--f-serif);
  font-size: var(--t-small);
  line-height: 1.4;
}
</style>
