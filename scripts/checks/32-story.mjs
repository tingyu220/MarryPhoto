/**
 * 「这一天」StoryView（Wave 3-I）的契约检查。
 *
 * 断言分成三层：
 *   1. DOM —— 章节数量、时间/标题、按时间区间的照片归属、空章降级、空 chapters；
 *   2. 行为 —— 点照片后交给全站唯一查看器的下标是否等于"该章数组里的位置"；
 *   3. 源码 —— 竖线用 transform: scaleY（不是 JS 改高度）、token 纪律、反模式。
 *
 * SSR 不执行 onMounted / IntersectionObserver / 滚动，因此这里不测"线长出来"的时序，
 * 只测"它是不是靠 scaleY 长的、有没有 JS 逐帧插一脚"。
 */
import fs from 'node:fs'
import path from 'node:path'

const VIEW = 'src/views/StoryView.vue'
const DAY = '2026-09-16'

// ───────────────────────────── 小工具 ─────────────────────────────

/** SSR 会插入 <!--[--> 之类的片段标记，断言前先剥掉 */
function strip(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

function countOf(html, needle) {
  return html.split(needle).length - 1
}

/** 拆出所有含 marker 的 <tag>…</tag> 片段（tag 内部不允许嵌套同名标签，这里够用） */
function chunksOf(html, tag, marker) {
  return html
    .split(new RegExp('<' + tag + '\\b'))
    .slice(1)
    .map((part) => part.split('</' + tag + '>')[0])
    .filter((part) => part.includes(marker))
}

function chapterChunks(html) {
  return chunksOf(html, 'li', 'story__chapter')
}

function hitChunks(chunk) {
  return chunksOf(chunk, 'button', 'story__hit')
}

/** 片段的开标签（属性都在这里，不会误读子节点的属性） */
function openTag(chunk) {
  const end = chunk.indexOf('>')
  return end < 0 ? chunk : chunk.slice(0, end)
}

function attr(tagHtml, name) {
  const matched = new RegExp(name + '="([^"]*)"').exec(tagHtml)
  return matched === null ? null : matched[1]
}

function textOf(chunk, className) {
  const matched = new RegExp('class="' + className + '[^"]*"[^>]*>([^<]*)<').exec(chunk)
  return matched === null ? null : matched[1].trim()
}

/** 每章照片的 id，按 DOM 顺序 */
function photoIdsOf(chunk) {
  return [...chunk.matchAll(/data-photo-id="([^"]+)"/g)].map((matched) => matched[1])
}

/** 每张照片按钮上的 data-index（查看器用的下标，必须与所在章的数组一致） */
function indexesOf(chunk) {
  return hitChunks(chunk).map((button) => Number(attr(openTag(button), 'data-index')))
}

/** 造一张指定 id / 时间 / order 的照片 */
function shot(makePhoto, id, time, order) {
  return makePhoto({ id, time, order })
}

/** 从 vnode 树里收集 <button>（用来在 SSR 之外真的触发一次点击） */
function collectButtons(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectButtons(item, out)
    return
  }
  if (node === null || typeof node !== 'object') return
  if (node.type === 'button') out.push(node)
  const children = node.children
  if (Array.isArray(children)) collectButtons(children, out)
  else if (children !== null && typeof children === 'object') {
    for (const value of Object.values(children)) {
      if (typeof value === 'function') collectButtons(value(), out)
    }
  }
}

