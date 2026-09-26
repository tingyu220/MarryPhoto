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
import { onBeforeUnmount, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
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
  lerpPose,
  liftProgressAt,
  nextPhaseOnEvent,
  phaseAt,
  provideVortexScene,
  revealAt,
  type ThreeModule,
  type VortexPhase,
  type VortexPoint,
  type VortexPreset,
  type VortexSceneContext
} from '@/composables/useVortex'
import VortexPhoto from './VortexPhoto.vue'
/* VortexCenter 暂时不挂载（用户反馈中心那道环不好），文件保留在仓库里 */

const props = defineProps<{
  /** 螺旋上的照片（必须与交给查看器的那个数组完全一致，下标才对得上） */
  photos: Photo[]
  points: VortexPoint[]
  preset: VortexPreset
  /**
   * 递增这个值 = 把开场时间轴倒回开头（照片重新回到堆里、再飞一次）。
   * 开场只有几秒，很容易在看别处的时候错过，所以给一个可以重播的入口。
   */
  replayKey?: number
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

/* ------------------------------- Phase 4/5：时间轴 · 聚焦 · 状态机 ------------------------------- */

/*
 * 这些全是**普通变量**（不是 ref）：逐帧读写它们不碰 Vue 的响应式（任务书 §11）。
 * 状态机的六种状态见 useVortex 的 VORTEX_PHASES —— 每个状态都真的在下面的循环里生效。
 */
let phase: VortexPhase = 'idle'
/** 从"开始渐显"起算的秒数；< 0 表示还在 idle（在等第一张贴图） */
let introClock = -1
/** idle 已经等了多久（秒）：网络卡住时用它兜底，不让画面一直黑着 */
let idleTime = 0
/** 第一张贴图有了结果（成功或失败都算）：idle 到这就结束 */
let introArmed = false
/** 聚焦：哪一张（-1 表示没有）、目标量、当前量、已经保持多久 */
let focusIndex = -1
let focusTarget = 0
let focusAmount = 0
let focusTimer = 0
/** 自转倍率：聚焦时减速到 preset.focusSpin，其余时候回到 1（永不为 0，旋转从不停止） */
let spinFactor = 1
/** 相纸是**全场景共享**的一份材质：渐显只有这一次赋值，18 张一起淡入 */
let paperRef: Material | null = null

const ctx: VortexSceneContext = {
  three: shallowRef<ThreeModule | null>(null),
  unitPlane: shallowRef<BufferGeometry | null>(null),
  paperMaterial: shallowRef<Material | null>(null),
  shadowMaterial: shallowRef<Material | null>(null),
  /** 背面用的更淡的投影材质（同一张贴图，只差一个 opacity） */
  shadowMaterialFar: shallowRef<Material | null>(null),
  shadowGroup: shallowRef<Group | null>(null),
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
    // 第一张贴图有了结果（成功或失败都算）→ idle 结束，照片堆开始渐显（§33）
    introArmed = true
    emit('progress', loadedTextures, settledTextures)
  }
}

// 必须在 setup 里 provide：子组件的 inject 发生在挂载之前，onMounted 里就太晚了
provideVortexScene(ctx)

/* ------------------------------- 渲染器引用（供卸载释放） ------------------------------- */

let rendererRef: WebGLRenderer | null = null
let shadowTextureRef: { dispose: () => void } | null = null
let shadowMaterialRef: { dispose: () => void } | null = null
let shadowMaterialFarRef: { dispose: () => void } | null = null
/** 逐帧要用到的两份投影材质：在 build 里赋值一次，帧循环只读这两个局部变量 */
let shadowNearRef: Material | null = null
let shadowFarRef: Material | null = null
/** 空间底视差：把偏移写成 CSS 变量，供 CSS 那一层读取（3D 侧一行不改） */
let parallaxTarget: HTMLElement | null = null
let lastParallaxX = 0
let lastParallaxY = 0
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

/** 空间底视差的换算（像素/弧度）。拖到边界时背景约移 20px —— 能感觉到纵深，不会晕 */
const PARALLAX_X = 40
const PARALLAX_Y = 50
/** 视差只在 ±0.6 rad 内跟着走，超过就顶住 */
const PARALLAX_MAX_YAW = 0.6

/*
 * 投影的「幕」与光方向（世界单位）。
 * 幕放在所有照片更后面：照片在 z ∈ [-R, +R]，幕在 SHADOW_PLANE_Z。
 * 光从左上照过来，所以影子落向右下。数值偏小是刻意的 ——
 * 位移太大，影子会和照片脱节，看起来像两组照片。
 */
