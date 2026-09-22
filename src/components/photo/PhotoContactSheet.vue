<script setup lang="ts">
/**
 * 联系表 Contact Sheet（Wave 2-F，docs/01 §7.5）。
 *
 * 摄影师的看片方式：等宽正方形裁切网格 + 左上角三位序号，密度优先，用于"快速找图"。
 *
 * 冻结契约：
 * - 只接受一个 prop `photos`；数据一律由父级（GalleryView）传入，本组件绝不自己读 JSON，
 *   也不 import 其它浏览模式组件；
 * - 点击直接 `usePhotoViewer().open(props.photos, index)` —— 序号的下标就是查看器里的位置，
 *   所以 viewer 顶部的 "23 / 386" 与这里的 "023" 永远指向同一张照片。
 */
import { computed } from 'vue'
import type { Photo } from '@/types/photo'
import LazyImage from '@/components/common/LazyImage.vue'
import { usePhotoViewer } from '@/composables/usePhotoViewer'

const props = defineProps<{ photos: Photo[] }>()

const viewer = usePhotoViewer()

/** 序号 = 在 photos 数组里的下标 + 1，补零到 3 位（001、002 …）。超 999 张自然变 4 位，不截断。 */
function labelAt(index: number): string {
  return String(index + 1).padStart(3, '0')
}

/** 格子的可访问名：序号 + 描述，缺描述回落到 ID（图还没加载时也必须有个名字） */
function cellLabel(index: number, photo: Photo): string {
  const description = photo.description?.trim()
  return `${labelAt(index)} ${description && description.length > 0 ? description : `照片 ${photo.id}`}`
}

/**
 * 整批照片被换掉时重放一次淡入（筛选变化，docs/01 §7.4）。
 * key 用 id 拼出的字符串：值相同就不会重挂载，只有"这一批照片真的变了"才重放那 200ms。
 */
const signature = computed(() => props.photos.map((photo) => photo.id).join('|'))

function openAt(index: number): void {
  viewer.open(props.photos, index)
}
</script>

<template>
  <!--
    空结果的兜底文案（docs/02 §9）。正常情况下 Gallery 页面自己也会渲染空状态，
    这里的 <p> 只是保证"传进来空数组也不出空白 + 不报错"；
    「返回全部」的入口属于筛选器，不在本组件职责内。
  -->
  <ol v-if="photos.length > 0" :key="signature" class="sheet">
    <li v-for="(photo, index) in photos" :key="photo.id" class="sheet__cell">
      <button
        type="button"
        class="sheet__button"
        :aria-label="cellLabel(index, photo)"
        @click="openAt(index)"
      >
        <span class="sheet__frame">
          <LazyImage :photo="photo" size="thumb" object-fit="cover" />
        </span>
        <span class="sheet__index">{{ labelAt(index) }}</span>
      </button>
    </li>
  </ol>
  <p v-else class="sheet__empty">这一类别还没有照片</p>
</template>

<style scoped>
.sheet {
  display: grid;
  /* 移动端 3 列。间距极小但不为零 —— 密是联系表的特征 */
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-1);
  margin: 0;
  padding: 0;
  list-style: none;
  /* 一次性淡入 200ms：这是"快速找图"的视图，不做错开动画（docs/01 §7.5） */
  animation: sheet-in var(--d-fast) var(--e-out) both;
}

@keyframes sheet-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (min-width: 768px) {
  .sheet {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--s-2);
  }
}

@media (min-width: 1280px) {
  .sheet {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

/* 空状态：一行安静的字，不做卡片、不做插画 */
.sheet__empty {
  margin: 0;
  font-family: var(--f-serif);
  font-size: var(--t-small);
  line-height: var(--lh-body);
  color: var(--c-muted);
}

.sheet__cell {
  margin: 0;
  min-width: 0;
}

.sheet__button {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--r);
  background: none;
  color: inherit;
  cursor: pointer;
}

/*
 * 1:1 强制取景框：联系表要的是"找得到"，不是"好看"（docs/02 §5.3）。
 * 正方形由这一层决定，与照片本身的比例无关。
 */
.sheet__frame {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background-color: var(--c-bg-sunk);
}

/*
 * LazyImage 会把 photo.width / photo.height 写成内联 aspect-ratio（瀑布流需要它），
 * 这里把子组件拉满取景框：宽高都被确定后内联的 aspect-ratio 不再参与计算，
 * 内部 img 的 object-fit: cover 于是成为 1:1 中心裁切，而不是等比缩放后留白。
 */
.sheet__frame :deep(.lazy-image) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* 序号：mono / --t-label / --c-faint，水印级对比度，不抢图。DOM 中排在图片之后，靠绘制顺序压在图上 */
.sheet__index {
  position: absolute;
  top: var(--s-1);
  left: var(--s-1);
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1.2;
  color: var(--c-faint);
  pointer-events: none;
}

@media (min-width: 768px) {
  .sheet__index {
    top: var(--s-2);
    left: var(--s-2);
  }
}

/*
 * 悬停（仅桌面精细指针）：缩略图轻微放大 1.03，无边框、无阴影。
 * 选择器刻意写长：LazyImage 自带一条 (0,5,0) 的 hover 规则（最多 1.02），
 * 必须压过它，否则两层缩放会叠成 1.05。
 */
@media (hover: hover) and (pointer: fine) {
  .sheet .sheet__cell .sheet__button:hover .sheet__frame :deep(.lazy-image__img) {
    transform: scale(1.03);
  }
}
</style>
