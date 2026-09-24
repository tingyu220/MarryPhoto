/**
 * Memory Vortex（/experience）的纯逻辑与页面状态 —— Phase 3 原型。
 *
 * 这个模块刻意分成两半：
 *
 * 1) **纯函数**：螺旋几何、选片、降级判定、就绪判定、稳定随机种子。
 *    它们不碰 DOM、不碰 three，因此可以在没有 WebGL 的 Node 里直接断言
 *    （scripts/checks/39-experience.mjs）；
 *
 * 2) **useVortex()**：只负责"页面状态"——照片从哪来、这一次会话用哪一档配置、
 *    要不要降级。逐帧的旋转 / 缩放 / 位移一律由 three 在渲染循环里改对象属性，
 *    **不经过 Vue 的响应式**（任务书 §11 性能红线）。
 *
 * 照片数据只有一个来源：usePhotos()（featured 优先，不足 12 张时按 order 从 all 补足）。
 * 这里不新建第二套照片 JSON、不复制 Photo[]、不重新扫描 public/photos。
 *
 * three 在本文件里**只以 import type 出现**：运行时的 three 由 VortexScene.vue 在
 * onMounted 里动态 import。这样
 *   - 降级路径（无 WebGL / prefers-reduced-motion）连 three 的字节都不会下载；
 *   - 本文件以及各个 .vue 组件都能在没有 WebGL 的 Node 里被加载并断言。
 */
import { computed, getCurrentScope, inject, onScopeDispose, provide, ref } from 'vue'
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue'
import type { BufferGeometry, Group, Material, Object3D, TextureLoader } from 'three'
import type { Photo } from '@/types/photo'
import { SCENE_LABELS } from '@/data/taxonomy'
import { usePhotos } from '@/composables/usePhotos'

/* ============================ 1. 螺旋几何（纯函数） ============================ */

/**
 * 螺旋的形状（不含照片数）。照片数由调用方给出，所以检查里可以直接换成 12 来断言。
 *
 * 第一版是**规则螺旋**：
 *
 *   angle = index × angleStep
 *   x     = radius × cos(angle)
 *   z     = radius × sin(angle)
 *   y     = startHeight + index × verticalGap
 *
 * 其中 radius 每上一张会往外张开 radiusGrowth（0 就是正圆柱，> 0 就是敞口的花瓶），
 * 越往上越开阔 —— 这是"漩涡"更像空间装置而不是铁笼子的关键。
 */
export interface VortexGeometry {
  /** 相邻两张的角度步进（弧度） */
  angleStep: number
  /** 最内圈（第一张）离中心轴的距离 */
  radius: number
  /** 每上一张往外张开的量 */
  radiusGrowth: number
  /** 相邻两张的高度差 */
  verticalGap: number
  /** 照片在世界里的高度（宽度 = photoHeight × 照片比例） */
  photoHeight: number
}

/** 一张照片在空间里的位置与朝向 */
export interface VortexPoint {
  index: number
  /** 绕中心轴的角度（弧度） */
  angle: number
  /** 该点到中心轴的距离 */
  radius: number
  x: number
  y: number
  z: number
  /** 照片面朝外（+Z 指向背离中心轴的方向）时的绕 Y 旋转 */
  rotationY: number
  /** 由中心轴指向该点的水平单位向量（hover 时往相机方向轻推要用） */
  nx: number
  nz: number
}

/** 螺旋整体在垂直方向上居中：第一张的 y */
export function startHeightOf(count: number, geometry: VortexGeometry): number {
  return -((count - 1) * geometry.verticalGap) / 2
}

/** 第 index 张照片的位置与朝向 */
export function spiralPoint(index: number, startHeight: number, geometry: VortexGeometry): VortexPoint {
  const angle = index * geometry.angleStep
  const radius = geometry.radius + index * geometry.radiusGrowth
  const nx = Math.cos(angle)
  const nz = Math.sin(angle)
  return {
    index,
    angle,
    radius,
    x: radius * nx,
    y: startHeight + index * geometry.verticalGap,
    z: radius * nz,
    // 平面的法线默认是 +Z，要让它指向背离中心轴的方向：绕 Y 转 (π/2 − angle)
    rotationY: Math.PI / 2 - angle,
    nx,
    nz
  }
}

