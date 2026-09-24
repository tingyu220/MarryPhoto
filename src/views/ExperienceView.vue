<script setup lang="ts">
/**
 * 影像馆 /experience —— Memory Vortex 原型（Phase 3）。
 *
 * 为什么这一页不用 PageShell：
 *   PageShell 会带上 SiteHeader + SiteFooter，而 SiteHeader 的文字色是
 *   --c-ink-soft（#3A3A3A）—— 这一页的底色接近黑（--c-veil），深灰字在上面基本看不见。
 *   PageShell 是全站骨架、这次不许改，所以这里自己给一个极简的深色页头，
 *   并**保证两个走得回去的入口**（全部照片 / 首页）始终在右上角。
 *   页脚也一并省掉：底部只留一行操作提示，把整个视口让给照片。
 *
 * 深色只限这一页（任务书 §7 明确允许 #080808~#111111）：这里用的是 tokens 里
 * 早就存在的观看态底色 --c-veil，没有新增任何色值，全站其它页面仍然是纸色。
 */
import { watchEffect } from 'vue'
import { RouterLink } from 'vue-router'
import MemoryVortex from '@/components/experience/MemoryVortex.vue'
import site from '@/data/site.json'

// PageShell 负责了其它页面的 document.title，这一页不用它，就自己写一次
watchEffect(() => {
  document.title = `影像馆 · ${site.name}`
})
</script>

<template>
  <div class="experience">
    <header class="experience__head">
      <h1 class="experience__title t-label">影像馆</h1>
      <nav class="experience__nav" aria-label="页面导航">
        <RouterLink class="experience__link" to="/gallery">全部照片</RouterLink>
        <RouterLink class="experience__link" to="/">首页</RouterLink>
      </nav>
    </header>

    <MemoryVortex />
  </div>
</template>

<style scoped>
.experience {
  /* 固定铺满视口：这一页是空间，不是文档流里的一个章节（页面本身不滚动） */
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: var(--c-veil);
  color: var(--c-veil-ink);
  animation: experience-in var(--d-base) var(--e-out) both;
}

@keyframes experience-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.experience__head {
  position: absolute;
  inset-inline: 0;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-6);
  padding: var(--s-6) var(--pad-x);
  pointer-events: none;
}

.experience__title {
  margin: 0;
  color: var(--c-veil-ink);
}

.experience__nav {
  display: flex;
  gap: var(--s-6);
  pointer-events: auto;
}

.experience__link {
  font-family: var(--f-sans);
  font-size: var(--t-small);
  letter-spacing: 0.05em;
  line-height: 1;
  color: var(--c-veil-muted);
  transition: color var(--d-fast) var(--e-out);
}

.experience__link:hover {
  color: var(--c-veil-ink);
}

.experience__link:focus-visible {
  outline: 1px solid var(--c-veil-ink);
  outline-offset: var(--s-1);
}
</style>
