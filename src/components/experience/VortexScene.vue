<script setup lang="ts">
/**
 * VortexScene —— Memory Vortex 的 3D 部分（Phase 3 原型）。
 *
 * 分工（任务书 §11 性能红线）：
 *   - **three 负责逐帧**：旋转、hover 缩放、阻尼、pick —— 全部是往已有对象上赋值，
 *     每一帧都不 new Vector / Matrix / Material / Color，也不触发任何 Vue 响应式更新；
 *   - **Vue 负责页面状态**：生命周期、档位配置、以及"贴图到没到位"这一件需要驱动 UI 的事。
 *
 * three 的运行时在这里**动态 import**，有三个理由：
 *   1) 降级路径（无 WebGL / prefers-reduced-motion）连 three 的字节都不会下载；
 *   2) Vite 会把 three 拆进 /experience 自己的分包，首屏入口 JS 不受影响；
 *   3) 本文件因此可以在没有 WebGL 的 Node 里被加载（scripts/checks/39-experience.mjs）。
 *
 * 相机是**固定的**：没有自由飞行、没有 WASD、没有上下乱转。
 * 拖拽只是"轻微旋转整个空间"（±maxYaw / ±maxPitch），滚轮只在 minDistance~maxDistance
 * 之间推进拉远，全部有边界。
 *
 * 释放路径（反复进出 /experience 不能让显存上涨）：
 *   onBeforeUnmount：停 rAF、摘事件、断 ResizeObserver —— 先停手；
 *   子组件（VortexPhoto / VortexCenter）各自 dispose 自己的材质与贴图；
 *   onUnmounted：最后释放共享的平面几何、相纸材质，renderer.dispose() + 强制丢弃上下文。
 *   顺序不能反：共享资源必须在子组件全部交还引用之后再释放。
 */
import { onBeforeUnmount, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type {
  BufferGeometry,
  Group,
  Material,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  TextureLoader,
  Vector2,
  WebGLRenderer
} from 'three'
import type { Photo } from '@/types/photo'
import {
  provideVortexScene,
  type ThreeModule,
  type VortexPoint,
  type VortexPreset,
  type VortexSceneContext
} from '@/composables/useVortex'
import VortexPhoto from './VortexPhoto.vue'
import VortexCenter from './VortexCenter.vue'

const props = defineProps<{
  /** 螺旋上的照片（必须与交给查看器的那个数组完全一致，下标才对得上） */
  photos: Photo[]
  points: VortexPoint[]
  preset: VortexPreset
}>()

const emit = defineEmits<{
  select: [index: number]
  ready: []
  progress: [loaded: number, settled: number]
  fail: [reason: string]
}>()

/** 档位在整个生命周期里固定：中途换档意味着重排螺旋 + 重建贴图，代价远大于收益 */
const preset = props.preset

const hostEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

/* ------------------------------- 场景上下文 ------------------------------- */

/** 下标即螺旋下标（与 props.points 对齐）；卸载时置 null，不 splice（避免下标错位） */
const photoObjects: (Object3D | null)[] = []
/** 给 raycaster 用的稠密数组（intersectObjects 不接受 null） */
const hitList: Object3D[] = []

let hoverIndex = -1
/** 有结果的贴图（成功或失败）—— 失败也要算"有结果"，否则 loading 文案会挂死 */
let settledTextures = 0
let loadedTextures = 0

const ctx: VortexSceneContext = {
  three: shallowRef<ThreeModule | null>(null),
  unitPlane: shallowRef<BufferGeometry | null>(null),
  paperMaterial: shallowRef<Material | null>(null),
  spiral: shallowRef<Group | null>(null),
  center: shallowRef<Group | null>(null),
  loader: shallowRef<TextureLoader | null>(null),
  maxAnisotropy: 1,
  registerPhoto(object, index) {
    photoObjects[index] = object
    if (!hitList.includes(object)) hitList.push(object)
    pickDirty = true
  },
  unregisterPhoto(object) {
    const index = photoObjects.indexOf(object)
    if (index !== -1) photoObjects[index] = null
    const hit = hitList.indexOf(object)
    if (hit !== -1) hitList.splice(hit, 1)
  },
  textureSettled(ok) {
    settledTextures += 1
    if (ok) loadedTextures += 1
    emit('progress', loadedTextures, settledTextures)
  }
}

// 必须在 setup 里 provide：子组件的 inject 发生在挂载之前，onMounted 里就太晚了
provideVortexScene(ctx)

/* ------------------------------- 渲染器引用（供卸载释放） ------------------------------- */

let rendererRef: WebGLRenderer | null = null
let sceneRef: Scene | null = null
let cameraRef: PerspectiveCamera | null = null
let raycasterRef: Raycaster | null = null
let pointerRef: Vector2 | null = null
let observerRef: ResizeObserver | null = null
let rafId = 0
let running = false
let disposed = false

/* ------------------------------- 指针状态 ------------------------------- */

let rect: DOMRect | null = null
let pointerDown = false
let pointerInside = false
let dragDistance = 0
let lastX = 0
let lastY = 0
let pickDirty = true

/** 超过这个位移就算"拖拽"，不算"点击" */
const DRAG_THRESHOLD = 6
/** 拖拽灵敏度（弧度/像素）：拖满屏也只是转十几度 */
const DRAG_SENSITIVITY = 0.004

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** 从 tokens.scss 读一个颜色（与 SiteHeader 读 --s-16 的做法一致），读不到就用兜底色 */
function tokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw || fallback
}

