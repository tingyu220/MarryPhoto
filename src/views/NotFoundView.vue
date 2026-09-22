<script setup lang="ts">
/**
 * 没有这一页（404 兜底）。
 *
 * 一行大字 + 一句安静的话 + 一个回首页的文字链接，如此而已：
 * 不放 404 大图、不放插画、不放卡通、不做自动跳转
 * （自动跳转会让用户以为原来的链接是对的，然后继续在错路上走）。
 */
import { RouterLink } from 'vue-router'
import PageShell from '@/components/layout/PageShell.vue'
</script>

<template>
  <PageShell title="没有这一页">
    <div class="not-found">
      <h1 class="not-found__title t-h1">没有这一页</h1>
      <p class="not-found__note">也许是链接写错了。</p>
      <p class="not-found__back">
        <RouterLink class="not-found__link" to="/">回到开始</RouterLink>
      </p>
    </div>
  </PageShell>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-6);
  min-height: 50vh;
  text-align: center;
}

.not-found__title {
  color: var(--c-ink);
}

.not-found__note {
  font-family: var(--f-serif);
  font-size: var(--t-body);
  letter-spacing: var(--ls-body);
  line-height: var(--lh-body);
  color: var(--c-muted);
}

.not-found__back {
  margin-top: var(--s-8);
}

.not-found__link {
  font-family: var(--f-serif);
  font-size: var(--t-small);
  letter-spacing: var(--ls-body);
  color: var(--c-ink);
  border-bottom: 1px solid var(--c-line);
  padding-bottom: var(--s-1);
  transition:
    color var(--d-fast) var(--e-out),
    border-color var(--d-fast) var(--e-out);
}

.not-found__link:hover {
  color: var(--c-ink-soft);
  border-color: var(--c-accent);
}
</style>
