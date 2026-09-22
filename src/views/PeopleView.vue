<script setup lang="ts">
/**
 * 人物 —— 按人看（docs/01 §7.8）。
 *
 * 人名表只有一处：taxonomy 的 PEOPLE / PEOPLE_LABELS（本文件不重写人名）。
 * 照片与张数只有一处：usePhotos().byPerson()。
 * 本页不做任何筛选 —— 点一个人就把 ?p=<id> 交给 /gallery，筛选逻辑由 useFilters 负责。
 *
 * 呈现是**一列条目**，不是卡片墙：圆形头像 + 姓名 + 张数，靠间距与 1px 细线分组，
 * 没有卡片、没有边框、没有阴影。圆形取景框是全站唯一被允许的圆角
 * （docs/02 §3：--r 的唯一例外）。
 */
import { computed } from 'vue'
import PageShell from '@/components/layout/PageShell.vue'
import LazyImage from '@/components/common/LazyImage.vue'
import { usePhotos } from '@/composables/usePhotos'
import { PEOPLE, PEOPLE_LABELS } from '@/data/taxonomy'
import type { PersonId, Photo } from '@/types/photo'

interface PersonEntry {
  id: PersonId
  label: string
  count: number
  /** 头像：该人物的第一张照片（byPerson 返回的数组已按 order 升序） */
  cover: Photo
}

const photos = usePhotos()

/** 顺序沿用 taxonomy.PEOPLE（主要人物在前）；一张照片都没有的人不显示 */
const entries = computed<PersonEntry[]>(() =>
  PEOPLE.flatMap((id): PersonEntry[] => {
    const list = photos.byPerson(id)
    if (list.length === 0) return []
    return [{ id, label: PEOPLE_LABELS[id], count: list.length, cover: list[0] }]
  })
)
</script>

<template>
  <PageShell>
    <header class="people__head">
      <h1 class="t-h1">人物</h1>
      <p class="t-caption">按人看。人工标的，可能会漏。</p>
    </header>

    <p v-if="entries.length === 0" class="people__empty t-caption">还没有标注人物的照片。</p>

    <ul v-else class="people">
      <li v-for="entry in entries" :key="entry.id" class="people__item">
        <RouterLink class="person" :to="{ path: '/gallery', query: { p: entry.id } }">
          <span class="person__avatar">
            <LazyImage :photo="entry.cover" :alt="entry.label + '的照片'" fill />
          </span>
          <span class="person__name">{{ entry.label }}</span>
          <span class="person__count">{{ entry.count }} 张</span>
        </RouterLink>
      </li>
    </ul>
  </PageShell>
</template>

<style scoped>
.people__head {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-top: var(--s-24);
  padding-bottom: var(--s-16);
}

.people {
  max-width: var(--w-page);
  margin-inline: auto;
}

/* 分组靠一条 1px 细线，不画卡片 */
.people__item {
  border-top: 1px solid var(--c-line);
}

.people__item:last-child {
  border-bottom: 1px solid var(--c-line);
}

.person {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--s-4) var(--s-6);
  padding-block: var(--s-4);
  color: var(--c-ink);
}

/* 全站唯一的圆角：圆形人物头像取景框 */
.person__avatar {
  display: block;
  width: var(--s-12);
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 50%;
  background-color: var(--c-bg-sunk);
}

.person__name {
  font-family: var(--f-serif);
  font-size: var(--t-h2);
  letter-spacing: 0.02em;
  line-height: 1.3;
  transition: color var(--d-fast) var(--e-out);
}

.person:hover .person__name {
  color: var(--c-warm);
}

.person__count {
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1.2;
  color: var(--c-muted);
  white-space: nowrap;
}

.people__empty {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-block: var(--s-32);
}

@media (min-width: 768px) {
  .person {
    gap: var(--s-8);
    padding-block: var(--s-6);
  }

  .person__avatar {
    width: var(--s-16);
  }
}
</style>
