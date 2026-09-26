<script setup lang="ts">
/**
 * MemoryVortex —— /experience 的大脑，只做三件事：
 *
 *   1. 决定这一页走 3D（VortexScene）还是走静态兜底（VortexFallback）——
 *      WebGL 不可用、系统要求减少动态效果、3D 初始化失败，三种情况都落到兜底，
 *      绝不白屏；
 *   2. 把照片交给全站唯一的查看器：viewer.open(photos, index)，不新建第二套查看器；
 *   3. 贴图还没到位时给出**极简**的 loading 文案（没有进度条、没有 HUD、没有大 Loader）；
 *   4. 3D 里点开一张照片时，把"打开查看器"延后 preset.focusLead 秒 —— 让照片先靠近相机的
 *      那段三维过渡看得见（Phase 5 §38）。键盘列表与 2D 兜底没有三维过渡，立刻打开。
 *
 * 刻意不做的事：**不监听查看器的开合**。打开大图时这个 3D 场景继续挂载、继续极慢地转，
 * 关闭之后旋转角度、相机距离、照片位置全部保持原样 —— 没有任何重建。
 *
 * 照片来源只有一个：usePhotos()（featured 优先，不足 12 张从 all 按 order 补足），
 * 见 useVortex()。这里不读 JSON、不扫目录、不复制数组。
 */
import { computed, defineAsyncComponent, onBeforeUnmount, ref } from 'vue'
import { usePhotoViewer } from '@/composables/usePhotoViewer'
import site from '@/data/site.json'
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

/**
 * 3D 里点开一张照片（Phase 5 §38）：先让那张照片在画面里**靠近相机**（由 VortexScene
 * 的聚焦状态负责），过 preset.focusLead 秒再把查看器淡入上来 —— 三维过渡因此看得见，
 * 而查看器仍然是全站唯一的那一个实例（这一页不新建、也不销毁自己）。
 *
 * 键盘列表与 2D 兜底没有三维过渡可看，走上面的 open()，立刻打开。
 */
let openTimer = 0
function openFrom3D(index: number): void {
  if (openTimer) clearTimeout(openTimer)
  openTimer = window.setTimeout(() => {
    openTimer = 0
    open(index)
  }, preset.focusLead * 1000)
}

onBeforeUnmount(() => {
  if (openTimer) clearTimeout(openTimer)
  openTimer = 0
})

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
    <!--
      空间底：近黑 + 两团极低对比度的暖色光晕缓慢漂移 + 暗角极慢呼吸。
      刻意做成纯 CSS 合成器动画：
        · 不占 WebGL 帧循环（一条 uniform 都不用改，3D 的零分配红线不受影响）
        · 不产生任何网络请求、不新增依赖
        · transform / opacity 由合成器承担，GPU 成本可忽略
      颜色取 tokens 里的暖棕 #8A6A4F 与深酒红 #6E2B2B 加透明度
      （与首页首屏遮罩 rgba(11,11,11,…) 是同一做法：颜色的"色"来自 token，"透明度"写在原地）。
      动效总原则见 docs/02 §7：只做 opacity / transform，克制、不抢照片。
    -->
    <div class="vortex__air" aria-hidden="true">
      <span class="vortex__glow vortex__glow--warm" />
      <span class="vortex__glow vortex__glow--wine" />
      <span class="vortex__glow vortex__glow--pool" />
      <span class="vortex__vignette" />
    </div>

    <VortexScene
      v-if="mode === 'scene'"
      :photos="photos"
      :points="points"
      :preset="preset"
      @select="openFrom3D"
      @ready="onSceneReady"
      @progress="onSceneProgress"
      @fail="onSceneFail"
    />

    <VortexFallback v-else-if="mode === 'fallback'" :photos="photos" @select="open" />

    <p v-else class="vortex__empty t-caption">这一天还没有照片。</p>

    <!--
      中心镂空处的那行字（任务书 §22 / §57）：OUR DAY · 姐姐 & 姐夫 · 日期。
      相机永远看向 (0, lookAtHeight, 0)，那个世界点正好落在画面正中，
      所以这里用 DOM 居中就能和螺旋的中心轴对齐 —— 不需要把文字做成 3D 对象。
      刻意安静：不发光、不描边、不做动画 Logo，只是压在照片后面的一行小字。
    -->
    <div class="vortex__center" aria-hidden="true">
      <p class="vortex__center-title">{{ site.heroTitle }}</p>
      <p class="vortex__center-couple">{{ site.couple }}</p>
      <p class="vortex__center-date t-label">{{ site.dateDisplay }}</p>
    </div>

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

/* ---------------- 空间底：缓慢漂移的暖色光晕 + 暗角呼吸 ---------------- */