/** 整条螺旋（count 张） */
export function buildSpiral(count: number, geometry: VortexGeometry): VortexPoint[] {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  const startHeight = startHeightOf(safeCount, geometry)
  const points: VortexPoint[] = []
  for (let index = 0; index < safeCount; index += 1) {
    points.push(spiralPoint(index, startHeight, geometry))
  }
  return points
}

/** 最内圈半径（radiusGrowth 非负时就是第一张） */
export function minRadiusOf(count: number, geometry: VortexGeometry): number {
  const steps = Math.max(0, Math.floor(count) - 1)
  return geometry.radius + Math.min(0, steps * geometry.radiusGrowth)
}

/**
 * 照片宽度相对高度的上限。
 * 极端全景（比例 6:1）不参与"往中心挤"的推算，否则内半径会被一张图拖成负数。
 */
export const VORTEX_MAX_ASPECT = 2

/** 一张照片在世界里的宽度（比例做了钳制，避免极端全景把版面撑爆） */
export function photoWidthOf(photo: { ratio: number }, geometry: VortexGeometry): number {
  const ratio = Number.isFinite(photo.ratio) && photo.ratio > 0 ? photo.ratio : 1
  return geometry.photoHeight * Math.min(Math.max(ratio, 0.5), VORTEX_MAX_ASPECT)
}

/**
 * 内半径 —— "中心必须镂空"的硬保证。
 *
 * 本项目的照片是**切向**摆放的（相纸平面与所在半径的圆相切），切线上离圆心最近的点
 * 就是切点本身，距离恒等于 radius。这里再保守一点，把"照片半宽"也减掉：
 * 只要返回值 > 0，无论照片多宽，都不可能穿过中心轴。
 *
 * 检查里断言：innerRadiusOf(12, preset) > 0，且所有点的 x² + z² ≥ innerRadius²。
 */
export function innerRadiusOf(count: number, geometry: VortexGeometry): number {
  return minRadiusOf(count, geometry) - (geometry.photoHeight * VORTEX_MAX_ASPECT) / 2
}

/**
 * 中心的那个细环（VortexCenter 唯一画的东西）。
 *
 * 它必须落在内半径之外 —— 中心是空的，环只是"接住"螺旋底部的一道极淡的记号，
 * 不是底座、不是柱体、不是发光体。
 */
export function centerRingRadii(
  count: number,
  geometry: VortexGeometry
): { inner: number; outer: number; y: number } {
  const radius = minRadiusOf(count, geometry)
  return {
    inner: radius - 0.025,
    outer: radius + 0.025,
    y: startHeightOf(count, geometry) - geometry.verticalGap * 0.5
  }
}

/* ============================ 2. 档位配置 ============================ */

export interface VortexPreset extends VortexGeometry {
  /** 环上照片数上限（手机砍掉三分之一：贴图与 draw call 都少一截） */
  count: number
  /** 相机垂直视场角（度） */
  fov: number
  /** 相纸白边（世界单位；照片高度按 1 算，所以 0.018 ≈ 1.8% 的边） */
  border: number
  /** 每张照片的随机倾斜上限（弧度）：让相纸像"放上去的"，不是"贴上去的" */
  tilt: number
  /** hover 放大（docs 要求 1.03~1.06，这里取中间偏保守） */
  hoverScale: number
  /** 自动旋转（弧度/秒）：目标是摄影展里的空间装置，不是旋转木马 */
  spin: number
  /** 拖拽边界（弧度，正负对称）—— 不允许自由飞行 / 上下乱转 */
  maxYaw: number
  maxPitch: number
  /** 是否允许上下拖拽（手机上关掉，只留左右） */
  allowPitch: boolean
  /** 相机到中心的距离，以及滚轮能推进拉远的区间 */
  cameraDistance: number
  minDistance: number
  maxDistance: number
  cameraHeight: number
  lookAtHeight: number
  /** 设备像素比上限（手机降到 1.5：瓶颈是填充率不是几何） */
  maxDpr: number
  antialias: boolean
  /** 贴图开始加载的时间错开（毫秒/张）：避免十几张 1280px 同时解码 */
  textureStagger: number
}