export default async function ({ check, skip, render, load, makePhoto, makePhotos, ROOT }) {
  // ───────────────────────── 1. 真实数据 ─────────────────────────
  const storyJson = load('src/data/story.json')
  const realHtml = strip(await render(VIEW, {}))
  const realChapters = chapterChunks(realHtml)
  const expected = storyJson.chapters

  check(
    '章节数量与 story.json 一致',
    realChapters.length === expected.length,
    'DOM=' + realChapters.length + ' / json=' + expected.length
  )
  check(
    '每章的时间与标题都来自 story.json（顺序一致）',
    realChapters.map((chunk) => textOf(chunk, 'story__time')).join(',') ===
      expected.map((chapter) => chapter.time).join(',') &&
      realChapters.map((chunk) => textOf(chunk, 'story__title')).join(',') ===
        expected.map((chapter) => chapter.title).join(','),
    realChapters.map((chunk) => textOf(chunk, 'story__time')).join(',')
  )
  check('每章都能读到非空的时间与标题', realChapters.every((chunk) =>
    (textOf(chunk, 'story__time') ?? '') !== '' && (textOf(chunk, 'story__title') ?? '') !== ''))
  check('页面显示当天日期', realHtml.includes('2026 · 09 · 16'), 'story.date=' + storyJson.date)

  const realCounts = realChapters.map((chunk) => photoIdsOf(chunk).length)
  if (realCounts.some((n) => n === 0)) skip('真实数据：每章都拿到了照片', '照片还没覆盖全部章节的时间段，各章 N=' + realCounts.join(','))
  else check('真实数据：每章都拿到了照片', true, realCounts.join(','))
  check('真实数据：每章不超过 10 张', realCounts.every((n) => n <= 10), realCounts.join(','))
  check('真实数据：每章的 data-index 都是 0..n-1（与本章数组一致）',
    realChapters.every((chunk) => indexesOf(chunk).join(',') ===
      indexesOf(chunk).map((_, i) => i).join(',')))

  // ───────────────────────── 2. 按时间区间归属（自造数据）─────────────────────────
  // 照片故意乱序放进数组：章节里必须按 order 升序，而不是"进来的顺序"
  const pool = [
    shot(makePhoto, 'P0003', DAY + 'T11:59:00', 3),
    shot(makePhoto, 'P0005', DAY + 'T23:59:00', 5),
    shot(makePhoto, 'P0001', DAY + 'T06:59:00', 1),
    shot(makePhoto, 'P0004', DAY + 'T12:00:00', 4),
    shot(makePhoto, 'P0002', DAY + 'T07:00:00', 2),
    shot(makePhoto, 'P0006', null, 6)
  ]
  const twoChapters = {
    date: DAY,
    chapters: [
      { time: '07:00', title: '早', text: '第一句。' },
      { time: '12:00', title: '午', text: '第二句。' }
    ]
  }
  const windowHtml = strip(await render(VIEW, { photos: pool, story: twoChapters }))
  const windowChapters = chapterChunks(windowHtml)

  check('两章 → 渲染两个章节', windowChapters.length === 2, '得到 ' + windowChapters.length)
  check('第一章 = [本时刻, 下一章时刻)：命中 07:00 与 11:59，排除 06:59',
    photoIdsOf(windowChapters[0] ?? '').join(',') === 'P0002,P0003',
    photoIdsOf(windowChapters[0] ?? '').join(','))
  check('第二章从 12:00 起：命中 12:00 与 23:59（最后一章取到当天结束）',
    photoIdsOf(windowChapters[1] ?? '').join(',') === 'P0004,P0005',
    photoIdsOf(windowChapters[1] ?? '').join(','))
  check('章内按 order 升序（P0002 在 P0003 之前，尽管数组里是反的）',
    photoIdsOf(windowChapters[0] ?? '')[0] === 'P0002')
  check('早于第一章的照片（06:59）不属于任何章', !windowHtml.includes('P0001'))
  check('没有拍摄时间的照片不属于任何章', !windowHtml.includes('P0006'))
  check('每章的 data-index 都从 0 开始（查看器下标是章内位置，不是全局序号）',
    indexesOf(windowChapters[1] ?? '').join(',') === '0,1',
    indexesOf(windowChapters[1] ?? '').join(','))

  // 12 张同一区间 → 最多 10 张
  const twelve = makePhotos(12).map((photo, i) =>
    makePhoto({ id: photo.id, order: i + 1, time: DAY + 'T07:30:00' }))
  const capped = chapterChunks(strip(await render(VIEW, {
    photos: twelve,
    story: { date: DAY, chapters: [{ time: '07:00', title: '早', text: '' }] }
  })))
  check('同一区间 12 张 → 只渲染 10 张', photoIdsOf(capped[0] ?? '').length === 10,
    String(photoIdsOf(capped[0] ?? '').length))
  check('截断取的是 order 最小的 10 张（P0001…P0010）',
    photoIdsOf(capped[0] ?? '').join(',') === twelve.slice(0, 10).map((photo) => photo.id).join(','),
    photoIdsOf(capped[0] ?? '').join(','))

  // ───────────────────────── 3. photoIds 优先于时间归属 ─────────────────────────
  const explicitPool = [
    shot(makePhoto, 'P0001', DAY + 'T07:10:00', 1),
    shot(makePhoto, 'P0002', DAY + 'T07:20:00', 2),
    shot(makePhoto, 'P0005', DAY + 'T07:50:00', 5),
    shot(makePhoto, 'P0003', DAY + 'T12:10:00', 3),
    shot(makePhoto, 'P0004', DAY + 'T12:20:00', 4)
  ]
  const explicitStory = {
    date: DAY,
    chapters: [
      { time: '07:00', title: '指定', text: '', photoIds: ['P0005', 'P0002', 'P9999'] },
      { time: '12:00', title: '自动', text: '' }
    ]
  }
  const explicitHtml = strip(await render(VIEW, { photos: explicitPool, story: explicitStory }))
  const explicitChapters = chapterChunks(explicitHtml)

  check('photoIds 优先：显式章节按给定顺序取图（P0005 在前，不是按 order）',
    photoIdsOf(explicitChapters[0] ?? '').join(',') === 'P0005,P0002',
    photoIdsOf(explicitChapters[0] ?? '').join(','))
  check('photoIds 优先：该时间段里的 P0001 没有因为"时间命中"混进来',
    !photoIdsOf(explicitChapters[0] ?? '').includes('P0001'))
  check('photoIds 里不存在的 id 被丢掉，且不影响其它照片',
    !explicitHtml.includes('P9999') && photoIdsOf(explicitChapters[1] ?? '').join(',') === 'P0003,P0004',
    photoIdsOf(explicitChapters[1] ?? '').join(','))
  check('显式章节仍然用章内下标 0,1 打开查看器',
    indexesOf(explicitChapters[0] ?? '').join(',') === '0,1')

  // ───────────────────────── 4. 空章降级 ─────────────────────────
  const emptyFirst = {
    date: DAY,
    chapters: [
      { time: '07:00', title: '空的清晨', text: '这一段时间没有照片。' },
      { time: '12:00', title: '有照片的中午', text: '' }
    ]
  }
  const emptyHtml = strip(await render(VIEW, { photos: [shot(makePhoto, 'P0004', DAY + 'T12:30:00', 1)], story: emptyFirst }))
  const emptyChapters = chapterChunks(emptyHtml)

  check('某章没有照片：章节仍然渲染（时间 / 标题 / 文字都在）',
    emptyChapters.length === 2 &&
      textOf(emptyChapters[0] ?? '', 'story__time') === '07:00' &&
      textOf(emptyChapters[0] ?? '', 'story__title') === '空的清晨' &&
      (emptyChapters[0] ?? '').includes('这一段时间没有照片。'))
  check('某章没有照片：不渲染任何图片 / 破图 / 占位',
    !(emptyChapters[0] ?? '').includes('lazy-image') &&
      !(emptyChapters[0] ?? '').includes('<img') &&
      countOf(emptyChapters[0] ?? '', 'data-photo-id=') === 0)
  check('某章没有照片：没有多余的"暂无照片"文案（留白即排版）',
    !(emptyChapters[0] ?? '').includes('story__empty'))
  check('某章没有照片：其它章节不受影响',
    photoIdsOf(emptyChapters[1] ?? '').join(',') === 'P0004')

  const emptyIdsStory = {
    date: DAY,
    chapters: [{ time: '07:00', title: '写明没有照片', text: '', photoIds: [] }]
  }
  const emptyIdsHtml = strip(await render(VIEW, { photos: explicitPool, story: emptyIdsStory }))
  check('photoIds: [] 视为人工明确"这一章没有照片"：该章不取时间区间里的照片',
    chapterChunks(emptyIdsHtml).length === 1 && !emptyIdsHtml.includes('data-photo-id='))

  // ───────────────────────── 5. 空 chapters / 坏数据不崩 ─────────────────────────
  const noChapters = strip(await render(VIEW, { story: { date: DAY, chapters: [] } }))
  check('chapters 为空：不崩，页面骨架还在（标题 / 日期 / 页脚）',
    noChapters.includes('<h1') && noChapters.includes('2026 · 09 · 16') && noChapters.includes('<footer'))
  check('chapters 为空：不渲染章节与照片',
    !noChapters.includes('story__chapter') && !noChapters.includes('data-photo-id='))
  check('chapters 为空：给出一行安静的空状态', noChapters.includes('story__empty'))

  const noChaptersField = strip(await render(VIEW, { story: { date: DAY } }))
  check('chapters 字段缺失：同样不崩、走空状态', noChaptersField.includes('story__empty'))

  const badChapters = strip(await render(VIEW, {
    story: { date: DAY, chapters: [{ title: '没有时间' }, { time: '09:00' }, { time: '10:00', title: '好的一章', text: '' }] }
  }))
  check('缺时间 / 缺标题的章节被安静跳过，好的一章照常渲染',
    chapterChunks(badChapters).length === 1 &&
      textOf(chapterChunks(badChapters)[0] ?? '', 'story__title') === '好的一章')

  const noPhotos = strip(await render(VIEW, { photos: [], story: storyJson }))
  check('一张照片都没有：8 个章节全部降级渲染，不崩、不出现图片',
    chapterChunks(noPhotos).length === expected.length && !noPhotos.includes('data-photo-id='))

  // ───────────────────────── 6. 点击 → 查看器下标 ─────────────────────────
  try {
    const component = load(VIEW)
    const { usePhotoViewer } = load('src/composables/usePhotoViewer.ts')
    const state = usePhotoViewer()
    state.close()

    const clickPool = [
      shot(makePhoto, 'C0001', DAY + 'T07:10:00', 1),
      shot(makePhoto, 'C0002', DAY + 'T07:20:00', 2),
      shot(makePhoto, 'C0003', DAY + 'T07:30:00', 3),
      shot(makePhoto, 'C0004', DAY + 'T12:10:00', 4),
      shot(makePhoto, 'C0005', DAY + 'T12:20:00', 5)
    ]
    const clickStory = {
      date: DAY,
      chapters: [
        { time: '07:00', title: '早', text: '' },
        { time: '12:00', title: '午', text: '' }
      ]
    }
    const instance = component.setup(
      { photos: clickPool, story: clickStory },
      { expose() {}, emit() {}, attrs: {}, slots: {} }
    )
    const buttons = []
    collectButtons(instance({}, []), buttons)
    const hits = buttons.filter((button) => String(button.props?.class ?? '').includes('story__hit'))

    check('5 张照片 → 5 个可点的照片按钮', hits.length === 5, '得到 ' + hits.length)
    check('按钮上的 data-index 先是第一章的 0,1,2，再是第二章的 0,1',
      hits.map((button) => button.props['data-index']).join(',') === '0,1,2,0,1',
      hits.map((button) => button.props['data-index']).join(','))

    hits[3].props.onClick()
    check('点第二章第 1 张 → 查看器 index=0（章内下标，不是全局第 4 张）',
      state.index.value === 0 && state.current.value?.id === 'C0004',
      'index=' + state.index.value + ' id=' + (state.current.value?.id ?? 'null'))
    check('查看器拿到的是该章的照片数组（2 张），不是整页的 5 张',
      state.photos.value.length === 2, 'length=' + state.photos.value.length)

    hits[2].props.onClick()
    check('点第一章第 3 张 → 查看器 index=2 且指向 C0003',
      state.index.value === 2 && state.current.value?.id === 'C0003' &&
        state.photos.value.length === 3,
      'index=' + state.index.value + ' length=' + state.photos.value.length)

    state.close()
    check('关闭后查看器状态复位（不污染其它检查）', state.isOpen.value === false)
  } catch (err) {
    check('点击交互可从编译后的 setup 中触发', false, String(err && err.message ? err.message : err))
  }

  // ───────────────────────── 7. 源码级硬性约束 ─────────────────────────
  const source = fs.readFileSync(path.join(ROOT, VIEW), 'utf8')
  const style = (/<style[^>]*>([\s\S]*?)<\/style>/.exec(source) ?? ['', ''])[1]
  const template = (/<template>([\s\S]*)<\/template>/.exec(source) ?? ['', ''])[1]

  check('用全站唯一查看器（usePhotoViewer），不自己实现 / 不引 PhotoSwipe',
    source.includes('usePhotoViewer') && /viewer\.open\(list,\s*index\)/.test(source) &&
      !/photoswipe/i.test(source) && !/PhotoViewer\.vue/.test(source))
  check('照片一律交给 LazyImage，模板里不写 <img>', !/<img/.test(template) && countOf(source, '<LazyImage') === 2)
  check('第一张放大用 preview，其余显式用 medium（不是缺省的 thumb）',
    /<LazyImage[^>]*size="preview"/.test(source) && !/size="preview"[\s\S]*size="preview"/.test(source))
  check('第一张单独一个 figure（story__shot--lead），其余进 2 列错落容器',
    source.includes('story__shot--lead') && /grid-template-columns:\s*repeat\(2,\s*1fr\)/.test(style))
  check('章节之间留白 --s-24 ~ --s-32',
    style.includes('var(--s-24)') && style.includes('var(--s-32)'))

  check('竖线：1px + var(--c-line)',
    /\.story__line[\s\S]{0,400}?width:\s*1px/.test(style) && style.includes('var(--c-line)'))
  check('竖线随滚动生长用 transform: scaleY（不是 JS 逐帧改高度）',
    /transform:\s*scaleY\(0\)/.test(style) && /transform:\s*scaleY\(1\)/.test(style) &&
      /transition:\s*transform var\(--d-slow\) var\(--e-out\)/.test(style))
  check('没有任何 JS 滚动 / 尺寸监听、没有动画库',
    !/addEventListener|requestAnimationFrame|getBoundingClientRect|scrollY|IntersectionObserver/.test(source) &&
      !/from '(?!vue|@\/)/.test(source))
  check('竖线在移动端隐藏，≥768px 才出现',
    /\.story__line\s*\{[^}]*display:\s*none/.test(style) &&
      /@media\s*\(min-width:\s*768px\)[\s\S]*\.story__line\s*\{[^}]*display:\s*block/.test(style))
  check('尊重 prefers-reduced-motion',
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(style))

  check('大号时间用 display 衬线 + --t-h1（视觉上明显大于章节标题）',
    /\.story__time\s*\{[^}]*font-family:\s*var\(--f-display\)/.test(style) &&
      /\.story__time\s*\{[^}]*font-size:\s*var\(--t-h1\)/.test(style))
  check('章节标题走 --t-h2，正文走 --t-body（角色对照 docs/02 §4.2）',
    template.includes('story__title t-h2') && template.includes('story__text t-body'))

  check('样式里没有硬编码色值',
    !/#[0-9a-fA-F]{3,8}\b/.test(style) && !/\b(rgba?|hsla?)\(/.test(style))
  check('没有阴影、没有圆角', !/box-shadow/.test(style) && !/border-radius/.test(style))
  const pxOutsideMedia = (style.replace(/\/\*[\s\S]*?\*\//g, '').replace(/min-width:\s*\d+px/g, '').match(/[\d.]+px/g) || [])
  check('px 只出现在 1px 描边', pxOutsideMedia.every((value) => value === '1px'), pxOutsideMedia.join(','))
  check('间距 / 时长只用 token',
    /padding-bottom:\s*var\(--s-/.test(style) && style.includes('var(--d-slow)') && style.includes('var(--e-out)'))
  check('模板里没有图标（无 svg）', !template.includes('<svg'))
  check('没有卡片 / 胶囊标签类名',
    !/class="[^"]*\b(card|panel|badge|chip|pill)\b/.test(realHtml))
}