.vortex__air {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--c-veil);
  pointer-events: none;
  /*
   * 视差：--vortex-px / --vortex-py 由 3D 帧循环写在 .vortex 上（拖拽时才有值，
   * 静止时一帧都不写）。放大 1.08 是为了位移时永远不露边。
   */
  transform: translate3d(calc(var(--vortex-px, 0) * 1px), calc(var(--vortex-py, 0) * 1px), 0) scale(1.08);
}

.vortex__glow {
  position: absolute;
  display: block;
  border-radius: 50%;
  /* 大而柔的光，不是发光边框：用极低对比度的径向渐变，不叠 filter: blur */
  will-change: transform, opacity;
}

/*
 * 中央那池柔光。
 * 为什么需要它：投影是"压暗"出来的 —— 纯黑背景上再怎么压也看不见影子。
 * 先在螺旋背后铺一层很淡的暖光，照片的定向投影才有东西可压暗，
 * 于是"照片浮在一束光里、各自带着影子"这件事才成立。
 * 它同时把构图重心收到中间，避免四周两团光把画面拉散。
 */
.vortex__glow--pool {
  left: 6%;
  top: 16%;
  width: 88%;
  height: 62%;
  background: radial-gradient(ellipse at 50% 50%, rgba(196, 178, 152, 0.22), rgba(196, 178, 152, 0) 62%);
  animation: vortex-pool 41s var(--e-out) infinite alternate;
}

@keyframes vortex-pool {
  from {
    transform: translate3d(-2%, 1%, 0) scale(0.97);
    opacity: 0.78;
  }
  to {
    transform: translate3d(2%, -1%, 0) scale(1.04);
    opacity: 1;
  }
}

/* 暖棕的一团：从左上缓缓移到右下，同时轻微放大 */
.vortex__glow--warm {
  width: 78vmax;
  height: 78vmax;
  top: -18vmax;
  left: -14vmax;
  background: radial-gradient(circle at 50% 50%, rgba(138, 106, 79, 0.34), rgba(138, 106, 79, 0) 70%);
  animation: vortex-drift-a 34s var(--e-out) infinite alternate;
}

/* 深酒红的一团：反向缓慢移动，制造纵深，不制造"两个灯泡" */
.vortex__glow--wine {
  width: 92vmax;
  height: 92vmax;
  right: -24vmax;
  bottom: -28vmax;
  background: radial-gradient(circle at 50% 50%, rgba(110, 43, 43, 0.28), rgba(110, 43, 43, 0) 72%);
  animation: vortex-drift-b 47s var(--e-out) infinite alternate;
}

/* 暗角：极慢的明暗呼吸，让画面"活着"但不闪 */
.vortex__vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 46%, rgba(0, 0, 0, 0) 32%, rgba(0, 0, 0, 0.68) 100%);
  animation: vortex-breathe 26s var(--e-out) infinite alternate;
}

@keyframes vortex-drift-a {
  from {
    transform: translate3d(-8%, -6%, 0) scale(0.96);
  }
  to {
    transform: translate3d(16%, 12%, 0) scale(1.14);
  }
}

@keyframes vortex-drift-b {
  from {
    transform: translate3d(10%, 8%, 0) scale(1.12);
  }
  to {
    transform: translate3d(-14%, -10%, 0) scale(0.96);
  }
}

@keyframes vortex-breathe {
  from {
    opacity: 0.72;
  }
  to {
    opacity: 1;
  }
}

/* ---------------- 中心那行字 ---------------- */

.vortex__center {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
  /* 安静：低对比度、宽字距，压在照片后面当"空间的中心"，不是标题 */
  color: var(--c-veil-ink);
  opacity: 0.5;
  /*
   * §33 intro：中心文字**先**浮上来，照片堆在 3D 里随后渐显 —— 整段很短。
   * 纯 opacity / transform 的合成器动画；infinite 与 filter 都不在这里，
   * 减少动态效果由 base.scss 的全局规则统一归零。
   */
  animation: vortex-center-in var(--d-slow) var(--e-out) both;
}

@keyframes vortex-center-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + var(--s-3)));
  }
  to {
    opacity: 0.5;
    transform: translate(-50%, -50%);
  }
}

.vortex__center-title {
  font-family: var(--f-display);
  font-size: clamp(1.5rem, 4vw, 2.75rem);
  letter-spacing: var(--ls-display);
  line-height: 1.1;
  text-transform: uppercase;
  margin: 0;
}

.vortex__center-couple {
  margin-top: var(--s-3);
  font-family: var(--f-serif);
  font-size: var(--t-small);
  letter-spacing: 0.22em;
}

.vortex__center-date {
  margin-top: var(--s-2);
  color: var(--c-veil-muted);
  font-size: var(--t-caption);
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