/**
 * 两档配置（桌面 / 手机）。所有"手感"常量都集中在这里，真机走查时只改这一处。
 *
 * 桌面：18 张 × 0.5 弧度 ≈ 1.4 圈，高度 7.8，相机距离 13 —— 一整条螺旋都在画面里。
 * 相机垂直视场角 38°，距离 13 时可视高度 ≈ 8.9，刚好兜住螺旋（含底部细环）。
 */
export const VORTEX_PRESETS: { readonly desktop: VortexPreset; readonly mobile: VortexPreset } = {
  desktop: {
    count: 18,
    fov: 38,
    angleStep: 0.5,
    radius: 3.3,
    radiusGrowth: 0.05,
    verticalGap: 0.46,
    photoHeight: 0.95,
    border: 0.018,
    tilt: 0.035,
    hoverScale: 1.05,
    // 0.04 弧度/秒 ≈ 一圈 157 秒。极慢，是这一页最重要的一个数字。
    spin: 0.04,
    maxYaw: 0.5,
    maxPitch: 0.18,
    allowPitch: true,
    cameraDistance: 13,
    minDistance: 9.5,
    maxDistance: 18,
    cameraHeight: 2.2,
    lookAtHeight: 0.1,
    maxDpr: 2,
    antialias: true,
    textureStagger: 70
  },
  mobile: {
    count: 12,
    fov: 45,
    angleStep: 0.55,
    radius: 1.9,
    radiusGrowth: 0.045,
    verticalGap: 0.36,
    photoHeight: 0.62,
    border: 0.012,
    tilt: 0.03,
    hoverScale: 1.04,
    spin: 0.032,
    maxYaw: 0.4,
    maxPitch: 0,
    allowPitch: false,
    cameraDistance: 10,
    minDistance: 7.5,
    maxDistance: 14,
    cameraHeight: 1.4,
    lookAtHeight: 0.1,
    maxDpr: 1.5,
    antialias: false,
    textureStagger: 90
  }
}

/** 手机判定：粗指针或窄视口。只在进入页面时判一次（不随窗口变化重排整条螺旋）。 */
export function isMobileViewport(input: { width: number; coarsePointer: boolean }): boolean {
  return input.coarsePointer || input.width < 768
}

export function presetFor(input: { width: number; coarsePointer: boolean }): VortexPreset {
  return isMobileViewport(input) ? VORTEX_PRESETS.mobile : VORTEX_PRESETS.desktop
}

/* ============================ 3. 选片（铁律：只用 usePhotos） ============================ */

/** 少于这个数就从 all 里按 order 补足 */
export const VORTEX_MIN_PHOTOS = 12

export interface VortexPickOptions {
  /** 下限：featured 不足时从 all 按 order 补到这个数（默认 12） */
  min?: number
  /** 上限：环上最多几张（默认取 12 与 min 的较大者；上限低于下限时以下限为准） */
  limit?: number
}

/**
 * 螺旋上的照片：**featured 优先，不足 min 张时从 all 按 order 补足**。
 *
 * - 返回的是 Photo 对象本身的引用（不复制、不重建对象），下标与交给查看器的数组一致；
 * - 不去重就补足是不行的：overrides 里 featured 的照片也在 all 里，重复会让同一张出现两次；
 * - featured 决定**选谁**，order 决定**排在螺旋的哪一段**：最终结果整体按 order 升序，
 *   螺旋因此是顺着时间往上盘的（而不是"精选在前、补位在后"的两段拼接）；
 * - 排序只作用在副本上（[...featured]），绝不就地 sort 调用方的数组。
 */