/* ------------------------------- 指针 / 滚轮 ------------------------------- */

function updatePointer(event: PointerEvent): void {
  const canvas = canvasEl.value
  const pointer = pointerRef
  if (!canvas || !pointer) return
  if (!rect) rect = canvas.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
}

function setHover(index: number): void {
  if (index === hoverIndex) return
  hoverIndex = index
  const canvas = canvasEl.value
  if (canvas) canvas.style.cursor = index >= 0 ? 'pointer' : 'grab'
}

/** 只在指针动过之后（pickDirty）才做射线检测，不是每帧都做 */
function pick(): void {
  pickDirty = false
  const raycaster = raycasterRef
  const pointer = pointerRef
  const camera = cameraRef
  if (!raycaster || !pointer || !camera || !pointerInside || hitList.length === 0) {
    setHover(-1)
    return
  }
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects(hitList, true)
  const first = hits.length > 0 ? hits[0].object.userData.vortexIndex : -1
  setHover(typeof first === 'number' ? first : -1)
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  pointerDown = true
  pointerInside = true
  dragDistance = 0
  lastX = event.clientX
  lastY = event.clientY
  canvasEl.value?.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  pointerInside = true
  updatePointer(event)
  pickDirty = true
  if (!pointerDown) return

  const dx = event.clientX - lastX
  const dy = event.clientY - lastY
  lastX = event.clientX
  lastY = event.clientY
  dragDistance += Math.abs(dx) + Math.abs(dy)
  if (dragDistance <= DRAG_THRESHOLD) return

  // 拖拽 = 轻微旋转整个空间；边界由 preset 给出，绝不放任自由飞行
  targetYaw = clamp(targetYaw + dx * DRAG_SENSITIVITY, -preset.maxYaw, preset.maxYaw)
  if (preset.allowPitch) {
    targetPitch = clamp(targetPitch + dy * DRAG_SENSITIVITY * 0.6, -preset.maxPitch, preset.maxPitch)
  }
}

function onPointerUp(event: PointerEvent): void {
  if (!pointerDown) return
  pointerDown = false
  pointerInside = true
  canvasEl.value?.releasePointerCapture?.(event.pointerId)
  // 轻点：先在同一位置命中一次 —— 触摸没有 hover，不这样处理就点不中
  if (dragDistance <= DRAG_THRESHOLD) {
    updatePointer(event)
    pick()
    if (hoverIndex >= 0) emit('select', hoverIndex)
  }
  if (event.pointerType === 'touch') setHover(-1)
}

function onPointerLeave(): void {
  pointerInside = false
  pickDirty = false
  if (!pointerDown) setHover(-1)
}

