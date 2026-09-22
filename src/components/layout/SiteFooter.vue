<script setup lang="ts">
/**
 * 页脚（Wave 1-D）。docs/02 §6.6：三行以内，无社交链接、无版权长文、无技术栈水印。
 * 站名 · 日期 + 信入口 · 一句文案。文案全部来自 src/data/site.json。
 */
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import site from '@/data/site.json'

/**
 * 已经站在那一页时，不再显示指向它的自链接 —— 一个指向当前页的链接
 * 对谁都没有用，在"写给姐姐"这种终点页上还会破坏安静。
 */
const route = useRoute()
const showLetterLink = computed(() => route?.path !== '/letter')
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <p class="site-footer__name">{{ site.name }}</p>
      <p class="site-footer__line">
        <time class="site-footer__date" :datetime="site.date">{{ site.dateDisplay }}</time>
        <template v-if="showLetterLink">
          <span class="site-footer__sep">·</span>
          <RouterLink class="site-footer__link" to="/letter">写给姐姐 →</RouterLink>
        </template>
      </p>
      <p class="site-footer__note">{{ site.footer }}</p>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  background: var(--c-bg-sunk);
  border-top: 1px solid var(--c-line);
}

.site-footer__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-12) var(--pad-x) var(--s-16);
  text-align: center;
}

.site-footer__name {
  font-family: var(--f-display);
  font-size: var(--t-small);
  letter-spacing: var(--ls-label);
  line-height: var(--lh-tight);
  color: var(--c-ink);
}

.site-footer__line {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--s-2);
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1.2;
  color: var(--c-muted);
}

.site-footer__sep {
  color: var(--c-faint);
}

.site-footer__link {
  font-family: var(--f-serif);
  font-size: var(--t-small);
  letter-spacing: var(--ls-body);
  color: var(--c-ink-soft);
  transition: color var(--d-fast) var(--e-out);
}

.site-footer__link:hover {
  color: var(--c-warm);
}

.site-footer__note {
  font-family: var(--f-serif);
  font-size: var(--t-caption);
  line-height: 1.6;
  color: var(--c-muted);
}
</style>
