<script setup lang="ts">
/**
 * 首页 —— 负责建立情绪，而不是展示全部内容（docs/01 §7.1）。
 *
 * 情绪顺序：一张全屏照片 → 一句承诺 → 精选 → 三个入口 → 那封信。
 * 这一页是全站视觉的天花板：卡片感、按钮感、模板感都不允许出现。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import LazyImage from '@/components/common/LazyImage.vue'
import RevealOnScroll from '@/components/common/RevealOnScroll.vue'
import SiteHeader from '@/components/layout/SiteHeader.vue'
import SiteFooter from '@/components/layout/SiteFooter.vue'
import { usePhotos } from '@/composables/usePhotos'
import { usePhotoViewer } from '@/composables/usePhotoViewer'
import site from '@/data/site.json'

const photos = usePhotos()
const viewer = usePhotoViewer()

/** 首屏照片：site.heroPhotoId → 第一张精选 → 第一张照片 */
const heroPhoto = computed(() => {
  const pinned = site.heroPhotoId ? photos.byId(site.heroPhotoId) : undefined
  return pinned ?? photos.featured.value[0] ?? photos.all.value[0] ?? null
})

/** 精选横滑最多 12 张：不展示全部，留出"还想继续看"的余量 */
const stripPhotos = computed(() => photos.featured.value.slice(0, 12))

const entries = [
  { to: '/story', label: '这一天', note: '按时间，把婚礼当天讲一遍' },
  { to: '/gallery', label: '全部照片', note: '所有照片，四种看法' },
  { to: '/people', label: '人物', note: '只看某一个人' }
]

/** 每个入口配一张小缩略图（有就用，没有就留白，不占位不报错） */
const entryThumbs = computed(() =>
  entries.map((_, i) => photos.featured.value[i] ?? photos.all.value[i] ?? null)
)

/* ---- 首屏随滚动的淡出：只改一个 CSS 变量，不做视差 ---- */
const heroEl = ref<HTMLElement | null>(null)
let raf = 0
let reduced = false

function onScroll() {
  if (raf || reduced) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const h = window.innerHeight || 1
    const y = Math.min(1, Math.max(0, window.scrollY / h))
    // 淡出到最低 0.15，避免文字完全消失时画面突然发空
    heroEl.value?.style.setProperty('--hero-fade', String(1 - y * 0.85))
  })
}

onMounted(() => {
  reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (reduced) return
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <SiteHeader transparent />

  <main class="home">
    <!-- 第一屏：只放一张，禁止轮播 -->
    <section ref="heroEl" class="hero">
      <div class="hero__media">
        <LazyImage v-if="heroPhoto" :photo="heroPhoto" size="preview" eager fill />
      </div>
      <div class="hero__veil" aria-hidden="true" />

      <div class="hero__content">
        <h1 class="hero__title">{{ site.heroTitle }}</h1>
        <p class="hero__couple">{{ site.couple }}</p>
        <p class="hero__date">{{ site.dateDisplay }}</p>
      </div>

      <a class="hero__explore" href="#memories">Explore ↓</a>
    </section>

    <!-- 第二屏：一句承诺 -->
    <section id="memories" class="promise page-pad">
      <RevealOnScroll>
        <p v-for="line in site.secondScreen.lines" :key="line" class="promise__line">{{ line }}</p>
      </RevealOnScroll>
      <RevealOnScroll :delay="160">
        <RouterLink class="text-link" to="/featured">{{ site.secondScreen.cta }} →</RouterLink>
      </RevealOnScroll>
    </section>

    <!--
      影像馆入口（任务书 §45~§47）。
      位置刻意在"承诺"之后、精选之前：情绪顺序是 首页 → 影像馆 → 故事/照片/人物/瞬间 → 那封信。
      视觉沿用站内的文字链接（不用大按钮、不用发光、不做科技感），只用一句更安静的小字交代它是什么。
    -->
    <section class="theatre">
      <RevealOnScroll>
        <p class="theatre__note t-caption">换个方式看这一天</p>
        <RouterLink class="text-link theatre__link" to="/experience">进入影像馆 →</RouterLink>
      </RevealOnScroll>
    </section>

    <!-- 第三屏：精选横滑 -->
    <section v-if="stripPhotos.length" class="strip" aria-label="精选照片">
      <ul class="strip__list">
        <li v-for="(photo, i) in stripPhotos" :key="photo.id" class="strip__item">
          <button
            type="button"
            class="strip__button"
            :aria-label="'看第 ' + (i + 1) + ' 张精选照片'"
            @click="viewer.open(stripPhotos, i)"
          >
            <LazyImage :photo="photo" />
          </button>
        </li>
      </ul>
    </section>

    <!-- 第四屏：三个入口（文字 + 一个小缩略图，不是三列卡片） -->
    <section class="entries page-pad">
      <ul>
        <li v-for="(entry, i) in entries" :key="entry.to" class="entry">
          <RouterLink class="entry__link" :to="entry.to">
            <span class="entry__thumb">
              <LazyImage v-if="entryThumbs[i]" :photo="entryThumbs[i]" />
            </span>
            <span class="entry__text">
              <span class="entry__label">{{ entry.label }}</span>
              <span class="entry__note t-caption">{{ entry.note }}</span>
            </span>
            <span class="entry__arrow" aria-hidden="true">→</span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- 第五屏：那封信。它应该是走完整条路之后的终点 -->
    <section class="letter-entry">
      <RevealOnScroll>
        <RouterLink class="text-link text-link--quiet" to="/letter">最后，有一封信想给你 →</RouterLink>
      </RevealOnScroll>
    </section>
  </main>

  <SiteFooter />
</template>

<style scoped>
/* ---------- 第一屏 ---------- */
.hero {
  position: relative;
  height: 100dvh;
  min-height: 560px;
  overflow: hidden;
  background-color: var(--c-bg-sunk);
  --hero-fade: 1;
}

.hero__media {
  position: absolute;
  inset: 0;
  /* 极缓慢的呼吸感缩放：20s，不打扰 */
  animation: hero-breathe var(--d-breathe) linear forwards;
}

@keyframes hero-breathe {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.04);
  }
}

