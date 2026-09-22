<script setup lang="ts">
/**
 * 页面外壳（Wave 1-D）：SiteHeader + main.page-pad + slot + SiteFooter。
 * - 固定导航不占文档流，因此 main 用 padding-top: var(--header-h) 留出高度，
 *   内容永远不会被导航遮住；hideHeader 时不加这段留白。
 * - 页面进入动效：opacity 0→1（--d-base，--e-out），由根元素的 CSS 动画完成，
 *   动画只改 opacity，不会给 fixed 的子元素制造新的包含块。
 * - title 用于文档标题（title · 站名）；不传时回落到路由 meta.title。
 *   它不负责渲染可见标题——页面自己的标题属于各视图。
 * - 需要首页透明导航的页面用 hideHeader + 自己挂 <SiteHeader transparent />。
 */
import { computed, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import SiteHeader from '@/components/layout/SiteHeader.vue'
import SiteFooter from '@/components/layout/SiteFooter.vue'
import site from '@/data/site.json'

const props = withDefaults(defineProps<{ title?: string; hideHeader?: boolean }>(), {
  title: undefined,
  hideHeader: false
})

const route = useRoute()
const pageTitle = computed(() => {
  if (props.title) return props.title
  const meta = route.meta.title
  return typeof meta === 'string' ? meta : ''
})

watchEffect(() => {
  document.title = pageTitle.value ? `${pageTitle.value} · ${site.name}` : site.name
})
</script>

<template>
  <div class="page-shell" :class="{ 'page-shell--no-header': hideHeader }">
    <SiteHeader v-if="!hideHeader" />
    <main class="page-pad page-shell__main">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.page-shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  animation: page-enter var(--d-base) var(--e-out) both;
}

.page-shell__main {
  flex: 1 1 auto;
  /* 固定导航的高度；--header-h 由 SiteHeader.vue 定义 */
  padding-top: var(--header-h, calc(var(--s-12) + var(--s-4)));
  padding-bottom: var(--s-16);
}

.page-shell--no-header .page-shell__main {
  padding-top: 0;
}

@keyframes page-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