export function pickVortexPhotos(
  featured: readonly Photo[],
  all: readonly Photo[],
  options: VortexPickOptions = {}
): Photo[] {
  const min = Math.max(1, Math.floor(options.min ?? VORTEX_MIN_PHOTOS))
  const limit = Math.max(min, Math.floor(options.limit ?? Math.max(VORTEX_MIN_PHOTOS, min)))
  const byOrder = (a: Photo, b: Photo): number => a.order - b.order

  const picked = [...featured].sort(byOrder).slice(0, limit)
  if (picked.length < min) {
    const seen = new Set(picked.map((photo) => photo.id))
    for (const photo of [...all].sort(byOrder)) {
      if (picked.length >= min) break
      if (seen.has(photo.id)) continue
      seen.add(photo.id)
      picked.push(photo)
    }
  }
  return picked.sort(byOrder)
}

/* ============================ 4. 降级判定 ============================ */

export type VortexMode = 'scene' | 'fallback' | 'empty'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
export const COARSE_POINTER_QUERY = '(pointer: coarse)'

/**
 * 走 3D 还是走 2D 兜底。
 *
 * - 没有任何照片 → empty（页面自己渲染空状态）；
 * - prefers-reduced-motion → fallback：直接给出静态空间结构，不做长时间升空 / 持续旋转；
 * - WebGL 不可用或初始化失败 → fallback：绝不白屏，且仍然可以点开现有查看器。
 *
 * 这是一个纯函数，所以"该不该降级"这件事在没有浏览器的环境里也能断言。
 */
export function decideVortexMode(input: {
  photoCount: number
  webgl: boolean
  reducedMotion: boolean
}): VortexMode {
  if (input.photoCount <= 0) return 'empty'
  if (input.reducedMotion || !input.webgl) return 'fallback'
  return 'scene'
}

/** 探针式 WebGL 检测：只为回答"能不能画"，真场景由 VortexScene 自己建上下文。 */
export function detectWebGL(): boolean {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return false
    // 探针用完即弃：不主动丢掉上下文会白占浏览器的一个 WebGL 上下文名额
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches === true
}

/** 贴图到位多少张之后可以撤掉 loading 文案 */
export const VORTEX_READY_TEXTURES = 5

/**
 * 极简 loading 文案的撤除条件：
 *   出过第一帧，并且（贴图到位的张数够了，或者每一张都已经有结果）。
 *
 * 第二条是必要的：如果网络把贴图全打挂了，只看到位张数的话，这句文案会永远挂在那里。
 * settled 缺省时按 loaded 处理（调用方只需要传一个数也能用）。
 */
export function isVortexReady(input: {
  frames: number
  loaded: number
  total: number
  settled?: number
}): boolean {
  if (input.frames < 1) return false
  if (input.total <= 0) return true
  if (input.loaded >= Math.min(input.total, VORTEX_READY_TEXTURES)) return true
  return (input.settled ?? input.loaded) >= input.total
}

/* ============================ 5. 稳定随机（相纸的"随手摆放"） ============================ */

