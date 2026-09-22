/**
 * Wave 2-F · 联系表 PhotoContactSheet.vue 的契约检查。
 *
 * SSR 里没有手势、没有 IntersectionObserver、样式也不进 HTML，所以断言分三层：
 *   1. DOM  —— render() 出来的真实 HTML（格子数、序号、顺序）；
 *   2. vnode —— 从 SSR 实例树里拿到真的 <button>，调用它的 onClick，
 *               验证"点第 N 格 → 查看器 index = N-1、且拿到的就是同一个数组"；
 *   3. CSS  —— 用 sass + vue/compiler-sfc 真编译 scoped 样式，
 *               断 3/5/6 列、1:1 裁切、hover 只放大 1.03 且压得住 LazyImage 自带的 1.02。
 */
import fs from 'node:fs'
import path from 'node:path'
import { sass, sfc, vue, renderToString, load as loadRaw } from '../lib/render.mjs'

const REL = 'src/components/photo/PhotoContactSheet.vue'

/** 剥离注释，避免中文注释里的"阴影/圆角"等词污染字面量审计 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 用 sass 真编译 + compiler-sfc 做 scoped 转换，得到与 Vite 一致的 CSS */
function scopedCss(ROOT, rel, id) {
  const file = path.join(ROOT, rel)
  const source = fs.readFileSync(file, 'utf8')
  const { descriptor, errors } = sfc.parse(source, { filename: file })
  if (errors.length > 0) throw new Error('SFC parse error: ' + errors[0].message)
  const raw = descriptor.styles
    .map((style) => sass.compileString(style.content, { syntax: 'scss' }).css)
    .join('\n')
  return sfc
    .compileStyle({ source: raw, filename: file, id, scoped: descriptor.styles.some((s) => s.scoped) })
    .code
}

/** 抓出所有 @media 块（配对花括号，嵌套规则不会截断） */
function mediaBlocks(css) {
  const out = []
  const re = /@media[^{]*\{/g
  let m
  while ((m = re.exec(css)) !== null) {
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    out.push({ query: m[0].slice(0, -1).trim(), body: css.slice(re.lastIndex, i - 1) })
    re.lastIndex = i
  }
  return out
}

/** 一次选择器的权重（class / 属性 / 伪类各自 1；本项目没有 id 选择器） */
function weight(selector) {
  return (selector.match(/\.[A-Za-z0-9_-]+|\[[^\]]+\]|:[a-z-]+/g) ?? []).length
}

/** 从 HTML 里按出现顺序切出每个格子：序号 + 照片 id */
function cells(html) {
  const chunks = html.split('class="sheet__cell"')
  chunks.shift()
  return chunks.map((chunk) => {
    const label = chunk.match(/class="sheet__index"[^>]*>([^<]*)</)
    const id = chunk.match(/data-photo-id="([^"]*)"/)
    return { label: label ? label[1] : null, photoId: id ? id[1] : null }
  })
}

/** 遍历 vnode 树（含组件子树的 render 结果），把每个 vnode 交给 visit */
function walk(vnode, visit, seen = new Set()) {
  if (Array.isArray(vnode)) {
    for (const item of vnode) walk(item, visit, seen)
    return
  }
  if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
  seen.add(vnode)
  if (vnode.type !== undefined) visit(vnode)
  if (vnode.component && vnode.component.subTree) walk(vnode.component.subTree, visit, seen)
  if (Array.isArray(vnode.children)) walk(vnode.children, visit, seen)
}

/**
 * 在 SSR 里挂载组件，并留下根 vnode —— SSR 不会给 app._instance 赋值
 * （见 @vue/runtime-core 的 mount），所以要自己把根 vnode 抓在手里，
 * 靠 instance.subTree 拿到真实的元素树。
 */
async function mount(Component, props) {
  let root = null
  const app = vue.createSSRApp({
    render: () => {
      root = vue.h(Component, props)
      return root
    }
  })
  const html = await renderToString(app)
  return { html, root }
}

