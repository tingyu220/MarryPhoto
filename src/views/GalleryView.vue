<script setup lang="ts">
/**
 * 全部照片 —— 同一批照片的四种看法（docs/01 §6.2、§7.4~§7.7）。
 *
 * 关键约束：四种模式看的是**同一份数据**，筛选条件进 URL，
 * 切换模式不重新取数、不重置滚动位置。
 */
import { computed } from 'vue'
import PageShell from '@/components/layout/PageShell.vue'
import PhotoMasonry from '@/components/photo/PhotoMasonry.vue'
import PhotoContactSheet from '@/components/photo/PhotoContactSheet.vue'
import PhotoFilm from '@/components/photo/PhotoFilm.vue'
import PhotoTimeline from '@/components/photo/PhotoTimeline.vue'
import { useFilters } from '@/composables/useFilters'
import { GALLERY_VIEWS } from '@/data/taxonomy'

const {
  view,
  filterId,
  filtered,
  filterOptions,
  setView,
  setFilter,
  reset
} = useFilters()

const MODES = {
  masonry: PhotoMasonry,
  contact: PhotoContactSheet,
  film: PhotoFilm,
  timeline: PhotoTimeline
} as const

const activeComponent = computed(() => MODES[view.value] ?? PhotoMasonry)
const total = computed(() => filtered.value.length)

/** 筛选行只显示有照片的分类，但"全部"永远在第一个 */
const visibleFilters = computed(() => filterOptions.filter((f) => f.id === 'all' || f.count > 0))
const hasFilter = computed(() => filterId.value !== 'all')
</script>

<template>
  <PageShell>
    <header class="gallery__head">
      <h1 class="t-h1">全部照片</h1>
      <p class="t-label gallery__count">{{ total }} 张</p>
    </header>

    <!-- 筛选：一行文字，选中加下划线。不用胶囊标签、不用下拉框 -->
    <nav class="filters" aria-label="照片分类">
      <button
        v-for="f in visibleFilters"
        :key="f.id"
        type="button"
        class="filters__item"
        :class="{ 'is-current': f.id === filterId }"
        :aria-current="f.id === filterId ? 'true' : undefined"
        @click="setFilter(f.id)"
      >
        {{ f.label }}
      </button>
    </nav>

    <!-- 视图切换：同一批照片的四种看法 -->
    <nav class="modes" aria-label="浏览方式">
      <button
        v-for="m in GALLERY_VIEWS"
        :key="m.id"
        type="button"
        class="modes__item"
        :class="{ 'is-current': m.id === view }"
        :aria-current="m.id === view ? 'true' : undefined"
        @click="setView(m.id)"
      >
        {{ m.label }}
      </button>
    </nav>

    <!-- 空状态：筛选后没有照片时，只显示一行安静的文字 -->
    <div v-if="total === 0" class="gallery__empty">
      <p class="t-caption">这一类还没有照片。</p>
      <button v-if="hasFilter" type="button" class="gallery__reset" @click="reset()">看全部</button>
    </div>

    <!-- 四种模式共享同一份 filtered，互不 import -->
    <component :is="activeComponent" v-else :photos="filtered" />
  </PageShell>
</template>

<style scoped>
.gallery__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-4);
  padding-top: var(--s-16);
}

.gallery__count {
  white-space: nowrap;
}

.gallery__empty {
  padding-block: var(--s-32);
  text-align: center;
}

.gallery__reset {
  margin-top: var(--s-6);
  font-family: var(--f-serif);
  font-size: var(--t-small);
  color: var(--c-ink);
  border-bottom: 1px solid var(--c-line);
}

.filters,
.modes {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--s-6);
  margin-top: var(--s-8);
}

.modes {
  margin-top: var(--s-4);
  padding-bottom: var(--s-3);
  border-bottom: 1px solid var(--c-line);
}

.filters__item,
.modes__item {
  font-family: var(--f-serif);
  font-size: var(--t-small);
  letter-spacing: 0.05em;
  color: var(--c-muted);
  padding-bottom: 2px;
  border-bottom: 1px solid transparent;
  transition: color var(--d-fast) var(--e-out), border-color var(--d-fast) var(--e-out);
}

.filters__item.is-current,
.modes__item.is-current {
  color: var(--c-ink);
  border-bottom-color: var(--c-accent);
}

.modes__item {
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
}

/* 移动端也保持一行可横滑，不换行成两排 */
@media (max-width: 600px) {
  .filters {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .filters::-webkit-scrollbar {
    display: none;
  }

  .filters__item {
    flex: 0 0 auto;
  }
}
</style>