/** FNV-1a：由 id 派生稳定种子 —— 同一张照片每次进入 /experience 的倾斜都一样 */
export function hashSeed(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** 由种子 + 盐取 [0, 1) 的稳定伪随机值（只在摆照片时用一次，不进渲染循环） */
export function seedUnit(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  value ^= value >>> 15
  value = Math.imul(value, 0x2545f491)
  value ^= value >>> 13
  return (value >>> 0) / 0x100000000
}

/** 可访问名：描述 → 时间 + 场景 → id 兜底（永不为空），与站内其它图片保持一致 */
export function vortexLabel(photo: Photo): string {
  const description = photo.description?.trim()
  if (description) return description
  const time = timeLabel(photo.time)
  const scene = photo.scene ? SCENE_LABELS[photo.scene] : ''
  const composed = [time, scene].filter(Boolean).join(' ')
  return composed || '照片 ' + photo.id
}

/** '08:23'；非法或缺失的时间一律当作没有 */
function timeLabel(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
}

/* ============================ 6. 3D 场景的上下文（provide / inject） ============================ */

/**
 * three 的模块类型。用 typeof import(...) 而不是顶层 import，
 * 保证本文件在没有 three 运行时的环境里也能被加载。
 */
export type ThreeModule = typeof import('three')

/**
 * VortexScene（父）与 VortexPhoto / VortexCenter（子）之间的契约。
 *
 * 为什么用 provide/inject 而不是 props：three 的对象**绝不能**进 Vue 的深度响应式，
 * 这里一律用 shallowRef 传；子组件因此能各自持有"自己那张照片"的生命周期
 * （材质与贴图在子组件里创建、也在子组件里释放）。
 */
export interface VortexSceneContext {
  /** 动态 import 进来的 three（为 null 表示还没到 / 加载失败） */
  readonly three: ShallowRef<ThreeModule | null>
  /** 所有照片共用的 1×1 平面几何：显存里只有一份 */
  readonly unitPlane: ShallowRef<BufferGeometry | null>
  /** 相纸（白边）材质，共享 */
  readonly paperMaterial: ShallowRef<Material | null>
  /** 螺旋本身 —— 自动旋转转的就是它 */
  readonly spiral: ShallowRef<Group | null>
  /** 中心环挂的分组（跟着整个空间一起被拖拽） */
  readonly center: ShallowRef<Group | null>
  readonly loader: ShallowRef<TextureLoader | null>
  /** renderer.capabilities.getMaxAnisotropy()，贴图创建时读一次 */
  maxAnisotropy: number
  registerPhoto(object: Object3D, index: number): void
  unregisterPhoto(object: Object3D): void
  /** 一张贴图成功 / 失败 —— 用来驱动极简 loading 文案 */
  textureSettled(ok: boolean): void
}

export const VORTEX_SCENE_KEY: InjectionKey<VortexSceneContext> = Symbol('vortex-scene')

export function provideVortexScene(context: VortexSceneContext): void {
  provide(VORTEX_SCENE_KEY, context)
}

/** 只有 VortexScene 的子树里才拿得到；拿不到说明组件放错了地方（宁可报错，不要静默） */
export function useVortexScene(): VortexSceneContext {
  const context = inject(VORTEX_SCENE_KEY, null)
  if (!context) throw new Error('useVortexScene() 必须在 VortexScene 的子树里调用')
  return context
}

/* ============================ 7. 页面状态 ============================ */

export interface VortexState {
  /** 螺旋上的照片（featured 优先 + 补足），同时也是交给查看器的那个数组 */
  readonly photos: ComputedRef<Photo[]>
  readonly points: ComputedRef<VortexPoint[]>
  readonly mode: ComputedRef<VortexMode>
  readonly innerRadius: ComputedRef<number>
  readonly preset: VortexPreset
  readonly reducedMotion: Ref<boolean>
  readonly webgl: Ref<boolean>
}

function viewportWidth(): number {
  if (typeof window === 'undefined') return 1440
  return window.innerWidth || 1440
}

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COARSE_POINTER_QUERY).matches === true
}

/** 系统在会话中途切换"减少动态效果"时也要立刻降级 */
function watchReducedMotion(target: Ref<boolean>): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  const onChange = (event: MediaQueryListEvent): void => {
    target.value = event.matches === true
  }
  query.addEventListener?.('change', onChange)
  if (getCurrentScope()) onScopeDispose(() => query.removeEventListener?.('change', onChange))
}

/**
 * /experience 的页面状态。档位在进入页面时判一次并固定下来：
 * 中途换档意味着重排整条螺旋 + 重建贴图，代价远大于收益。
 */
export function useVortex(): VortexState {
  const source = usePhotos()
  const webgl = ref(detectWebGL())
  const reducedMotion = ref(prefersReducedMotion())
  watchReducedMotion(reducedMotion)

  const preset = presetFor({ width: viewportWidth(), coarsePointer: isCoarsePointer() })

  const photos = computed<Photo[]>(() =>
    pickVortexPhotos(source.featured.value, source.all.value, {
      min: Math.min(VORTEX_MIN_PHOTOS, preset.count),
      limit: preset.count
    })
  )
  const points = computed<VortexPoint[]>(() => buildSpiral(photos.value.length, preset))
  const innerRadius = computed<number>(() => innerRadiusOf(photos.value.length, preset))
  const mode = computed<VortexMode>(() =>
    decideVortexMode({
      photoCount: photos.value.length,
      webgl: webgl.value,
      reducedMotion: reducedMotion.value
    })
  )

  return { photos, points, mode, innerRadius, preset, reducedMotion, webgl }
}
