<script setup lang="ts">
/**
 * VortexPhoto —— 螺旋上的一张照片（相纸 + 照片本体，两个 mesh）。
 *
 * 这个组件**不渲染任何 DOM**：它存在的意义是"让每张照片有自己的生命周期" ——
 * 自己的材质、自己的贴图，在挂载时创建、在卸载时释放。反复进出 /experience 时，
 * GPU 上不会留下任何一张没被释放的贴图（任务书 §12）。
 *
 * 逐帧的旋转 / 缩放由 VortexScene 直接改这里建出来的对象属性，不经过 Vue 的响应式；
 * 属性只在"要不要开始加载贴图"这一件事上被 watch 一次，不是每帧。
 *
 * 视觉（任务书 §7）：真实相纸 —— 轻微白边 + 极轻微厚度 + 轻微随机旋转。
 * 没有卡片、没有圆角、没有阴影贴图、没有玻璃质感、没有发光边框。
 * 照片用 MeshBasicMaterial（不受光）：颜色就是照片本身的颜色，不会被打光打成塑料。
 * 这里刻意不做阴影板：这一页的底色接近黑，黑色阴影在黑底上什么也看不见。
 */
import { onBeforeUnmount, watch } from 'vue'
import type { Group, MeshBasicMaterial, Texture } from 'three'
import type { Photo } from '@/types/photo'
import {
  hashSeed,
  photoWidthOf,
  seedUnit,
  useVortexScene,
  type VortexPoint,
  type VortexPreset
} from '@/composables/useVortex'

const props = defineProps<{
  photo: Photo
  point: VortexPoint
  preset: VortexPreset
  /** 在螺旋上的下标（同时也是交给查看器时的下标） */
  index: number
}>()

const ctx = useVortexScene()

let group: Group | null = null
let material: MeshBasicMaterial | null = null
let texture: Texture | null = null
let timer = 0
let disposed = false

function build(): void {
  const THREE = ctx.three.value
  const parent = ctx.spiral.value
  const plane = ctx.unitPlane.value
  const paper = ctx.paperMaterial.value
  if (!THREE || !parent || !plane || !paper || group || disposed) return

  const { photo, point, preset, index } = props
  const width = photoWidthOf(photo, preset)
  const height = preset.photoHeight
  const seed = hashSeed(photo.id)

  group = new THREE.Group()
  group.position.set(point.x, point.y, point.z)
  // 面朝外（背离中心轴）
  group.rotation.y = point.rotationY
  // 轻微随机倾斜：相纸像是被人随手放上去的，不是机器贴上去的。
  // 用 id 派生的稳定种子，所以同一张照片每次进入的倾斜都一样，不会闪。
  group.rotation.x = (seedUnit(seed, 0) - 0.5) * 2 * preset.tilt
  group.rotation.z = (seedUnit(seed, 1) - 0.5) * 2 * preset.tilt
  // 绕自身竖轴的极小偏转：相纸不是严格切向的，能看出"摆"的痕迹
  group.rotation.y += (seedUnit(seed, 2) - 0.5) * 2 * preset.tilt * 0.8
  // 位置刻意不加抖动：逐帧循环每帧都会把 position 写回螺旋上的基准点
  // （抖动留在 rotation 上，视觉上一样是"随手摆放"，而且不会和逐帧打架）

  // 白边：一块比照片略大的相纸，几何是共享的 1×1 平面，尺寸靠 scale 表达
  const paperMesh = new THREE.Mesh(plane, paper)
  paperMesh.scale.set(width + preset.border * 2, height + preset.border * 2, 1)
  paperMesh.userData.vortexIndex = index
  group.add(paperMesh)

  // 照片本体：贴图还没到之前显示这张照片的主色（和站内 LazyImage 的占位思路一致，不白闪）
  material = new THREE.MeshBasicMaterial({ color: photo.color || '#2A2A2A' })
  const photoMesh = new THREE.Mesh(plane, material)
  photoMesh.scale.set(width, height, 1)
  // 极轻微厚度：4‰ 的偏移，斜看时能看到相纸的边
  photoMesh.position.z = 0.004
  photoMesh.userData.vortexIndex = index
  group.add(photoMesh)

  parent.add(group)
  ctx.registerPhoto(group, index)
  scheduleLoad()
}

/**
 * 贴图加载。
 *
 * 铁律：**只用 medium（长边 1280px）**。GPU 解码后的占用与文件大小无关，
 * 把两三千像素宽的图搬进显存，一张就是几十 MB —— 十几张就能让中端手机崩掉。
 *
 * 按 index 错开起始时间，避免十几张 1280px 同时解码（移动端最怕这个尖峰）。
 */
function scheduleLoad(): void {
  timer = window.setTimeout(() => {
    timer = 0
    if (disposed) return
    const THREE = ctx.three.value
    const loader = ctx.loader.value
    if (!THREE || !loader) {
      ctx.textureSettled(false)
      return
    }
    loader.load(
      props.photo.medium,
      (loaded) => {
        if (disposed) {
          // 组件已经卸载：这张贴图不能留在 GPU 上
          loaded.dispose()
          return
        }
        loaded.colorSpace = THREE.SRGBColorSpace
        loaded.anisotropy = ctx.maxAnisotropy
        loaded.minFilter = THREE.LinearMipmapLinearFilter
        loaded.generateMipmaps = true
        texture = loaded
        if (material) {
          material.map = loaded
          material.color.set('#FFFFFF')
          // 第一次挂上 map 必须让材质重编译
          material.needsUpdate = true
        }
        ctx.textureSettled(true)
      },
      undefined,
      () => {
        // 单张失败不影响整页：保留主色，故事继续
        ctx.textureSettled(false)
      }
    )
  }, props.index * props.preset.textureStagger)
}

// 两个 ref 都由父组件在 onMounted 里填：等它们同时就绪再建自己的对象
watch([() => ctx.three.value, () => ctx.spiral.value], build, { immediate: true })

onBeforeUnmount(() => {
  disposed = true
  if (timer) {
    clearTimeout(timer)
    timer = 0
  }
  if (group) {
    ctx.unregisterPhoto(group)
    group.parent?.remove(group)
    group.clear()
    group = null
  }
  // 每张照片自己的材质与贴图：必须在这里释放，父组件不知道它们的存在
  material?.dispose()
  material = null
  texture?.dispose()
  texture = null
  // 共享的平面几何与相纸材质由 VortexScene 释放，这里绝不能碰
})
</script>

<script lang="ts">
import { defineComponent } from 'vue'

/** 没有 DOM：这个组件只是 three 对象的一个生命周期容器 */
export default defineComponent({
  name: 'VortexPhoto',
  render: () => null
})
</script>