.hero__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(11, 11, 11, 0.3) 0%,
    rgba(11, 11, 11, 0.1) 32%,
    rgba(11, 11, 11, 0.18) 62%,
    rgba(11, 11, 11, 0.6) 100%
  );
}

.hero__content {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  padding-inline: var(--pad-x);
  text-align: center;
  color: var(--c-veil-ink);
  opacity: var(--hero-fade);
}

.hero__title {
  font-family: var(--f-display);
  font-size: var(--t-display);
  font-weight: 400;
  line-height: 1.05;
  letter-spacing: var(--ls-display);
  text-transform: uppercase;
  margin: 0;
  text-shadow: 0 1px 30px rgba(11, 11, 11, 0.35);
  animation: fade-in var(--d-slow) var(--e-out) both;
}

.hero__couple {
  margin-top: var(--s-6);
  font-family: var(--f-serif);
  font-size: clamp(1rem, 3.6vw, 1.375rem);
  letter-spacing: 0.14em;
  animation: fade-in var(--d-slow) var(--e-out) 200ms both;
}

.hero__date {
  margin-top: var(--s-3);
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  color: var(--c-veil-muted);
  animation: fade-in var(--d-slow) var(--e-out) 400ms both;
}

.hero__explore {
  position: absolute;
  left: 50%;
  bottom: var(--s-12);
  transform: translateX(-50%);
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  color: var(--c-veil-muted);
  animation: fade-in var(--d-slow) var(--e-out) 800ms both;
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
}

/* ---------- 第二屏 ---------- */
.promise {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-block: var(--s-32);
  text-align: center;
}

.promise__line {
  font-family: var(--f-serif);
  font-size: clamp(1.125rem, 3.4vw, 1.5rem);
  line-height: 2;
  color: var(--c-ink);
}

.promise .text-link {
  display: inline-block;
  margin-top: var(--s-12);
}

/* ---------- 影像馆入口 ---------- */

.theatre {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-block: var(--s-24) 0;
  text-align: center;
}

.theatre__note {
  margin-bottom: var(--s-4);
}

.theatre__link {
  font-size: var(--t-body);
}

/* ---------- 精选横滑 ---------- */
.strip {
  padding-block: var(--s-12) var(--s-24);
}

.strip__list {
  display: flex;
  gap: var(--s-4);
  overflow-x: auto;
  scroll-snap-type: x proximity;
  padding-inline: var(--pad-x);
  scrollbar-width: none;
}

.strip__list::-webkit-scrollbar {
  display: none;
}

.strip__item {
  flex: 0 0 auto;
  width: clamp(200px, 62vw, 420px);
  scroll-snap-align: center;
}

.strip__button {
  display: block;
  width: 100%;
}

/* ---------- 三个入口 ---------- */
.entries {
  max-width: var(--w-page);
  margin-inline: auto;
  padding-block: var(--s-24);
}

.entry + .entry {
  margin-top: var(--s-12);
}

.entry__link {
  display: flex;
  align-items: center;
  gap: var(--s-6);
}

.entry__thumb {
  flex: 0 0 auto;
  width: 88px;
  display: block;
}

.entry__text {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
}

.entry__label {
  font-family: var(--f-serif);
  font-size: var(--t-h2);
  letter-spacing: 0.02em;
}

.entry__arrow {
  margin-left: auto;
  color: var(--c-muted);
  transition: transform var(--d-fast) var(--e-out);
}

.entry__link:hover .entry__arrow {
  transform: translateX(4px);
}

/* ---------- 那封信 ---------- */
.letter-entry {
  padding-block: var(--s-32);
  text-align: center;
}

/* ---------- 文字按钮（全站通用样式，暂时就近定义） ---------- */
.text-link {
  font-family: var(--f-serif);
  font-size: var(--t-small);
  letter-spacing: 0.06em;
  color: var(--c-ink);
  border-bottom: 1px solid var(--c-line);
  padding-bottom: 2px;
  transition: border-color var(--d-fast) var(--e-out);
}

.text-link:hover {
  border-color: var(--c-accent);
}

.text-link--quiet {
  color: var(--c-muted);
}

@media (min-width: 768px) {
  .entry__thumb {
    width: 120px;
  }

  .entry + .entry {
    margin-top: var(--s-16);
  }
}
</style>
