<script setup lang="ts">
/**
 * VortexCenter —— 螺旋中心的那道细环。
 *
 * 中心是**空的**：这里只画一个水平细环，落在内半径之外（centerRingRadii 保证），
 * 用来"接住"螺旋底部，让人相信这是一个被围起来的空间，而不是一堆飘着的照片。
 *
 * 刻意不做的事：不做底座、不做柱体、不做发光体、不做文字/日期 ——
 * 那些都会把"照片是唯一主体"这件事抢走。环只有 1px 级别的宽度和 12% 的不透明度。
 */
import { onBeforeUnmount, watch } from 'vue'
import type { BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { centerRingRadii, useVortexScene, type VortexPreset } from '@/composables/useVortex'

const props = defineProps<{ preset: VortexPreset; count: number }>()

const ctx = useVortexScene()

let group: Group | null = null
let geometry: BufferGeometry | null = null
let material: MeshBasicMaterial | null = null
let disposed = false

function build(): void {
  const THREE = ctx.three.value
  const parent = ctx.center.value
  const paper = ctx.paperMaterial.value
  if (!THREE || !parent || !paper || group || disposed) return

  // 环的内外半径与高度都由纯函数给出：内边永远不会越过"中心镂空"的界限
  const ring = centerRingRadii(props.count, props.preset)
  geometry = new THREE.RingGeometry(ring.inner, ring.outer, 128)
  material = new THREE.MeshBasicMaterial({
    color: paperColor(),
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide
  })

  const mesh: Mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = ring.y

  group = new THREE.Group()
  group.add(mesh)
  parent.add(group)
}

/** 和相纸同色（--c-bg），这样环看起来是"纸的延伸"而不是一根发光的管子 */
function paperColor(): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return '#F5F2EC'
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim()
  return raw || '#F5F2EC'
}

watch([() => ctx.three.value, () => ctx.center.value], build, { immediate: true })

onBeforeUnmount(() => {
  disposed = true
  if (group) {
    group.parent?.remove(group)
    group.clear()
    group = null
  }
  geometry?.dispose()
  geometry = null
  material?.dispose()
  material = null
})
</script>

<script lang="ts">
import { defineComponent } from 'vue'

/** 没有 DOM */
export default defineComponent({
  name: 'VortexCenter',
  render: () => null
})
</script>