const SHADOW_PLANE_Z = -5
const SHADOW_LIGHT_X = 0.2
const SHADOW_LIGHT_Y = -0.16
const SHADOW_LIGHT_Z = -1
/**
 * 转到后景的照片用的那份"更淡的影子"的透明度。
 * 抽成常量是因为帧循环要按渐显进度缩放它 —— 两处必须是同一个数。
 */
const SHADOW_FAR_OPACITY = 0.4

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * 照片下方那层柔光投影用的径向渐变贴图（128×128，一次生成、全场景共用）。
 * 用 canvas 画而不是引图片：零网络请求、零依赖，也不占仓库体积。
 * 它在近黑背景上单独看几乎不可见 —— 它的作用是在背后那两团暖光上"压"出一圈暗，
 * 于是照片看起来是**落在空间里**的，而不是贴上去的。
 */
function createShadowTexture(THREE: ThreeModule): { texture: unknown; material: unknown; materialFar: unknown } | null {
  if (typeof document === 'undefined') return null
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return null

  /*
   * 相纸形状的柔边，而不是一个圆。
   * 圆形的径向渐变会变成照片背后的一圈光晕（用户明确说"圈不太好"）；
   * 这里改成"圆角矩形"，并用穷人的模糊做出软边：
   * 把同一个矩形画很多遍，每遍向外扩一点、透明一点 —— 不依赖 ctx.filter
   * （iOS 16 以下的微信浏览器不支持 canvas filter，不能赌）。
   */
  const pad = 12
  const roundRect = (inset: number, alpha: number): void => {
    ctx2d.fillStyle = 'rgba(0,0,0,' + alpha.toFixed(4) + ')'
    const x = inset
    const y = inset
    const w = size - inset * 2
    const h = size - inset * 2
    const r = Math.min(w, h) * 0.03
    ctx2d.beginPath()
    ctx2d.moveTo(x + r, y)
    ctx2d.arcTo(x + w, y, x + w, y + h, r)
    ctx2d.arcTo(x + w, y + h, x, y + h, r)
    ctx2d.arcTo(x, y + h, x, y, r)
    ctx2d.arcTo(x, y, x + w, y, r)
    ctx2d.closePath()
    ctx2d.fill()
  }

  ctx2d.clearRect(0, 0, size, size)
  /*
   * 关键：**核心必须是实心的，只有最外一圈柔边**。
   * 第一版把整块都做成了渐变（中心最暗、四周渐隐），结果照片只挡住中心 ——
   * 露出来的那条边正好是渐变里最淡的部分，等于没有影子（用户两轮都说看不见）。
   * 现在：内缩 12px 的实心矩形打底，再向外补 7 圈递减的柔边。
   */
  roundRect(pad, 0.62)
  for (let i = 0; i < 7; i += 1) {
    const t = i / 6
    roundRect(pad * (1 - t), 0.5 * (1 - t) * (1 - t))
  }

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  })
  /*
   * 第二份材质给"转到背面的照片"用：更淡，避免后面的照片被一片暗色糊住
   * （用户反馈"不能全部旋转了，之前可以旋转到后面的图片"—— 旋转本身没改，
   *  是影子扫到背面时把照片压住了）。
   * 两份共享材质轮流用，逐帧只做一次赋值，不新建、不分配。
   */
  const materialFar = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: SHADOW_FAR_OPACITY
  })
  return { texture, material, materialFar }
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
    // §35：**动画期间照片照样可点**。这里唯一的门槛是"这张照片已经出现在画面里"
    // （beginFocus 只在 idle 时拒绝 —— 那时一张都还没显现），
    // 没有任何"升空动画还没走完就禁用交互"的判断，也没有 pointer-events 锁。
    if (hoverIndex >= 0 && beginFocus(hoverIndex)) emit('select', hoverIndex)
  }
  if (event.pointerType === 'touch') setHover(-1)
}

/**
 * 点击一张已经可见的照片：进入聚焦（Phase 5 §38）。
 *
 * 返回 false 表示这次点击不算数（只有 idle —— 照片还一张都没显现）。
 * 状态迁移本身由 useVortex 的纯函数给出，这样"哪些状态下能点"可以在 Node 里穷举断言。
 */
