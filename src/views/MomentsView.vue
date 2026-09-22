<script setup lang="ts">
/**
 * 瞬间 —— 不一定最好看，但很真实（docs/01 §7.9）。
 *
 * 数据 = usePhotos().moments（overrides 里 "moment": true）。
 * 呈现刻意比 Gallery 更慢、更大、更少：一列大图，桌面端最多两列，
 * 行距 --s-24 起（普通网格的两倍），每张下面只有一行极小的时间 + 描述。
 *
 * 图片档位（docs/01 §9.2）：这一页的"更大"是版式节奏（行距、张数少），不是像素。
 * 桌面端两列时每张约 620px 宽，medium（长边 1280px）正好给到 2 倍屏；
 * preview 2048px 在 620px 的槽位上是 3.3 倍过采样，这一页又是全站图片最多的页面之一，
 * 所以用 medium 而不是 preview。点开全屏查看器时仍然加载 preview（查看器自己取 photo.src）。
 *
 * 那一行的取舍：
 *   时间与描述都有 → 时间 · 描述；
 *   只有时间       → 只渲染时间（绝不显示「暂无描述」）；
 *   两者都没有     → 整行不渲染。
 */
import { computed } from 'vue'
import PageShell from '@/components/layout/PageShell.vue'
import LazyImage from '@/components/common/LazyImage.vue'
import RevealOnScroll from '@/components/common/RevealOnScroll.vue'
import { usePhotos } from '@/composables/usePhotos'
import { usePhotoViewer } from '@/composables/usePhotoViewer'
import type { Photo } from '@/types/photo'

interface MomentItem {
  photo: Photo
  /** 在 moments 里的下标，必须与交给查看器的数组一致 */
  index: number
  /** '08:23'；没有时间就是空串 */
  time: string
  /** 人工描述；没有就是空串 */
  note: string
}

const photos = usePhotos()
const viewer = usePhotoViewer()

/** 列表与查看器共用同一个数组，下标天然对齐 */
const list = computed<Photo[]>(() => photos.moments.value)

/** '08:23' —— 非法或缺失的时间一律当作没有 */
function timeLabel(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
}

const items = computed<MomentItem[]>(() =>
  list.value.map((photo, index) => ({
    photo,
    index,
    time: timeLabel(photo.time),
    note: photo.description ?? ''
  }))
)

function open(index: number): void {
  viewer.open(list.value, index)
}
</script>

<template>
  <PageShell>
    <header class="moments__head">
      <h1 class="t-h1">瞬间</h1>
      <p class="t-caption">没人在看镜头的时候。</p>
      <p class="t-label moments__count">{{ items.length }} 张</p>
    </header>

    <p v-if="items.length === 0" class="moments__empty t-caption">这里还没有照片。</p>

    <div v-else class="moments">
      <RevealOnScroll
        v-for="item in items"
        :key="item.photo.id"
        as="figure"
        class="moment"
        :delay="(item.index % 6) * 80"
      >
        <button type="button" class="moment__hit" @click="open(item.index)">
          <LazyImage :photo="item.photo" size="medium" />
        </button>
        <figcaption v-if="item.time || item.note" class="moment__meta">
          <span v-if="item.time" class="moment__time t-label">{{ item.time }}</span>
          <span v-if="item.note" class="moment__note">{{ item.note }}</span>
        </figcaption>
      </RevealOnScroll>
    </div>
  </PageShell>
</template>

<style scoped>
.moments__head {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-top: var(--s-24);
  padding-bottom: var(--s-16);
}

.moments__count {
  margin-top: var(--s-3);
}

.moments {
  display: grid;
  grid-template-columns: 1fr;
  /* 更慢：行与行之间是普通网格的两倍 */
  gap: var(--s-24) var(--s-12);
  max-width: var(--w-wide);
  margin-inline: auto;
}

.moments__empty {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-block: var(--s-32);
}

.moment {
  margin: 0;
}

.moment__hit {
  display: block;
  width: 100%;
}

.moment__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--s-1) var(--s-3);
  margin-top: var(--s-3);
}

.moment__time {
  white-space: nowrap;
}

.moment__note {
  font-family: var(--f-serif);
  font-size: var(--t-small);
  line-height: 1.6;
  color: var(--c-muted);
}

@media (min-width: 768px) {
  .moments {
    grid-template-columns: 1fr 1fr;
    gap: var(--s-32) var(--s-16);
  }
}
</style>
