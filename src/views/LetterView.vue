<script setup lang="ts">
/**
 * 写给姐姐 Letter（docs/01 §7.12）—— 整条体验曲线的终点：
 *   婚礼 → 照片 → 故事 → 回忆 → 信
 *
 * 它是"手写信的网页版"，所以排版比全站任何一页都更克制：
 * - 窄栏：max-width: --w-text（34rem ≈ 34ch —— 中文一行正好 34 个字，最舒服的行长）；
 * - 大行高：--lh-letter（1.95）；段落之间留 --s-6；
 * - 栏居中（纸面感）、文字左对齐（可读性）；
 * - 整页缓慢淡入（--d-slow），段落按 120ms 错开出现；
 * - 正文一个字都不写死在组件里：全部来自 src/data/letter.json；
 * - 除了信、夹在信里的小照片、签名、一个安静的回首页链接，没有别的元素：
 *   没有按钮、没有标签、没有标题装饰，也没有查看器（这封信不是用来浏览照片的）。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import LazyImage from '@/components/common/LazyImage.vue'
import RevealOnScroll from '@/components/common/RevealOnScroll.vue'
import PageShell from '@/components/layout/PageShell.vue'
import { usePhotos } from '@/composables/usePhotos'
import letter from '@/data/letter.json'

const photos = usePhotos()

/**
 * 夹在信里的那张小照片：letter.photoId → 第一张照片 → 整块不渲染。
 * photoId 指向一张不存在的照片时也走回落，绝不因为一条手工数据写错就白屏。
 */
const letterPhoto = computed(() => {
  const pinned = letter.photoId ? photos.byId(letter.photoId) : undefined
  return pinned ?? photos.all.value[0] ?? null
})

/** 段落错开：每段 +120ms，最多错开 5 段（上限 600ms，不越过 docs/02 §7 的等待红线） */
function paragraphDelay(index: number): number {
  return Math.min(index, 5) * 120
}
</script>

<template>
  <PageShell title="写给姐姐">
    <article class="letter">
      <!-- 版面上没有标题：给辅助技术与搜索引擎留一个不占地方的名字 -->
      <h1 class="visually-hidden">写给姐姐</h1>

      <p class="letter__greeting">{{ letter.greeting }}</p>

      <RevealOnScroll
        v-for="(paragraph, i) in letter.paragraphs"
        :key="i"
        as="p"
        class="letter__paragraph"
        :delay="paragraphDelay(i)"
      >
        {{ paragraph }}
      </RevealOnScroll>

      <!-- 夹在信里的小照片：略微歪着、一圈纸边 -->
      <figure v-if="letterPhoto" class="letter__photo">
        <LazyImage :photo="letterPhoto" />
      </figure>

      <p class="letter__signature">{{ letter.signature }}</p>

      <p class="letter__back">
        <RouterLink class="letter__back-link" to="/">回到开始</RouterLink>
      </p>
    </article>
  </PageShell>
</template>

<style scoped>
.letter {
  max-width: var(--w-text);
  margin-inline: auto;
  padding-block: var(--s-16) var(--s-32);
  /* 整页缓慢淡入：这一页是慢慢展开的，不是"跳"出来的 */
  animation: letter-enter var(--d-slow) var(--e-out) both;
}

@keyframes letter-enter {
  from {
    opacity: 0;
  }
}

/* 称呼与正文用同一个尺度：信里没有"标题"这种层级 */
.letter__greeting,
.letter__paragraph {
  font-family: var(--f-serif);
  font-size: var(--t-body);
  letter-spacing: var(--ls-body);
  line-height: var(--lh-letter);
  color: var(--c-ink-soft);
}

.letter__greeting {
  margin-bottom: var(--s-8);
  color: var(--c-ink);
}

.letter__paragraph + .letter__paragraph {
  margin-top: var(--s-6);
}

/**
 * 夹在信里的小照片。
 * 白边用"padding + 纸色底"做（docs/01 §7.12），不用 box-shadow：
 * 纸色与页面底色一致，所以再加一道 1px 细线把纸边勾出来（全站只允许 1px 描边）。
 */
.letter__photo {
  width: min(20rem, 72%);
  margin: var(--s-16) auto var(--s-12);
  padding: var(--s-3);
  background-color: var(--c-bg);
  border: 1px solid var(--c-line);
  transform: rotate(-2deg);
}

/* 签名是全站唯一允许出现深酒红的地方之一（docs/02 §4.2、docs/01 §12） */
.letter__signature {
  margin-top: var(--s-16);
  font-family: var(--f-serif);
  font-size: var(--t-small);
  letter-spacing: var(--ls-body);
  line-height: var(--lh-body);
  color: var(--c-accent);
  text-align: right;
}

/* 页面底部唯一的交互：一个安静的文字链接，回首页 */
.letter__back {
  margin-top: var(--s-32);
  text-align: center;
}

.letter__back-link {
  font-family: var(--f-serif);
  font-size: var(--t-small);
  letter-spacing: var(--ls-body);
  color: var(--c-muted);
  border-bottom: 1px solid var(--c-line);
  padding-bottom: var(--s-1);
  transition:
    color var(--d-fast) var(--e-out),
    border-color var(--d-fast) var(--e-out);
}

.letter__back-link:hover {
  color: var(--c-ink-soft);
  border-color: var(--c-accent);
}

/* 桌面端把纸面留白再放开一点（窄栏不变，长段落依旧一行 34 字） */
@media (min-width: 768px) {
  .letter__photo {
    margin-block: var(--s-24) var(--s-16);
  }
}
</style>