function beginFocus(index: number): boolean {
  const next = nextPhaseOnEvent(phase, 'select')
  if (next === phase) return false
  phase = next
  focusIndex = index
  focusTarget = 1
  focusTimer = 0
  return true
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
    // 画布透明：这一页的空间底（近黑 + 缓慢漂移的暖色光晕）由 CSS 层绘制，
    // 见 MemoryVortex 的 .vortex__air。3D 只画照片本身。
    alpha: true,
    powerPreference: 'high-performance'
  })
  renderer.setClearColor(tokenColor('--c-veil', '#0B0B0B'), 0)

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

  // 影子容器挂在 yawGroup 上：它不跟着自转，逐帧循环会把每张照片投到它里面
  const shadowGroup = new THREE.Group()
  shadowGroup.renderOrder = -1
  yawGroup.add(shadowGroup)

  // 全场景只有这一份平面几何、一份相纸材质、一份投影材质：照片的宽高靠 mesh.scale 表达
  const unitPlane = new THREE.PlaneGeometry(1, 1)
  /*
   * 相纸材质（全场景共享一份）。transparent 从建材质起就打开：
   * 照片堆"逐渐显现"（§33）靠的就是逐帧写这一份 opacity —— 一次赋值 18 张一起淡入。
   */
  const paperMaterial = new THREE.MeshBasicMaterial({ color: tokenColor('--c-bg', '#F5F2EC'), transparent: true })
  const shadow = createShadowTexture(THREE)
  if (shadow) {
    shadowTextureRef = shadow.texture as { dispose: () => void }
    shadowMaterialRef = shadow.material as { dispose: () => void }
    shadowMaterialFarRef = shadow.materialFar as { dispose: () => void }
  }

  // 空间底（.vortex__air）是 .vortex-scene 的直接父元素里的兄弟节点，
  // 把 CSS 变量写在父元素上，它就能沿 DOM 继承下去 —— 不需要任何 props 或 inject 传 DOM。
  parallaxTarget = hostEl.value?.parentElement ?? null

  rendererRef = renderer
  sceneRef = scene
  cameraRef = camera
  raycasterRef = new THREE.Raycaster()
  pointerRef = new THREE.Vector2(0, 0)
  ctx.maxAnisotropy = renderer.capabilities.getMaxAnisotropy()

  ctx.three.value = THREE
  ctx.unitPlane.value = unitPlane
  ctx.paperMaterial.value = paperMaterial
  ctx.shadowMaterial.value = (shadow ? shadow.material : null) as never
  ctx.shadowMaterialFar.value = (shadow ? shadow.materialFar : null) as never
  // 帧循环读这两个局部变量，避免在循环里访问 .value
  shadowNearRef = shadow ? (shadow.material as Material) : null
  shadowFarRef = shadow ? (shadow.materialFar as Material) : null
  ctx.shadowGroup.value = shadowGroup
  ctx.loader.value = new THREE.TextureLoader()
  ctx.center.value = centerGroup
  // spiral 必须最后赋值：子组件等它出现才开始建自己的 mesh，此时其它资源都已就绪
  ctx.spiral.value = spinGroup

  const pointList = props.points
  const timing = preset.timing
  const photoCount = props.photos.length
  // 帧循环读这个局部引用，避免在循环里访问响应式状态（红线：逐帧零响应式）
  paperRef = paperMaterial

  // #region frame-loop
  function frame(now: number): void {
    if (!running) return
    rafId = requestAnimationFrame(frame)

    const dt = lastFrameTime > 0 ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0
    lastFrameTime = now

    /*
     * 0) 时间轴（Phase 4 §31~§34）。
     *    idle  —— 照片堆已经在位，但还没有显现：等第一张贴图（最多 timing.introMaxWait 秒）。
     *             这样淡入的不是一排主色块，而是真的照片。
     *    intro —— 中心文字 + 照片堆渐显；lifting —— 逐张抽离升空；orbiting —— 全部到位。
     *    整段只有普通数值的加减与比较：不读响应式、不分配对象。
     */
    if (introClock < 0) {
      idleTime += dt
      if (introArmed || idleTime >= timing.introMaxWait) introClock = 0
    } else {
      introClock += dt
      if (phase === 'idle' || phase === 'intro' || phase === 'lifting') {
        const timed = phaseAt(introClock, photoCount, timing)
        if (timed !== phase) phase = timed
      }
    }
    const reveal = introClock < 0 ? 0 : revealAt(introClock, timing)

    // 1) 自动旋转：极慢，且永不停止（hover 不停；聚焦只是减速到 focusSpin 倍，仍然在转）
    spinFactor += ((phase === 'focusing' ? preset.focusSpin : 1) - spinFactor) * Math.min(1, dt * 4)
    spinGroup.rotation.y += preset.spin * spinFactor * dt

    // 2) 拖拽 / 滚轮的阻尼：帧率无关的指数逼近
    const ease = Math.min(1, dt * 6)
    viewYaw += (targetYaw - viewYaw) * ease
    viewPitch += (targetPitch - viewPitch) * ease
    distance += (targetDistance - distance) * ease
    yawGroup.rotation.y = viewYaw
    tiltGroup.rotation.x = viewPitch
    camera.position.z = distance
    camera.lookAt(0, preset.lookAtHeight, 0)

    // 3) 空间底视差：整个空间被拖拽时，背景反向轻微位移（幅度很小，只为纵深）
    //    只在变化超过半像素时才写 DOM —— 静止时一帧都不写
    // 视差只看"小角度"的那一段：yaw 现在可以拖到 180°，
    // 直接乘上去背景会飞出屏幕，画面会变成"两层各转各的"
    const parallaxYaw = viewYaw > PARALLAX_MAX_YAW ? PARALLAX_MAX_YAW : viewYaw < -PARALLAX_MAX_YAW ? -PARALLAX_MAX_YAW : viewYaw
    const px = -parallaxYaw * PARALLAX_X
    const py = viewPitch * PARALLAX_Y
    if (px - lastParallaxX > 0.5 || lastParallaxX - px > 0.5 || py - lastParallaxY > 0.5 || lastParallaxY - py > 0.5) {
      lastParallaxX = px
      lastParallaxY = py
      if (parallaxTarget) {
        parallaxTarget.style.setProperty('--vortex-px', px.toFixed(1))
        parallaxTarget.style.setProperty('--vortex-py', py.toFixed(1))
      }
    }

    // 4) hover：命中判定只在指针动过的帧做
    if (pickDirty && pointerInside) pick()

    /*
     * 4b) 聚焦（Phase 5 §38）：点击之后当前照片靠近相机、轻微放大，其它照片变暗、自转减速。
     *     保持 timing.focusHold 秒后自动回位 —— 那时全屏查看器已经盖住画面，
     *     用户关掉查看器看到的正是"照片已经在原位、空间继续极慢旋转"（§39）。
     */
    if (phase === 'focusing' || phase === 'returning') {
      focusAmount += (focusTarget - focusAmount) * Math.min(1, dt * 5)
      focusTimer += dt
      if (phase === 'focusing' && focusTimer >= timing.focusHold) {
        phase = nextPhaseOnEvent(phase, 'hold-elapsed')
        focusTarget = 0
      } else if (phase === 'returning' && focusAmount < 0.01) {
        focusAmount = 0
        focusIndex = -1
        phase = nextPhaseOnEvent(phase, 'returned')
      }
    }

    // 5) 渐显：相纸是全场景共享的一份材质，一次赋值就是 18 张一起淡入
    if (paperRef) paperRef.opacity = reveal

    // 6) 逐张插值 + hover / 聚焦的轻微位移 + 投影
    const spinCos = Math.cos(spinGroup.rotation.y)
    const spinSin = Math.sin(spinGroup.rotation.y)
    // 帧循环里只做比较与赋值，不在循环体内读响应式状态（红线：逐帧零分配、零响应式读取）
    const shadowMaterialNear = shadowNearRef
    const shadowMaterialFar = shadowFarRef
    // 投影跟着照片一起淡入，否则会先浮出一片暗斑
    if (shadowMaterialNear) shadowMaterialNear.opacity = reveal
    if (shadowMaterialFar) shadowMaterialFar.opacity = SHADOW_FAR_OPACITY * reveal
    // 聚焦时"其它照片变暗"的系数：一次算好，循环里只做一次乘法
    const dim = 1 - focusAmount * (1 - preset.focusDim)

    for (let index = 0; index < photoObjects.length; index += 1) {
      const object = photoObjects[index]
      if (!object) continue
      const base = pointList[index]
      const stack = object.userData.stack
      const home = object.userData.home
      // point 是这张照片**此刻**的姿态：堆 → 螺旋的插值落点（预分配，就地改写）
      const point = object.userData.pose
      if (!base || !stack || !home || !point) continue

      /*
       * §34：每张照片用它自己的 startTransform(stack) / targetTransform(home) / progress 做插值。
       * progress 由时间轴逐张错开，插值写进已经存在的 point —— 每帧零分配（红线 §51）。
       */
      lerpPose(point, stack, home, liftProgressAt(introClock, index, timing))

      const focused = index === focusIndex ? focusAmount : 0
      const goal = (index === hoverIndex ? preset.hoverScale : 1) * (1 + focused * (preset.focusScale - 1))
      const scale = object.scale.x + (goal - object.scale.x) * Math.min(1, dt * 8)
      object.scale.set(scale, scale, scale)

      // hover 轻微外推（§37）+ 聚焦时再靠近相机一点（§38）：都沿"背离中心轴"的方向
      const push = (scale - 1) * 1.8 + focused * preset.focusPush
      object.position.x = point.x + base.nx * push
      object.position.y = point.y
      object.position.z = point.z + base.nz * push
      object.rotation.set(point.rotationX, point.rotationY, point.rotationZ)

      // 渐显 / 聚焦变暗：只压照片本体自己的材质（相纸共享一份，动它会连累所有照片）
      const photoMaterial = object.userData.photoMaterial
      if (photoMaterial) photoMaterial.opacity = index === focusIndex ? reveal : reveal * dim

      /*
       * 投影：把这张照片沿光的方向投到背后的「幕」上（z = SHADOW_PLANE_Z）。
       * 用 point（此刻的实际位置）而不是螺旋基准点 —— 照片从堆里飞出来时，影子跟着一起飞。
       * 相机永远在 +z 侧、幕又在所有照片更后面，所以影子**永远不会被照片挡住** ——
       * 这正是前几版看不见影子的根因（贴在照片背后的影子会被自己挡掉大半）。
       * 照片到幕的距离随自转变化（转到近侧时更远、远侧时更近），
       * 于是影子会跟着**扫动、伸缩**，而不是死死贴在照片上。
       */
      const shadow = object.userData.shadow
      if (shadow) {
        const worldX = point.x * spinCos + point.z * spinSin
        const worldZ = -point.x * spinSin + point.z * spinCos
        const reach = (SHADOW_PLANE_Z - worldZ) / SHADOW_LIGHT_Z
        shadow.position.set(worldX + SHADOW_LIGHT_X * reach, point.y + SHADOW_LIGHT_Y * reach, SHADOW_PLANE_Z)
        // 转到后景的照片，影子换用更淡的那份材质：后景本来就暗，再压一片黑就只剩一团
        const near = worldZ > 0
        const wanted = near ? shadowMaterialNear : shadowMaterialFar
        if (wanted && shadow.material !== wanted) shadow.material = wanted
      }
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

/*
 * 重播：把时间轴倒回开头。
 * 只重置时间轴与相位 —— 相机、拖拽角度、贴图都不动，所以重播是"再飞一次"而不是"重载整页"。
 */
watch(
  () => props.replayKey,
  () => {
    if (disposed) return
    /*
     * 立刻从 0 开始，**不能**退回 -1。
     * -1 表示"还没开始"，那要等 introArmed（贴图已加载完就不会再触发）或 idleTime 攒够
     * introMaxWait（1.6s）才启动 —— 用户点完按钮盯着屏幕 1.6 秒没动静，
     * 只会得出"点了没反应"的结论。
     */
    introClock = 0
    idleTime = 0
    introArmed = false
    phase = 'intro'
  }
)

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
  // 投影：材质先释放，再释放它引用的那张 canvas 贴图
  ctx.shadowMaterial.value?.dispose()
  ctx.shadowMaterialFar.value?.dispose()
  shadowMaterialRef?.dispose()
  shadowMaterialFarRef?.dispose()
  shadowTextureRef?.dispose()
  shadowMaterialFarRef = null
  // 帧循环读的那两个引用也要摘掉：它们指向刚刚被释放的材质
  shadowNearRef = null
  shadowFarRef = null
  ctx.unitPlane.value = null
  ctx.paperMaterial.value = null
  ctx.shadowMaterial.value = null
  ctx.shadowMaterialFar.value = null
  shadowMaterialRef = null
  shadowTextureRef = null

  // 清掉视差变量，别把偏移留给下一次进入
  if (parallaxTarget) {
    parallaxTarget.style.removeProperty('--vortex-px')
    parallaxTarget.style.removeProperty('--vortex-py')
    parallaxTarget = null
  }
  ctx.spiral.value = null
  ctx.center.value = null
  ctx.loader.value = null
  ctx.three.value = null
  // 时间轴与聚焦状态全部归零（组件实例本来就会重建，这里只是不留悬空引用）
  paperRef = null
  phase = 'idle'
  introClock = -1
  idleTime = 0
  introArmed = false
  focusIndex = -1
  focusTarget = 0
  focusAmount = 0
  focusTimer = 0
  spinFactor = 1

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

    <!--
      中心不再画那道细环：用户直接反馈"那个圈不太好"。
      中心要保持镂空，由 MemoryVortex 用一行安静的文字占位（OUR DAY / 姐姐 & 姐夫 / 日期），
      这本来就是任务书 §22/§57 对中心的要求。
      VortexCenter.vue 暂时保留在仓库里不再挂载（按删除规则不擅自删文件）。
    -->
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