function onWheel(event: WheelEvent): void {
  // 页面本身不滚动，滚轮只用来推进/拉远，且有硬边界
  event.preventDefault()
  targetDistance = clamp(
    targetDistance + clamp(event.deltaY, -60, 60) * 0.02,
    preset.minDistance,
    preset.maxDistance
  )
}

/* ------------------------------- 逐帧阻尼状态 ------------------------------- */

let viewYaw = 0
let targetYaw = 0
let viewPitch = 0
let targetPitch = 0
let distance = preset.cameraDistance
let targetDistance = preset.cameraDistance

/* ------------------------------- 尺寸 ------------------------------- */

function measure(): void {
  const host = hostEl.value
  if (!host) return
  rect = host.getBoundingClientRect()
  const width = Math.max(1, host.clientWidth)
  const height = Math.max(1, host.clientHeight)
  if (rendererRef) {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    rendererRef.setPixelRatio(Math.min(dpr, preset.maxDpr))
    rendererRef.setSize(width, height, false)
  }
  if (cameraRef) {
    cameraRef.aspect = width / height
    cameraRef.updateProjectionMatrix()
  }
}

function onVisibilityChange(): void {
  if (disposed) return
  if (document.hidden) {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  } else if (!running && rendererRef && frameRef) {
    running = true
    lastFrameTime = 0
    rafId = requestAnimationFrame(frameRef)
  }
}

let lastFrameTime = 0
/** 逐帧函数由 build() 定义（它闭包持有非 null 的 renderer / scene / camera） */
let frameRef: ((now: number) => void) | null = null

/* ------------------------------- 建场景 ------------------------------- */

function build(THREE: ThreeModule): void {
  const host = hostEl.value
  const canvas = canvasEl.value
  if (!host || !canvas) throw new Error('3D 容器还没准备好')

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: preset.antialias,
    alpha: false,
    powerPreference: 'high-performance'
  })
  renderer.setClearColor(tokenColor('--c-veil', '#0B0B0B'), 1)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(preset.fov, 1, 0.1, 200)
  camera.position.set(0, preset.cameraHeight, preset.cameraDistance)

  // 三层分组：tilt（上下）→ yaw（左右）→ spin（自动旋转）
  // 自动旋转永远只转 spin 这一层，所以拖拽与自转互不干扰
  const tiltGroup = new THREE.Group()
  const yawGroup = new THREE.Group()
  const spinGroup = new THREE.Group()
  yawGroup.add(spinGroup)
  tiltGroup.add(yawGroup)
  scene.add(tiltGroup)

  const centerGroup = new THREE.Group()
  yawGroup.add(centerGroup)

  // 全场景只有这一份平面几何、一份相纸材质：照片的宽高靠 mesh.scale 表达
  const unitPlane = new THREE.PlaneGeometry(1, 1)
  const paperMaterial = new THREE.MeshBasicMaterial({ color: tokenColor('--c-bg', '#F5F2EC') })

  rendererRef = renderer
  sceneRef = scene
  cameraRef = camera
  raycasterRef = new THREE.Raycaster()
  pointerRef = new THREE.Vector2(0, 0)
  ctx.maxAnisotropy = renderer.capabilities.getMaxAnisotropy()

  ctx.three.value = THREE
  ctx.unitPlane.value = unitPlane
  ctx.paperMaterial.value = paperMaterial
  ctx.loader.value = new THREE.TextureLoader()
  ctx.center.value = centerGroup
  // spiral 必须最后赋值：子组件等它出现才开始建自己的 mesh，此时其它资源都已就绪
  ctx.spiral.value = spinGroup

  const pointList = props.points

  // #region frame-loop
  function frame(now: number): void {
    if (!running) return
    rafId = requestAnimationFrame(frame)

    const dt = lastFrameTime > 0 ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0
    lastFrameTime = now

    // 1) 自动旋转：极慢，且永不停止（hover 也不停）
    spinGroup.rotation.y += preset.spin * dt

    // 2) 拖拽 / 滚轮的阻尼：帧率无关的指数逼近
    const ease = Math.min(1, dt * 6)
    viewYaw += (targetYaw - viewYaw) * ease
    viewPitch += (targetPitch - viewPitch) * ease
    distance += (targetDistance - distance) * ease
    yawGroup.rotation.y = viewYaw
    tiltGroup.rotation.x = viewPitch
    camera.position.z = distance
    camera.lookAt(0, preset.lookAtHeight, 0)

    // 3) hover：命中判定只在指针动过的帧做
    if (pickDirty && pointerInside) pick()

    // 4) 逐张逼近 hover 缩放，并沿"背离中心轴"的方向轻轻推出去
    for (let index = 0; index < photoObjects.length; index += 1) {
      const object = photoObjects[index]
      if (!object) continue
      const goal = index === hoverIndex ? preset.hoverScale : 1
      const scale = object.scale.x + (goal - object.scale.x) * Math.min(1, dt * 8)
      object.scale.set(scale, scale, scale)
      const push = (scale - 1) * 1.8
      const point = pointList[index]
      if (!point) continue
      object.position.x = point.x + point.nx * push
      object.position.z = point.z + point.nz * push
    }

    renderer.render(scene, camera)
    if (!renderedOnce) {
      renderedOnce = true
      emit('ready')
    }
  }
  // #endregion frame-loop

  let renderedOnce = false
  frameRef = frame

  measure()
  if (typeof ResizeObserver === 'function') {
    observerRef = new ResizeObserver(measure)
    observerRef.observe(host)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', measure)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  // passive: false —— 滚轮要 preventDefault
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.style.cursor = 'grab'

  running = true
  lastFrameTime = 0
  rafId = requestAnimationFrame(frame)
}