export default async function ({ check, render, load, makePhoto, makePhotos, ROOT }) {
  // sass + scoped 编译（样式语法错误会在这里直接抛出）
  const css = stripComments(scopedCss(ROOT, REL, 'data-v-21sheet'))
  const media = mediaBlocks(css)
  const blockFor = (needle) => media.find((b) => b.query.includes(needle))

  // ---- 网格：3 / 5 / 6 列，间距极小但不为零 ----
  check('联系表基础是 3 列等宽正方形网格', /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(css))
  const md = blockFor('min-width: 768px')
  const xl = blockFor('min-width: 1280px')
  check('≥768px 变 5 列', !!md && /repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(md.body), md ? md.body.replace(/\s+/g, ' ').slice(0, 90) : 'no 768 block')
  check('≥1280px 变 6 列', !!xl && /repeat\(6,\s*minmax\(0,\s*1fr\)\)/.test(xl.body), xl ? xl.body.replace(/\s+/g, ' ').slice(0, 90) : 'no 1280 block')
  check('网格间距用 --s-1 / --s-2（密但不为零）',
    /gap:\s*var\(--s-1\)/.test(css) && !!md && /gap:\s*var\(--s-2\)/.test(md.body))

  // ---- 序号：补零 3 位、与数组下标一一对应 ----
  const twelve = makePhotos(12)
  const html12 = await render(REL, { photos: twelve })
  const cells12 = cells(html12)
  check('12 张 = 12 个格子 + 12 个按钮',
    cells12.length === 12 && (html12.split('<button').length - 1) === 12,
    'cells=' + cells12.length + ' buttons=' + (html12.split('<button').length - 1))
  check('序号补零到 3 位：001 / 002 / … / 012',
    cells12.map((c) => c.label).join(',') === twelve.map((_, i) => String(i + 1).padStart(3, '0')).join(','),
    cells12.map((c) => c.label).join(','))
  check('序号与数组顺序一一对应（同名次照片 id 也对得上）',
    cells12.every((c, i) => c.photoId === twelve[i].id),
    cells12.slice(0, 3).map((c) => c.label + '->' + c.photoId).join(' '))

  // 用打乱的 order 字段证明"序号来自数组下标"，而不是 photo.order
  const shuffled = ['P0009', 'P0002', 'P0007', 'P0004', 'P0001'].map((id, i) =>
    makePhoto({ id, order: [42, 7, 99, 3, 13][i] })
  )
  const htmlShuffled = await render(REL, { photos: shuffled })
  const cellsShuffled = cells(htmlShuffled)
  check('序号来自数组下标而不是 photo.order',
    cellsShuffled.map((c) => c.label).join(',') === '001,002,003,004,005' &&
      cellsShuffled.map((c) => c.photoId).join(',') === shuffled.map((p) => p.id).join(','),
    cellsShuffled.map((c) => c.label + '->' + c.photoId).join(' '))

  // ---- 单张 ----
  const single = await render(REL, { photos: makePhotos(1) })
  const cellsSingle = cells(single)
  check('单张 = 1 个格子，序号 001', cellsSingle.length === 1 && cellsSingle[0].label === '001',
    JSON.stringify(cellsSingle))

  // ---- 空数组：不崩、不渲染格子，也不发任何图片请求 ----
  const empty = await render(REL, { photos: [] })
  check('空数组不抛异常且不渲染任何格子',
    cells(empty).length === 0 && !empty.includes('sheet__cell') && !empty.includes('<button'))
  check('空数组给出一行安静文案「这一类别还没有照片」',
    empty.includes('sheet__empty') && empty.includes('这一类别还没有照片'))
  // SSR 会保留模板注释，审计"渲染出了什么"前先把注释去掉
  const emptyDom = empty.replace(/<!--[\s\S]*?-->/g, '')
  check('空数组不越权渲染「返回全部」入口（属于 Gallery）',
    !emptyDom.includes('返回') && !emptyDom.includes('全部照片'), JSON.stringify(emptyDom))
  check('空数组不发图片请求（无 img）', !empty.includes('<img'))

  // ---- 点击契约：真的调用 SSR 实例树里那个 button 的 onClick ----
  const LazyImage = loadRaw(path.join(ROOT, 'src/components/common/LazyImage.vue'))
  const Sheet = loadRaw(path.join(ROOT, REL))
  const mounted = await mount(Sheet, { photos: twelve })
  const found = { buttons: [], images: [] }
  walk(mounted.root.component ? mounted.root.component.subTree : null, (vnode) => {
    if (vnode.type === 'button') found.buttons.push(vnode)
    if (vnode.type === LazyImage) found.images.push(vnode)
  })
  check('实例树里能拿到 12 个 <button>（点击测试前提）', found.buttons.length === 12, 'buttons=' + found.buttons.length)

  // LazyImage 的传参：thumb + cover（1:1 裁切，而不是等比留白）
  /** 模板里写的是 object-fit，vnode.props 保留原始的连字符写法 */
  const fitOf = (v) => v.props.objectFit ?? v.props['object-fit']
  check('每格用 LazyImage：size=thumb + object-fit=cover（1:1 裁切，不是等比留白）',
    found.images.length === 12 && found.images.every((v) => v.props.size === 'thumb' && fitOf(v) === 'cover'),
    found.images.length + ' imgs, first=' + JSON.stringify(found.images[0] ? { size: found.images[0].props.size, fit: fitOf(found.images[0]) } : null))

  const viewer = load('src/composables/usePhotoViewer.ts').usePhotoViewer()
  viewer.close()
  const list = makePhotos(12)
  const mounted2 = await mount(Sheet, { photos: list })
  const buttons = []
  walk(mounted2.root.component ? mounted2.root.component.subTree : null, (vnode) => {
    if (vnode.type === 'button') buttons.push(vnode)
  })
  check('点击第 3 格 → 查看器 index=2', typeof buttons[2]?.props?.onClick === 'function' &&
    (buttons[2].props.onClick(), viewer.isOpen.value === true && viewer.index.value === 2),
    'index=' + viewer.index.value + ' open=' + viewer.isOpen.value)
  check('查看器拿到的是同一个数组（序号空间与查看器一致）', viewer.photos.value === list)

  // 序号 003 ↔ 查看器顶部 "3 / 12"：同一个下标、同一张照片
  const openHtml = await render('src/components/photo/PhotoViewer.vue', {})
  check('查看器顶部计数 "3 / 12" 与联系表序号 003 指向同一张',
    openHtml.includes('3 / 12') && cells12[2].label === '003' && cells12[2].photoId === list[2].id,
    'label=' + cells12[2].label + ' photo=' + cells12[2].photoId + ' viewer=' + (openHtml.includes('3 / 12') ? '3 / 12' : '?'))

  // 点最后一格也要落在同一数组的末尾
  buttons[11].props.onClick()
  const openHtmlLast = await render('src/components/photo/PhotoViewer.vue', {})
  check('点击第 12 格 → 查看器 "12 / 12"', openHtmlLast.includes('12 / 12'))
  viewer.close()

  // 文档里的场景（docs/01 §7.5 / §7.11）：386 张时点第 23 格
  const big = makePhotos(386)
  const mountedBig = await mount(Sheet, { photos: big })
  const bigButtons = []
  walk(mountedBig.root.component ? mountedBig.root.component.subTree : null, (vnode) => {
    if (vnode.type === 'button') bigButtons.push(vnode)
  })
  bigButtons[22].props.onClick()
  const bigCounter = await render('src/components/photo/PhotoViewer.vue', {})
  const bigCells = cells(mountedBig.html)
  check('386 张时的 "23 / 386" 与联系表序号 023 是同一张（下标 22）',
    bigButtons.length === 386 && bigCounter.includes('23 / 386') &&
      bigCells[22].label === '023' && bigCells[22].photoId === big[22].id,
    'label=' + bigCells[22].label + ' photo=' + bigCells[22].photoId + ' counter=' + (bigCounter.includes('23 / 386') ? '23 / 386' : '?'))
  viewer.close()

  // ---- 1:1 取景框：外层正方形 + 把 LazyImage 拉满，压掉它自带的内联比例 ----
  const frameRule = css.match(/\.sheet__frame[^{]*\{[^}]*\}/)
  check('取景框 aspect-ratio: 1 / 1（与照片比例无关）',
    !!frameRule && /aspect-ratio:\s*1\s*\/\s*1/.test(frameRule[0]),
    frameRule ? frameRule[0].replace(/\s+/g, ' ') : 'missing .sheet__frame')
  const deepRule = css.match(/\[data-v-21sheet\][^{]*\.lazy-image\s*\{[^}]*\}/)
  check('子组件被拉满取景框（宽高都确定后内联 aspect-ratio 失效 → cover 变成中心裁切）',
    !!deepRule && /position:\s*absolute/.test(deepRule[0]) && /height:\s*100%/.test(deepRule[0]) && /width:\s*100%/.test(deepRule[0]),
    deepRule ? deepRule[0].replace(/\s+/g, ' ') : 'missing deep rule')
  check('取景框 overflow: hidden（放大后不越界）', !!frameRule && /overflow:\s*hidden/.test(frameRule[0]))

  // ---- hover：仅桌面精细指针，1.03，且压得过 LazyImage 自带的 1.02 ----
  const hover = media.find((b) => b.query.includes('hover: hover') && b.body.includes('scale'))
  check('hover 只在 (hover:hover) and (pointer:fine) 下生效', !!hover, hover ? hover.query : 'no hover block')
  check('hover 放大 1.03（轻微）', !!hover && /scale\(1\.03\)/.test(hover.body))
  const hoverSelector = hover ? (hover.body.match(/([^{}]+)\{/) ?? ['', ''])[1].trim() : ''
  const own = stripComments(scopedCss(ROOT, 'src/components/common/LazyImage.vue', 'data-v-21lazy'))
  const ownSelector = (own.match(/([^{}]*:hover[^{}]*)\{/) ?? ['', ''])[1].trim()
  check('hover 选择器权重 > LazyImage 自带的 hover（避免两层缩放叠成 1.05）',
    weight(hoverSelector) > weight(ownSelector),
    'mine=' + weight(hoverSelector) + ' (' + hoverSelector.replace(/\s+/g, ' ') + ') vs lazy=' + weight(ownSelector))
  check('hover 不改边框 / 阴影（只缩放）',
    !!hover && !/box-shadow|border/.test(hover.body))

  // ---- 动效：一次性 200ms 淡入，无错开 ----
  // scoped 转换会把 keyframes 名字带上作用域后缀（sheet-in-data-v-…），所以只锁前缀
  check('一次性淡入用 --d-fast（200ms）与 --e-out',
    /animation:\s*sheet-in[\w-]*\s+var\(--d-fast\)\s+var\(--e-out\)/.test(css) && /@keyframes\s+sheet-in[\w-]*/.test(css))
  check('不做错开动画（没有 animation-delay / transition-delay）', !/animation-delay|transition-delay/.test(css))

  // ---- 反模式审计（硬编码色值 / 阴影 / 圆角 / 非法 px）----
  check('无硬编码色值（无 hex / rgb）', !/#[0-9a-fA-F]{3,8}\b/.test(css) && !/rgba?\(/.test(css))
  check('无 box-shadow', !/box-shadow/.test(css))
  const radiusValues = [...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim())
  check('圆角只用 var(--r)（全站零圆角）',
    radiusValues.length > 0 && radiusValues.every((value) => value === 'var(--r)'),
    'radius=' + JSON.stringify(radiusValues))
  const pxLeft = (() => {
    let s = css.replace(/min-width:\s*\d+px/g, '')
    s = s.replace(/1px/g, '')
    return (s.match(/[\d.]+px/g) ?? []).join(',')
  })()
  check('px 只出现在断点与 1px 描边（其余一律用 token）', pxLeft === '', 'stray=' + pxLeft)

  // ---- 契约审计：prop 形状 & 不越界依赖 ----
  const source = fs.readFileSync(path.join(ROOT, REL), 'utf8')
  check('prop 冻结为 defineProps<{ photos: Photo[] }>()', /defineProps<\{\s*photos:\s*Photo\[\]\s*\}>/.test(source))
  const imports = source.match(/^import .*$/gm) ?? []
  check('只依赖 vue / 类型 / LazyImage / usePhotoViewer（不 import 其它模式组件、不读 JSON）',
    imports.length === 4 &&
      imports.every((line) => /from '(vue|@\/types\/photo|@\/components\/common\/LazyImage\.vue|@\/composables\/usePhotoViewer)'/.test(line)),
    imports.join(' | '))
  check('只有一个 prop：模板里不再引用其它 prop', !/defineProps<\{[^}]*,[^}]*\}>/.test(source))
}
