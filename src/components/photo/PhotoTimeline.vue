<script setup lang="ts">
/**
 * 时间线 Timeline（Wave 2-H）—— docs/01 §7.7、docs/02 §5/§6/§7。
 *
 * 「完整时间记录」：只呈现时间、数量、缩略图，不写散文（那是 Story 的职责）。
 * 数据一律由父级通过 props 传入，本组件不读 JSON、不 import 其它浏览模式。
 *
 * 分组规则（一次算清，模板里不做嵌套计算）：
 *   - 同一「天 + 小时」的照片归为一组，按最早时刻升序；
 *   - time 为 null（或非法）的照片归入最后一组「时间未知」，绝不丢弃；
 *   - 每张照片都带着它在 props.photos 里的原始下标，展开/折叠都不改变它，
 *     点击时把它交给 usePhotoViewer().open(props.photos, index)。
 */
import { computed, ref } from 'vue'
import type { Photo } from '@/types/photo'
import LazyImage from '@/components/common/LazyImage.vue'
import { usePhotoViewer } from '@/composables/usePhotoViewer'

/** 冻结契约：只有这一个 prop */
const props = defineProps<{ photos: Photo[] }>()

/** 一组默认显示的张数，超出的折叠成「+N」（docs/01 §7.7「可展开」） */
const COLLAPSED_COUNT = 6

/** 时间未知的那一组 */
const UNKNOWN_KEY = 'time-unknown'
const UNKNOWN_LABEL = '时间未知'

interface TimelineItem {
  photo: Photo
  /** 在 props.photos 中的原始下标 —— 唯一的位置真相 */
  index: number
}

interface TimelineGroup {
  /** 同一天同一小时：'2026-09-16 08'；时间未知组为 'time-unknown' */
  key: string
  /** 组内最早的拍摄时刻 '08:23'；时间未知组为 null */
  time: string | null
  /** '08 点' / '时间未知' */
  hourLabel: string
  /** '08 点 · 12 张' */
  caption: string
  /** 升序排序用（毫秒时间戳），不进模板 */
  startsAt: number
  items: TimelineItem[]
}

const viewer = usePhotoViewer()

/** 展开状态：按组 key 记住，与下标无关 */
const expanded = ref<Record<string, boolean>>({})

function pad2(value: number): string {
  return value < 10 ? '0' + value : String(value)
}

/** EXIF 时间 → Date；null 或非法值统一返回 null（不抛异常） */
function parseTime(iso: string | null): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatTime(date: Date): string {
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
}

/**
 * 分组：整个列表只遍历一次，结果（含每组的 caption 与每张照片的原始下标）一次算好。
 * 模板只负责渲染 groups，不在循环里做任何分组/排序计算。
 */
const groups = computed<TimelineGroup[]>(() => {
  const byHour = new Map<string, TimelineGroup>()
  const unknown: TimelineGroup = {
    key: UNKNOWN_KEY,
    time: null,
    hourLabel: UNKNOWN_LABEL,
    caption: '',
    startsAt: 0,
    items: []
  }

  props.photos.forEach((photo, index) => {
    const item: TimelineItem = { photo, index }
    const date = parseTime(photo.time)
    if (!date) {
      unknown.items.push(item)
      return
    }
    const key =
      date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours())
    let group = byHour.get(key)
    if (!group) {
      group = {
        key,
        time: formatTime(date),
        hourLabel: pad2(date.getHours()) + ' 点',
        caption: '',
        startsAt: date.getTime(),
        items: []
      }
      byHour.set(key, group)
    }
    if (date.getTime() < group.startsAt) {
      group.startsAt = date.getTime()
      group.time = formatTime(date)
    }
    group.items.push(item)
  })

  const ordered = [...byHour.values()].sort((a, b) => a.startsAt - b.startsAt)
  // 时间未知的一组永远排在最后，且只在真的有照片时才出现
  if (unknown.items.length > 0) ordered.push(unknown)
  // 计数在这里一次算好（模板里不再拼接字符串）
  return ordered.map((group) => ({ ...group, caption: group.hourLabel + ' · ' + group.items.length + ' 张' }))
})

function isExpanded(key: string): boolean {
  return expanded.value[key] === true
}

function toggle(key: string): void {
  expanded.value[key] = expanded.value[key] !== true
}

/** 折叠时只渲染前 6 张；展开后渲染整组。下标来自 item.index，因此始终保真。 */
function visibleItems(group: TimelineGroup): TimelineItem[] {
  return isExpanded(group.key) ? group.items : group.items.slice(0, COLLAPSED_COUNT)
}

