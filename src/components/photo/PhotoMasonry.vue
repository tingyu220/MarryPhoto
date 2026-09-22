<script setup lang="ts">
/**
 * PhotoMasonry —— Gallery 的默认浏览模式（docs/01 §7.4 "全部照片"）。
 *
 * 职责只有三件事：把 photos 排成瀑布流、保持每张图的原始比例、点击时打开全屏查看器。
 * **不做**数据获取、**不做**筛选、**不做**视图切换 —— 那些属于 Gallery 页面。
 *
 * ---------------------------------------------------------------------------
 * 关于 CSS columns 的阅读顺序（知情地接受，而不是忽略）
 * ---------------------------------------------------------------------------
 * `columns` 是**竖向填充**的：浏览器先把第一列从上到下填满，再回头填第二列。
 * 因此 DOM 顺序（= props.photos 的下标顺序 = 拍摄时间顺序）与"从左到右、从上到下"
 * 的视觉阅读顺序**不一致**：视觉上的"第 3 张"往往对应 DOM 里的第 N 张。
 *
 * 这是本次主动做出的取舍，理由如下：
 *  1) 瀑布流里每张图没有序号、没有标题、没有图注，视觉上根本不存在
 *     "第 3 张 → 第 4 张"这样的显式序列，错位无法被察觉。
 *     反例是联系表（Contact Sheet）：那里每张图左上角标着 001/002，
 *     序号一旦与视觉顺序错位就立刻穿帮，所以那个模式用等宽网格 grid，
 *     **绝不允许**使用 columns。
 *  2) 想让视觉顺序与 DOM 顺序一致，只能靠 JS 测量每张图的高度再绝对定位 ——
 *     这正是 docs/01 §7.4 性能红线明令禁止的"滚动里做 JS 布局计算"，
 *     而且图片加载前后高度变化会造成重排 / CLS，代价远大于收益。
 *  3) 键盘 Tab 顺序 === DOM 顺序 === 时间顺序：用户按 Tab 会沿时间线推进，
 *     只在换列时视觉上"跳一下"，逻辑始终正确、可预测，不会漏掉或重复任何一张。
 *  4) 屏幕阅读器读到的同样是 DOM 顺序（即时间顺序），这是语义上最合理的一种顺序。
 *  5) 空 alt / 加载失败时的 ID 兜底都基于 DOM 顺序，与视觉顺序无关，互不干扰。
 *
 * 结论：接受错位。需要"顺序感 / 记住第几张"的场景交给联系表与时间线模式，
 * 而不是在这里用 JS 硬掰出一套视觉顺序。
 * ---------------------------------------------------------------------------
 */
import type { Photo } from '@/types/photo'
import LazyImage from '@/components/common/LazyImage.vue'
import RevealOnScroll from '@/components/common/RevealOnScroll.vue'
import { usePhotoViewer } from '@/composables/usePhotoViewer'

/** 冻结契约：唯一 prop。筛选 / 视图切换由上层 Gallery 负责。 */
const props = defineProps<{ photos: Photo[] }>()

const viewer = usePhotoViewer()

/**
 * 出场错开：同屏最多错开 6 项、每项 70ms（docs/02 §7 规定 60～80ms）。
 * 第 7 张之后从第一档重来 —— 错开只是"让同一屏不要整体一起进入"，
 * 不承担任何排队语义，所以用取模而不是 index * 70（后者会让长列表尾部等几秒）。
 */
function staggerDelay(index: number): number {
  return (index % 6) * 70
}

/** 点击第 index 张：把**整个**数组交给查看器，index 就是原数组下标（不重排、不切片）。 */
function openAt(index: number): void {
  viewer.open(props.photos, index)
}
</script>

<template>
  <div class="masonry">
    <!--
      空结果的兜底文案（docs/02 §9）。正常情况下 Gallery 页面自己会渲染空状态，
      这里的 <p> 只是保证"传进来空数组也不出空白 + 不报错"。
      「返回全部」的入口属于筛选器，不在本组件职责内。
    -->
    <p v-if="photos.length === 0" class="masonry__empty">这一类别还没有照片</p>

    <!--
      列项目是本组件自己的 div：break-inside: avoid 与列间距都落在它身上，
      不依赖"父组件 scoped 样式能否作用到子组件根节点"这件事。
      RevealOnScroll 只负责里面的淡入 + 上移。
    -->
    <div v-for="(photo, index) in photos" :key="photo.id" class="masonry__item">
      <RevealOnScroll :delay="staggerDelay(index)">
        <!--
          每张图是一个无样式的按钮热区（docs/02 §6.2 的例外之一）：
          键盘可聚焦、可回车触发，但视觉上只是一张照片。
          可访问名直接来自 LazyImage 的 img[alt]（永不为空），因此不另加 aria-label。
        -->
        <button type="button" class="masonry__button" @click="openAt(index)">
          <LazyImage :photo="photo" size="thumb" />
        </button>
      </RevealOnScroll>
    </div>
  </div>
</template>

<style scoped>
/*
 * 瀑布流 = CSS 多列。列数由媒体查询决定，**没有任何 JS 参与布局**，
 * 所以滚动时不会有任何测量 / 重排（docs/01 §7.4 性能红线）。
 * 移动端 2 列 → ≥768px 3 列 → ≥1280px 4 列。
 */
.masonry {
  columns: 2;
  column-gap: var(--s-3);
}

/*
 * 一张照片 = 一个列项目。break-inside: avoid 是瀑布流的成立条件：
 * 缺少它，一张竖图会被从中间劈到下一列。
 */
.masonry__item {
  break-inside: avoid;
  page-break-inside: avoid;
  -webkit-column-break-inside: avoid;
  /* 图片之间只有间距：没有边框、没有卡片、没有阴影（docs/02 §5.2） */
  margin-bottom: var(--s-3);
}

/* 照片直接贴在纸面上：清掉 button 的全部浏览器默认装饰，只留热区 */
.masonry__button {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--r);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* 键盘可达：1px accent 描边 + 2px offset（docs/02 §9），不用浏览器默认蓝框 */
.masonry__button:focus-visible {
  outline: 1px solid var(--c-accent);
  outline-offset: 2px;
}

/* hover 刻意不做任何事：LazyImage 已经在"桌面精细指针"下给出 ≤1.02 倍缩放，
   这里再加边框 / 阴影 / 浮层文字都会摧毁"照片是主角"。 */

.masonry__empty {
  margin: 0;
  font-family: var(--f-serif);
  font-size: var(--t-small);
  line-height: var(--lh-body);
  color: var(--c-muted);
}

@media (min-width: 768px) {
  .masonry {
    columns: 3;
    column-gap: var(--s-4);
  }

  .masonry__item {
    margin-bottom: var(--s-4);
  }
}

@media (min-width: 1280px) {
  .masonry {
    columns: 4;
  }
}

/* prefers-reduced-motion 的降级由 RevealOnScroll 与 styles/base.scss 统一处理，这里不重复。 */
</style>
