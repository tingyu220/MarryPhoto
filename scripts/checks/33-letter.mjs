/**
 * 写给姐姐（整条路的终点）与 404 的契约级断言。
 *
 * 与 20-masonry.mjs 同一套办法：SSR 不会输出 <style>，所以
 *   - "渲染出什么 DOM" → 读 render() 的 HTML；
 *   - "用了什么 CSS"   → 直接读组件源码的 <style> 块。
 *
 * 正文一律以 load() 读到的 src/data/letter.json 为准。为了证明组件里没有写死
 * 任何一个字，这里会**临时改写**这份数据（模块级缓存是同一个对象，改完再还原），
 * 看渲染结果是否跟着变 —— 只断言"包含 json 里的文案"是抓不出硬编码的。
 */
import fs from 'node:fs'
import path from 'node:path'

const LETTER = 'src/views/LetterView.vue'
const NOT_FOUND = 'src/views/NotFoundView.vue'
const LETTER_JSON = 'src/data/letter.json'
const USE_PHOTOS = 'src/composables/usePhotos.ts'

const file = (ROOT, p) => path.join(ROOT, p)
const styleOf = (src) => (src.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1] || ''
const templateOf = (src) => (src.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''
const delaysIn = (html) => (html.match(/transition-delay:(\d+)ms/g) || []).map((s) => Number(s.replace(/\D/g, '')))
const countOf = (html, re) => (html.match(re) || []).length
/** 取 <article class="letter"> 到页脚之间的片段：只对"信里"下断言，不误伤导航与页脚 */
const insideOf = (html, marker, stop) => {
  const start = html.indexOf(marker)
  if (start < 0) return ''
  const end = html.indexOf(stop, start)
  return html.slice(start, end < 0 ? undefined : end)
}

/** 视觉纪律：两页共用同一套（零圆角 / 无阴影 / 无硬编码色值 / px 只出现在 1px 描边） */
function discipline(prefix, check, style) {
  const css = style.replace(/\/\*[\s\S]*?\*\//g, '')
  check(prefix + '没有 box-shadow', !/box-shadow/.test(css))
  check(prefix + '圆角只允许 var(--r)', !/border-radius:\s*(?![^;]*var\()/.test(css))
  check(prefix + '没有硬编码色值（#hex / rgb / hsl）',
    !/#[0-9a-fA-F]{3,8}\b/.test(css) && !/\b(rgba?|hsla?)\(/.test(css))
  const px = css.replace(/min-width:\s*\d+px/g, '').match(/[\d.]+px/g) || []
  check(prefix + 'px 只出现在 1px 描边', px.every((v) => v === '1px'), px.join(','))
}

export default async function ({ check, render, load, ROOT }) {
  const letter = load(file(ROOT, LETTER_JSON))
  const { usePhotos } = load(file(ROOT, USE_PHOTOS))
  const source = usePhotos()
  const all = source.all.value

  const src = fs.readFileSync(file(ROOT, LETTER), 'utf8')
  const style = styleOf(src)
  const template = templateOf(src)

  // ---------------------------------------------------------------- 外壳与结构
  const html = await render(LETTER, {})
  const inner = insideOf(html, 'class="letter"', '<footer')

  check('Letter 由 PageShell 承载（导航与页脚由外壳负责）',
    html.includes('page-shell') && html.includes('<header') && html.includes('<footer'))
  check('渲染出信纸容器 <article class="letter">', html.includes('class="letter"'))
  check('版面没有可见标题，但给辅助技术留了一个 h1',
    /<h1[^>]*class="[^"]*visually-hidden/.test(html) && !/<h1[^>]*class="letter__/.test(html))

  // ---------------------------------------------------------------- 内容来自数据
  check('称呼渲染出来', letter.greeting.length > 0 && html.includes(letter.greeting))
  const missing = letter.paragraphs.filter((p) => !html.includes(p))
  check('每一段正文都渲染出来（逐段比对 letter.json）', missing.length === 0,
    '共 ' + letter.paragraphs.length + ' 段，缺 ' + missing.length)
  const renderedParagraphs = countOf(html, /class="[^"]*letter__paragraph[^"]*"/g)
  check('段落数量与 letter.json 一致', renderedParagraphs === letter.paragraphs.length,
    renderedParagraphs + ' vs ' + letter.paragraphs.length)
  check('签名渲染出来', letter.signature.length > 0 && html.includes(letter.signature))

  // ---------------------------------------------------------------- 夹在信里的小照片
  const pinned = letter.photoId ? source.byId(letter.photoId) : undefined
  const expected = pinned || all[0] || null
  const photoIds = (html.match(/data-photo-id="([^"]+)"/g) || []).map((s) => s.replace(/data-photo-id="|"/g, ''))
  check('夹在信里的小照片渲染出来（photoId 优先，回落第一张）',
    expected !== null && photoIds.length === 1 && photoIds[0] === expected.id,
    photoIds.join(','))
  check('信里只有这一张照片', countOf(html, /class="lazy-image[^"]*"/g) === 1)
  check('小照片的 alt 交给 LazyImage（description 优先，组件不覆盖）', !/alt=/.test(template))

  // ---------------------------------------------------------------- 极简
  check('信里没有任何按钮（这一页没有可点的 UI）', !/<button/.test(inner))
  check('信里没有 <img>（图片一律交给 LazyImage）', !/<img/.test(inner))
  check('信里没有 svg / picture / canvas（无图标、无插画）',
    !/<svg|<picture|<canvas/.test(inner))
  check('信里只有一个链接：回到开始', countOf(inner, /<a\b/g) === 1 &&
    /href="\/"/.test(inner) && inner.includes('回到开始'))
  check('信里没有卡片 / 胶囊 / 图标类名',
    !/\b(card|panel|badge|chip|icon|pill|tag)\b/.test(inner))

  // ---------------------------------------------------------------- 排版（读源码）
  check('窄栏：max-width 用 --w-text', /\.letter\s*\{[^}]*max-width:\s*var\(--w-text\)/.test(style))
  check('窄栏居中、文字左对齐',
    /\.letter\s*\{[^}]*margin-inline:\s*auto/.test(style) &&
    !/\.letter(__greeting|__paragraph)[^{]*\{[^}]*text-align:\s*center/.test(style))
  check('大行高：正文行高用 --lh-letter', /\.letter__(greeting|paragraph)[^{]*\{[^}]*line-height:\s*var\(--lh-letter\)/.test(style))
  check('段落之间留 --s-6', /\.letter__paragraph \+ \.letter__paragraph\s*\{[^}]*margin-top:\s*var\(--s-6\)/.test(style))
  check('整页缓慢淡入（--d-slow）', /animation:[^;]*var\(--d-slow\)[^;]*var\(--e-out\)/.test(style))

  // ---------------------------------------------------------------- 那张小照片的"白边"
  const photoRule = (style.match(/\.letter__photo\s*\{([^}]*)\}/) || [])[1] || ''
  check('小照片略微歪着（约 -2deg）', /transform:\s*rotate\(-2deg\)/.test(photoRule), photoRule.trim())
  check('小照片白边 = padding + 纸色底（不用阴影）',
    /padding:\s*var\(--s-/.test(photoRule) && /background-color:\s*var\(--c-bg\)/.test(photoRule))
  check('小照片有 1px 细边把纸边勾出来（纸色与页底同色，否则看不见白边）',
    /border:\s*1px solid var\(--c-line\)/.test(photoRule))

  discipline('Letter：', check, style)

  // ------------------------------------------------- 数据驱动：改 letter.json，输出跟着变
  const savedGreeting = letter.greeting
  const savedParagraphs = letter.paragraphs
  const savedSignature = letter.signature
  const savedPhotoId = letter.photoId
  const savedPhotos = all.slice()
  const originals = [savedGreeting, ...savedParagraphs, savedSignature].filter((t) => typeof t === 'string' && t.length >= 4)

  try {
    letter.greeting = 'ZZ-GREETING-01'
    letter.paragraphs = ['ZZ-PARAGRAPH-01', 'ZZ-PARAGRAPH-02']
    letter.signature = 'ZZ-SIGNATURE-01'

    const swapped = await render(LETTER, {})
    check('不硬编码：改 letter.json 后，称呼 / 段落 / 签名都跟着变',
      swapped.includes('ZZ-GREETING-01') && swapped.includes('ZZ-PARAGRAPH-01') &&
      swapped.includes('ZZ-PARAGRAPH-02') && swapped.includes('ZZ-SIGNATURE-01'))
    const leftovers = originals.filter((t) => swapped.includes(t))
    check('不硬编码：改数据后，原来的文案一个字都不再出现', leftovers.length === 0, leftovers.join(' | '))
    const inSource = originals.filter((t) => src.includes(t))
    check('不硬编码：组件源码里不出现任何一句正文', inSource.length === 0, inSource.join(' | '))
    check('占位文案没有被写死（组件里读的就是 letter.json）', /import\s+letter\s+from\s+'@\/data\/letter\.json'/.test(src))

    // -------------------------------------------- 段落很多时：错开封顶在 5 档
    letter.paragraphs = Array.from({ length: 8 }, (_, i) => 'ZZ-P-' + i)
    const many = await render(LETTER, {})
    const manyDelays = delaysIn(many)
    check('段落多时错开封顶（第 6 段之后再等 600ms 也不会叠上去）',
      manyDelays.join(',') === '0,120,240,360,480,600,600,600', manyDelays.join(','))

    // ------------------------------------------------------ 空 paragraphs：不崩
    letter.paragraphs = []
    const empty = await render(LETTER, {})
    check('letter.json 段落为空时不崩，称呼与签名照旧',
      empty.includes('class="letter"') && empty.includes('ZZ-GREETING-01') && empty.includes('ZZ-SIGNATURE-01'))
    check('段落为空时不渲染空段落节点', !/class="[^"]*letter__paragraph/.test(empty))

    // ------------------------------------------------------ photoId 为 null / 指向不存在的照片
    letter.photoId = null
    const fallback = await render(LETTER, {})
    check('photoId 为 null 时不崩，回落到第一张照片',
      all.length > 0 && fallback.includes('data-photo-id="' + all[0].id + '"'))

    letter.photoId = 'NOT-A-REAL-PHOTO-ID'
    const bogus = await render(LETTER, {})
    check('photoId 指向不存在的照片时不崩，同样回落',
      bogus.includes('data-photo-id="' + all[0].id + '"'))

    // ------------------------------------------------------ 一张照片都没有：整块不渲染
    all.splice(0, all.length)
    const noPhoto = await render(LETTER, {})
    check('一张照片都没有时，小照片整块不渲染（不留空框）',
      !noPhoto.includes('letter__photo') && !noPhoto.includes('lazy-image'))
    check('没有照片时信本身照旧完整', noPhoto.includes('ZZ-GREETING-01') && noPhoto.includes('ZZ-SIGNATURE-01'))
  } finally {
    // 还原共享的模块级数据：后面的检查（35-nav 等）看到的是干净的仓库状态
    letter.greeting = savedGreeting
    letter.paragraphs = savedParagraphs
    letter.signature = savedSignature
    letter.photoId = savedPhotoId
    all.splice(0, all.length, ...savedPhotos)
  }

  const restored = await render(LETTER, {})
  check('检查跑完后数据已还原（不影响其它检查）',
    restored.includes(savedGreeting) && restored.includes(savedSignature) &&
    savedParagraphs.every((p) => restored.includes(p)))

  // ---------------------------------------------------------------- 段落错开
  const delays = delaysIn(html)
  check('段落每段 +120ms 错开、最多错开 5 段（上限 600ms）',
    delays.length === letter.paragraphs.length &&
    delays.every((d, i) => d === Math.min(i, 5) * 120), delays.join(','))

  // ---------------------------------------------------------------- 404
  const nfSrc = fs.readFileSync(file(ROOT, NOT_FOUND), 'utf8')
  const nfStyle = styleOf(nfSrc)
  const nfTemplate = templateOf(nfSrc)
  const nf = await render(NOT_FOUND, {})
  const nfInner = insideOf(nf, 'class="not-found"', '<footer')

  check('404 有一行大字', /<h1[^>]*class="[^"]*t-h1[^"]*"[^>]*>[^<]+<\/h1>/.test(nf), (nf.match(/<h1[^>]*>[^<]*<\/h1>/) || [])[0])
  check('404 有一句安静的话', nf.includes('也许是链接写错了。'))
  check('404 有回首页的文字链接', nfInner.includes('回到开始') && /<a[^>]*href="\/"/.test(nfInner))
  check('404 只有三段内容（大字 + 一句话 + 一个链接）',
    countOf(nfInner, /<p\b/g) === 2 && countOf(nfInner, /<a\b/g) === 1)
  check('404 不含任何图片元素',
    !/<img|<picture|<svg|<canvas/.test(nf) && !/lazy-image/.test(nf))
  check('404 不含按钮，也不自己写 <img>', !/<button/.test(nf) && !/<img/.test(nfTemplate))
  check('404 在 PageShell 里（导航与页脚齐全，用户走得回去）',
    nf.includes('<header') && nf.includes('<footer'))
  check('404 有文档标题（document.title 不会空着）', nfSrc.includes('title="没有这一页"'))

  discipline('404：', check, nfStyle)
}