function hiddenCount(group: TimelineGroup): number {
  return Math.max(0, group.items.length - COLLAPSED_COUNT)
}

/** 缩略图按钮的无障碍名称：图片未加载时按钮也必须有名有姓 */
function thumbLabel(item: TimelineItem): string {
  const date = parseTime(item.photo.time)
  return '查看第 ' + (item.index + 1) + ' 张 · ' + (date ? formatTime(date) : UNKNOWN_LABEL)
}

function toggleLabel(group: TimelineGroup): string {
  if (isExpanded(group.key)) return '收起' + group.hourLabel + '的照片'
  return '展开' + group.hourLabel + '其余 ' + hiddenCount(group) + ' 张'
}

/** index 必须是原数组下标 */
function openAt(index: number): void {
  viewer.open(props.photos, index)
}
</script>

<template>
  <section class="timeline" :data-count="photos.length">
    <p v-if="groups.length === 0" class="timeline__empty">这一天还没有照片</p>

    <ol v-else class="timeline__list">
      <li
        v-for="group in groups"
        :key="group.key"
        class="timeline__group"
        :data-group="group.key"
        :data-count="group.items.length"
      >
        <span class="timeline__mark" aria-hidden="true"></span>
        <p class="timeline__time">{{ group.time ?? '—' }}</p>

        <div class="timeline__thumbs">
          <button
            v-for="item in visibleItems(group)"
            :key="item.photo.id"
            type="button"
            class="timeline__thumb"
            :data-index="item.index"
            :aria-label="thumbLabel(item)"
            @click="openAt(item.index)"
          >
            <LazyImage :photo="item.photo" size="thumb" />
          </button>
        </div>

        <div class="timeline__foot">
          <p class="timeline__caption">{{ group.caption }}</p>
          <button
            v-if="hiddenCount(group) > 0"
            type="button"
            class="timeline__toggle"
            :aria-expanded="isExpanded(group.key)"
            :aria-label="toggleLabel(group)"
            @click="toggle(group.key)"
          >
            {{ isExpanded(group.key) ? '收起' : '+' + hiddenCount(group) }}
          </button>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.timeline {
  /* 缩略图统一宽度，高度由 LazyImage 按原始比例撑开（docs/02 §5.3 列表图保持原始比例） */
  --timeline-thumb-w: var(--s-24);
  max-width: var(--w-page);
}

.timeline__empty {
  margin: 0;
  font-family: var(--f-serif);
  font-size: var(--t-small);
  line-height: var(--lh-body);
  color: var(--c-muted);
}

.timeline__list {
  position: relative;
  padding-left: var(--s-6);
}

/* 贯穿整条时间线的细竖线：1px、--c-line */
.timeline__list::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 1px;
  background-color: var(--c-line);
}

.timeline__group {
  position: relative;
}

.timeline__group + .timeline__group {
  margin-top: var(--s-12);
}

/* 时间点上的短横线：不用图标，也不用圆点（全站零圆角） */
.timeline__mark {
  position: absolute;
  top: calc(var(--t-label) * 0.6);
  left: calc(var(--s-6) * -1);
  width: var(--s-3);
  height: 1px;
  background-color: var(--c-line);
}

.timeline__time {
  margin-bottom: var(--s-3);
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1.2;
  color: var(--c-ink-soft);
}

.timeline__thumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--s-3);
}

.timeline__thumb {
  display: block;
  width: var(--timeline-thumb-w);
}

.timeline__foot {
  display: flex;
  align-items: baseline;
  gap: var(--s-3);
  margin-top: var(--s-3);
}

.timeline__caption {
  margin: 0;
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1.2;
  color: var(--c-muted);
}

/* 展开/收起：文字按钮，无底色、无描边、无圆角 */
.timeline__toggle {
  font-family: var(--f-mono);
  font-size: var(--t-label);
  letter-spacing: var(--ls-label);
  line-height: 1.2;
  color: var(--c-ink-soft);
  transition: color var(--d-fast) var(--e-out);
}

@media (hover: hover) and (pointer: fine) {
  .timeline__toggle:hover {
    color: var(--c-warm);
  }
}

/* 桌面端缩略图略大（docs/02 §8：768 起重新决定尺寸，而不是等比放大） */
@media (min-width: 768px) {
  .timeline {
    --timeline-thumb-w: var(--s-32);
  }
}

/* 减弱动态效果由 styles/base.scss 统一降为直接显示。 */
</style>