/** 被卸载打断时不要留下半截场景 */
function detach(): void {
  const canvas = canvasEl.value
  if (canvas) {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('wheel', onWheel)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', measure)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

onMounted(async () => {
  try {
    const THREE = await import('three')
    if (disposed) return
    build(THREE)
  } catch (error) {
    // 拿不到 WebGL / 初始化抛错 → 交给上层降级，绝不白屏
    emit('fail', error instanceof Error ? error.message : String(error))
  }
})

onBeforeUnmount(() => {
  // 先停手：children 的 dispose 会在之后发生，不能让循环再碰它们
  disposed = true
  running = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  detach()
  observerRef?.disconnect()
  observerRef = null
})

onUnmounted(() => {
  // 共享资源最后释放（此时子组件已经各自释放过自己的材质与贴图）
  ctx.unitPlane.value?.dispose()
  ctx.paperMaterial.value?.dispose()
  ctx.unitPlane.value = null
  ctx.paperMaterial.value = null
  ctx.spiral.value = null
  ctx.center.value = null
  ctx.loader.value = null
  ctx.three.value = null

  sceneRef?.clear()
  if (rendererRef) {
    rendererRef.dispose()
    // 主动丢弃 WebGL 上下文：只 dispose 的话，上下文要等 GC 才还回去，
    // 反复进出这一页会让显存一路涨上去
    rendererRef.forceContextLoss()
  }
  frameRef = null
  rendererRef = null
  sceneRef = null
  cameraRef = null
  raycasterRef = null
  pointerRef = null
  photoObjects.length = 0
  hitList.length = 0
  rect = null
  hoverIndex = -1
})
</script>

<template>
  <div ref="hostEl" class="vortex-scene">
    <canvas ref="canvasEl" class="vortex-scene__canvas" aria-hidden="true" />

    <!--
      每张照片在这里登记自己的 three 对象：VortexPhoto 不渲染 DOM，
      它只是"一张照片的生命周期"（材质与贴图在它自己身上创建、也在它自己身上释放）。
    -->
    <VortexPhoto
      v-for="(photo, index) in photos"
      :key="photo.id"
      :photo="photo"
      :point="points[index]"
      :preset="preset"
      :index="index"
    />

    <VortexCenter :preset="preset" :count="photos.length" />
  </div>
</template>

<style scoped>
.vortex-scene {
  position: absolute;
  inset: 0;
}

.vortex-scene__canvas {
  display: block;
  width: 100%;
  height: 100%;
  /* 手机上拖动照片墙时不要连带滚动页面 */
  touch-action: none;
}
</style>
