<script setup lang="ts">
/**
 * 精选 —— 摄影画册式排版（docs/01 §7.2）。
 *
 * 两条硬规矩：
 * 1. **绝不使用统一网格**：全幅 / 双列错落 / 单张居中 / 横向留白交替出现，
 *    由下面的 PLAN 决定节奏，人工挑选的照片 >= 布局规律。
 * 2. 每 3~5 张插入一行小字（时间 · 场景），作为呼吸与节奏。
 *
 * 图片档位（docs/01 §9.2）：1440px 桌面下 full 是满幅出血、single 是整幅版心（≈1152px），
 * 两者都要 preview；pair / wide / offset 的实际宽度约 580~880px，用 medium（长边 1280px，
 * 恰好覆盖 2 倍屏），既不放大 480px 的缩略图，也不必为 900px 的槽位下载 2048px 的大图。
 *
 * 精选数量控制在 20~40 张：第一次打开网站的人不需要浏览几百张照片。
 */
import { computed } from 'vue'
import PageShell from '@/components/layout/PageShell.vue'
import LazyImage from '@/components/common/LazyImage.vue'
import RevealOnScroll from '@/components/common/RevealOnScroll.vue'
import { usePhotos } from '@/composables/usePhotos'
import { usePhotoViewer } from '@/composables/usePhotoViewer'
import { SCENE_LABELS } from '@/data/taxonomy'
import type { Photo } from '@/types/photo'

const MAX_FEATURED = 40
const NOTE_EVERY = 3

const photos = usePhotos()
const viewer = usePhotoViewer()

/** 精选列表（同时是查看器的数据源，index 必须与它一致） */
const list = computed(() => photos.featured.value.slice(0, MAX_FEATURED))

/** 版面节奏。size 决定这一块吃几张照片 */
const PLAN: { kind: string; size: number }[] = [
  { kind: 'full', size: 1 },
  { kind: 'pair', size: 2 },
  { kind: 'single', size: 1 },
  { kind: 'wide', size: 2 },
  { kind: 'offset', size: 2 },
  { kind: 'pair', size: 2 }
]

interface Block {
  kind: string
  photos: { photo: Photo; index: number }[]
  note?: string
}

function noteFor(photo: Photo | undefined): string {
  if (!photo) return ''
  const d = photo.time ? new Date(photo.time) : null
  const time = d && !Number.isNaN(d.getTime())
    ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    : ''
  const scene = photo.scene ? SCENE_LABELS[photo.scene] : ''
  return [time, scene].filter(Boolean).join(' · ')
}

const blocks = computed<Block[]>(() => {
  const out: Block[] = []
  const items = list.value
  let i = 0
  let planIndex = 0

  while (i < items.length) {
    const plan = PLAN[planIndex % PLAN.length]
    const chunk = items.slice(i, i + plan.size).map((photo, k) => ({ photo, index: i + k }))
    if (chunk.length === 0) break
    out.push({ kind: plan.kind, photos: chunk })
    i += chunk.length
    planIndex++

    // 每 NOTE_EVERY 块插一行小字，指向下一张照片的时间
    if (planIndex % NOTE_EVERY === 0 && i < items.length) {
      out.push({ kind: 'note', photos: [], note: noteFor(items[i]) })
    }
  }
  return out
})
</script>

