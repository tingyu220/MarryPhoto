<script setup lang="ts">
/**
 * 顶部导航（Wave 1-D）。docs/02 §6.1 + docs/01 §6.3。
 * - 纯文字，无 logo / 无图标 / 无背景色块；滚动后才允许极轻的模糊 + 半透明纸色
 * - 向下滚动隐藏、向上滚动出现（--d-fast）
 * - transparent=true（首页第一屏）：100vh 之内完全不可见，滚过之后淡入
 * - 当前路由用 --c-accent 的 1px 下划线表示，不加粗、不变色
 * - Letter 不出现在导航高亮里（它只在首页底部与页脚出现）
 * - 固定定位，高度由全局 --header-h 给出，PageShell 用它留出页面内边距
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import site from '@/data/site.json'

const props = withDefaults(defineProps<{ transparent?: boolean }>(), { transparent: false })

const route = useRoute()
const navItems = site.nav

/** 是否已经离开页面顶部（决定要不要出现模糊底） */
const scrolled = ref(false)
/** 是否正在向下滚动（决定隐藏） */
const goingDown = ref(false)
/** 是否已经滚过第一屏（transparent 模式专用） */
const pastHero = ref(false)

let lastY = 0
let threshold = 64

/** 从 tokens.scss 读一个长度 token，避免在 JS 里写魔法值 */
function tokenPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : fallback
}

function onScroll() {
  const y = window.scrollY || 0
  scrolled.value = y > 0
  pastHero.value = y > window.innerHeight
  if (y <= threshold) goingDown.value = false
  else if (y > lastY) goingDown.value = true
  else if (y < lastY) goingDown.value = false
  lastY = y
}

/** transparent 模式下第一屏完全不可见（连位移都不需要做） */
const belowHero = computed(() => props.transparent && !pastHero.value)

onMounted(() => {
  threshold = tokenPx('--s-16', 64)
  lastY = window.scrollY || 0
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})

/** Letter 是"走完整条路以后的终点"，不在导航里高亮（docs/02 §6.1 / §7.12） */
function isCurrent(to: string): boolean {
  return to !== '/letter' && route.path === to
}
</script>

<template>
  <header
    class="site-header"
    :class="{
      'is-hidden': goingDown,
      'is-scrolled': scrolled,
      'is-below-hero': belowHero
    }"
  >
    <nav class="site-header__nav" aria-label="主导航">
      <ul class="site-header__list">
        <li v-for="item in navItems" :key="item.to" class="site-header__item">
          <RouterLink
            class="site-header__link"
            :class="{ 'is-current': isCurrent(item.to) }"
            :to="item.to"
          >
            {{ item.label }}
          </RouterLink>
        </li>
      </ul>
    </nav>
  </header>
</template>

<style>
/* tokens.scss 已冻结，这里补唯一的布局契约：固定导航的高度。
   站点内任何页面（含首页自己挂的透明导航）都读同一个值。 */
:root {
  --header-h: calc(var(--s-12) + var(--s-4));
}

@media (max-width: 767px) {
  :root {
    --header-h: calc(var(--s-12) + var(--s-1));
  }
}
</style>

<style scoped>
.site-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-nav);
  display: flex;
  align-items: center;
  height: var(--header-h, calc(var(--s-12) + var(--s-4)));
  padding-inline: var(--pad-x);
  transition:
    transform var(--d-fast) var(--e-out),
    opacity var(--d-base) var(--e-out);
}

/* 半透明纸色：用伪元素控制透明度，避免整条导航一起变淡 */
.site-header::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--c-bg);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--d-fast) var(--e-out);
}

/* 全站唯一允许的模糊（docs/02 §6.1 / §10） */
.site-header.is-scrolled {
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.site-header.is-scrolled::before {
  opacity: 0.82;
}

.site-header.is-hidden {
  transform: translateY(-100%);
}

.site-header.is-below-hero {
  opacity: 0;
  pointer-events: none;
}

.site-header__nav {
  position: relative;
  z-index: 1;
  width: 100%;
  min-width: 0;
}

.site-header__list {
  display: flex;
  align-items: center;
  gap: var(--s-8);
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.site-header__list::-webkit-scrollbar {
  display: none;
}

.site-header__item {
  flex: 0 0 auto;
}

.site-header__link {
  display: inline-block;
  padding-block: var(--s-2);
  font-family: var(--f-sans);
  font-size: var(--t-small);
  letter-spacing: 0.05em;
  line-height: 1;
  color: var(--c-ink-soft);
  white-space: nowrap;
  transition: color var(--d-fast) var(--e-out);
}

.site-header__link:hover {
  color: var(--c-warm);
}

.site-header__link.is-current {
  text-decoration: underline;
  text-decoration-color: var(--c-accent);
  text-decoration-thickness: 1px;
  text-underline-offset: var(--s-1);
}

@media (max-width: 767px) {
  .site-header__list {
    gap: var(--s-6);
  }
}
</style>