<template>
  <PageShell>
    <header class="featured__head">
      <h1 class="t-h1">精选</h1>
      <p class="t-caption">从这一天里挑出来的 {{ list.length }} 张。</p>
    </header>

    <div v-if="!list.length" class="featured__empty">
      <p class="t-caption">还没有挑选照片。在 photos.overrides.json 里把 featured 设为 true 即可。</p>
    </div>

    <div v-else class="album">
      <template v-for="(block, bi) in blocks" :key="bi">
        <!-- 节奏：一行小字 -->
        <RevealOnScroll v-if="block.kind === 'note'" as="p" class="album__note t-label">
          {{ block.note }}
        </RevealOnScroll>

        <!-- 全幅 -->
        <RevealOnScroll v-else-if="block.kind === 'full'" as="figure" class="fb fb--full">
          <button type="button" class="fb__hit" @click="viewer.open(list, block.photos[0].index)">
            <LazyImage :photo="block.photos[0].photo" size="preview" />
          </button>
        </RevealOnScroll>

        <!-- 单张居中 -->
        <RevealOnScroll v-else-if="block.kind === 'single'" as="figure" class="fb fb--single">
          <button type="button" class="fb__hit" @click="viewer.open(list, block.photos[0].index)">
            <LazyImage :photo="block.photos[0].photo" size="preview" />
          </button>
        </RevealOnScroll>

        <!-- 双列 -->
        <div v-else-if="block.kind === 'pair'" class="fb fb--pair">
          <RevealOnScroll
            v-for="(item, k) in block.photos"
            :key="item.photo.id"
            as="figure"
            :delay="k * 80"
          >
            <button type="button" class="fb__hit" @click="viewer.open(list, item.index)">
              <LazyImage :photo="item.photo" size="medium" />
            </button>
          </RevealOnScroll>
        </div>

        <!-- 一大一小，横向占据整幅 -->
        <div v-else-if="block.kind === 'wide'" class="fb fb--wide">
          <RevealOnScroll
            v-for="(item, k) in block.photos"
            :key="item.photo.id"
            as="figure"
            :delay="k * 80"
          >
            <button type="button" class="fb__hit" @click="viewer.open(list, item.index)">
              <LazyImage :photo="item.photo" size="medium" />
            </button>
          </RevealOnScroll>
        </div>

        <!-- 错落：一张偏左、一张偏右下 -->
        <div v-else class="fb fb--offset">
          <RevealOnScroll
            v-for="(item, k) in block.photos"
            :key="item.photo.id"
            as="figure"
            :delay="k * 80"
          >
            <button type="button" class="fb__hit" @click="viewer.open(list, item.index)">
              <LazyImage :photo="item.photo" size="medium" />
            </button>
          </RevealOnScroll>
        </div>
      </template>
    </div>

    <footer class="featured__tail">
      <RouterLink class="featured__more" to="/gallery">看全部照片 →</RouterLink>
    </footer>
  </PageShell>
</template>

<style scoped>
.featured__head {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-top: var(--s-24);
  padding-bottom: var(--s-16);
}

.featured__empty {
  padding-block: var(--s-32);
  text-align: center;
}

.album {
  max-width: var(--w-wide);
  margin-inline: auto;
  padding-inline: var(--pad-x);
}

.fb {
  margin: 0 0 var(--s-24) 0;
}

.fb__hit {
  display: block;
  width: 100%;
}

/* 节奏小字：只有时间与场景，极小、低对比 */
.album__note {
  margin: var(--s-24) 0 var(--s-12);
  padding-left: var(--s-2);
}

/* ---------- 版面形态 ---------- */
.fb--full {
  /* 出血到视口两侧 */
  margin-inline: calc(var(--pad-x) * -1);
}

.fb--single {
  max-width: var(--w-page);
  margin-inline: auto;
}

.fb--pair {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--s-8) var(--s-6);
  align-items: end;
}

.fb--wide {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--s-8);
  align-items: end;
}

.fb--offset {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--s-8);
}

@media (min-width: 768px) {
  .fb--pair {
    grid-template-columns: 1fr 1fr;
  }

  /* 双列错落：第二张下移，形成画册的高低节奏 */
  .fb--pair > :last-child {
    margin-top: var(--s-16);
  }

  .fb--wide {
    grid-template-columns: 2.2fr 1fr;
  }

  .fb--offset {
    grid-template-columns: 5fr 6fr;
  }

  /* 错落：第一张偏上、第二张往右下走 */
  .fb--offset > :first-child {
    margin-top: 0;
  }

  .fb--offset > :last-child {
    margin-top: var(--s-32);
  }

  .fb {
    margin-bottom: var(--s-32);
  }
}

.featured__tail {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-block: var(--s-24) var(--s-32);
  text-align: center;
}

.featured__more {
  font-family: var(--f-serif);
  font-size: var(--t-small);
  color: var(--c-ink);
  border-bottom: 1px solid var(--c-line);
  padding-bottom: 2px;
}

.featured__more:hover {
  border-color: var(--c-accent);
}
</style>
