/**
 * 中图（medium）档的契约级断言（Wave 4 - L）。
 *
 * 为什么要多这一档：桌面端画册版面里的槽位是 540~880px，而 thumb 的长边只有 480px
 * （竖构图的 thumb 实际只有 320px 宽）—— 把缩略图拉到 880px 就是 1.8~2 倍的插值放大，
 * 照片会明显发虚。medium 补上 1280px：不再放大，也不必为 900px 的槽位下载 2048px 大图。
 *
 * 断言分四组：
 *   1. 类型与生成物：PhotoTech 有 medium、photos.json 每条都有、产物文件真的在磁盘上；
 *   2. 产物本身：medium 长边 = min(1280, preview 长边)，严格大于 thumb；
 *   3. 组件：LazyImage 认 size="medium"，缺省仍是 thumb，根元素仍是 <span>；
 *   4. 版面：从 SSR 实例树里取出真实传下去的 size ——
 *      Featured 的 pair/wide/offset=medium、full/single=preview；
 *      Story 的 --lead=preview、其余=medium；Moments=medium。
 *
 * 关于第 4 组为什么不是断 HTML 字符串：LazyImage 未进入视口时 SSR 里连 <img> 都不渲染
 * （视口外不发请求是它的契约），所以"用了哪一档"只能从 vnode.props.size 上读。
 */
import fs from 'node:fs'
import path from 'node:path'
import { load as loadRaw, renderToString, vue } from '../lib/render.mjs'

const LAZY_IMAGE = 'src/components/common/LazyImage.vue'

/** 取 <template> 段（到 <style> 为止）：样式里也有 fb--xxx 这类类名，不能混进来 */
function templateOf(source) {
  const start = source.indexOf('<template>')
  const end = source.indexOf('<style')
  return source.slice(start, end === -1 ? undefined : end)
}

/** 按版面标记切出"这一块"的模板片段：从 fb--<kind> 起，到下一个其它版面标记为止 */
function blockChunk(template, kind, allKinds) {
  const start = template.indexOf('fb--' + kind)
  if (start === -1) return ''
  const rest = template.slice(start)
  const ends = allKinds
    .filter((other) => other !== kind)
    .map((other) => rest.indexOf('fb--' + other, 1))
    .filter((index) => index > 0)
  return rest.slice(0, ends.length ? Math.min(...ends) : rest.length)
}

/** 片段里的 LazyImage 标签（取到 ">" 为止） */
function lazyImageTags(chunk) {
  return Array.from(chunk.matchAll(/<LazyImage\b[^>]*>/g)).map((match) => match[0])
}

/** 遍历 vnode 树（含组件子树的渲染结果） */
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
 * 在 SSR 里挂载一个 SFC 并留下根 vnode（SSR 不写 app._instance，只能自己抓根 vnode），
 * 返回 { html, root }。
 */
async function mount(Component, props) {
  let root = null
  const app = vue.createSSRApp({
    render: () => {
      root = vue.h(Component, props)
      return root
    }
  })
  // RouterLink 垫片：页面底部有 <RouterLink>，不注册会在 stderr 打一堆无关警告
  app.component(
    'RouterLink',
    vue.defineComponent({
      name: 'RouterLink',
      props: { to: { type: [String, Object], required: true } },
      setup(props, { slots, attrs }) {
        const to = typeof props.to === 'string' ? props.to : props.to?.path ?? '/'
        return () => vue.h('a', { href: to, ...attrs }, slots.default ? slots.default() : [])
      }
    })
  )
  const html = await renderToString(app)
  return { html, root }
}

export default async function ({ check, skip, render, load, makePhoto, ROOT }) {
  const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
  const LazyImage = loadRaw(path.join(ROOT, LAZY_IMAGE))

  /** 渲染一个页面，取出它真正传给 LazyImage 的 size 列表（按渲染顺序） */
  async function sizesOf(relative, props = {}) {
    const Component = loadRaw(path.join(ROOT, relative))
    const mounted = await mount(Component, props)
    const sizes = []
    walk(mounted.root?.component ? mounted.root.component.subTree : null, (vnode) => {
      if (vnode.type === LazyImage) sizes.push(vnode.props?.size)
    })
    return { html: mounted.html, sizes }
  }

  // ───────────────────────── 1. 类型与生成物 ─────────────────────────

  const typeSource = read('src/types/photo.ts')
  const techBlock = /interface PhotoTech \{([\s\S]*?)\n\}/.exec(typeSource)?.[1] ?? ''
  const iThumb = techBlock.indexOf('thumb: string')
  const iMedium = techBlock.indexOf('medium: string')
  const iBlur = techBlock.indexOf('blur: string')
  check('PhotoTech 声明了 medium: string，且排在 thumb 之后、blur 之前',
    iThumb !== -1 && iMedium !== -1 && iBlur !== -1 && iThumb < iMedium && iMedium < iBlur,
    'thumb@' + iThumb + ' medium@' + iMedium + ' blur@' + iBlur)
  const mediumDoc = techBlock.slice(0, iMedium).split('/**').pop() ?? ''
  check('medium 的注释写清了规格与用途（长边 1280px + 桌面端中等尺寸展示）',
    iMedium !== -1 && /1280px/.test(mediumDoc) && /桌面端/.test(mediumDoc),
    mediumDoc.replace(/\s+/g, ' ').trim().slice(0, 80))

  const payload = load('src/data/photos.json')
  const photos = Array.isArray(payload?.photos) ? payload.photos : []
  check('photos.json 每张照片都有 medium，且指向 /photos/medium/<id>.webp',
    photos.length > 0 && photos.every((p) => p.medium === '/photos/medium/' + p.id + '.webp'),
    '共 ' + photos.length + ' 张，首条=' + JSON.stringify(photos[0]?.medium))

  const mediumDir = path.join(ROOT, 'public', 'photos', 'medium')
  const mediumFiles = fs.existsSync(mediumDir) ? fs.readdirSync(mediumDir).filter((f) => f.endsWith('.webp')) : []
  check('public/photos/medium/ 的产物数量与照片数一致',
    photos.length > 0 && mediumFiles.length === photos.length,
    'medium=' + mediumFiles.length + ' photos=' + photos.length)

  // 抽查：首 / 尾 / 中段 / 37% 处各一个 id，不只看目录计数
  const sampled = photos.length
    ? [photos[0], photos[Math.floor(photos.length * 0.25)], photos[Math.floor(photos.length * 0.37)], photos[photos.length - 1]]
    : []
  const missing = sampled.filter((p) => {
    const file = path.join(mediumDir, p.id + '.webp')
    return !fs.existsSync(file) || fs.statSync(file).size === 0
  })
  check('抽查 4 个 id 的 medium 产物真实存在且非空',
    sampled.length === 4 && missing.length === 0,
    missing.length ? '缺失：' + missing.map((p) => p.id).join('、') : sampled.map((p) => p.id).join('、'))

  // 反向抽查：medium 目录里的文件必须都能对上 photos.json（没有孤儿产物）
  const idSet = new Set(photos.map((p) => p.id))
  const orphans = mediumFiles.filter((f) => !idSet.has(f.replace(/\.webp$/, '')))
  check('medium 目录里没有 photos.json 之外的孤儿产物', orphans.length === 0,
    orphans.slice(0, 5).join('、') || '无')

  // ───────────────────────── 2. 产物像素：1280 且不放大 ─────────────────────────

  const sharp = (await import('sharp')).default
  const shape = []
  for (const photo of sampled) {
    const medium = await sharp(path.join(mediumDir, photo.id + '.webp')).metadata()
    const preview = await sharp(path.join(ROOT, 'public', 'photos', 'preview', photo.id + '.webp')).metadata()
    const thumb = await sharp(path.join(ROOT, 'public', 'photos', 'thumb', photo.id + '.webp')).metadata()
    shape.push({
      id: photo.id,
      medium: Math.max(medium.width ?? 0, medium.height ?? 0),
      preview: Math.max(preview.width ?? 0, preview.height ?? 0),
      thumb: Math.max(thumb.width ?? 0, thumb.height ?? 0)
    })
  }
  check('medium 长边 = min(1280, preview 长边)（不放大，与 thumb/preview 同一条规则）',
    shape.length === 4 && shape.every((s) => s.medium === Math.min(1280, s.preview)),
    shape.map((s) => s.id + ' thumb' + s.thumb + '/medium' + s.medium + '/preview' + s.preview).join('  '))
  check('medium 严格大于 thumb（否则这一档没有意义）',
    shape.length === 4 && shape.every((s) => s.medium > s.thumb))
  check('medium 不大于 preview（不许比全屏大图还大）',
    shape.length === 4 && shape.every((s) => s.medium <= s.preview))

  // ───────────────────────── 3. 组件：LazyImage 认 medium ─────────────────────────

  const withMedium = { ...makePhoto(), medium: '/photos/medium/P0001.webp' }
  const asMedium = await render(LAZY_IMAGE, { photo: withMedium, size: 'medium', eager: true })
  check('LazyImage size="medium" 取的是 photo.medium',
    asMedium.includes('/photos/medium/P0001.webp') &&
      !asMedium.includes('/photos/thumb/P0001.webp') && !asMedium.includes('/photos/preview/P0001.webp'),
    (asMedium.match(/src="[^"]*"/g) ?? []).join(' '))

  const asDefault = await render(LAZY_IMAGE, { photo: withMedium, eager: true })
  check('LazyImage 缺省仍是 thumb（列表不会悄悄变重）',
    asDefault.includes('/photos/thumb/P0001.webp') && !asDefault.includes('/photos/medium/P0001.webp'))
  check('LazyImage 根元素仍是 <span>（要放进 <button>，不能用 <div>）',
    /^<span[\s>]/.test(asDefault.trimStart()) && !/^<div[\s>]/.test(asDefault.trimStart()),
    asDefault.trimStart().slice(0, 40))

  const realPhoto = photos[0]
  const asReal = await render(LAZY_IMAGE, { photo: realPhoto, size: 'medium', eager: true })
  check('拿真实 photos.json 的记录渲染 size="medium"，出来的是 /photos/medium/ 真路径',
    realPhoto !== undefined && asReal.includes('/photos/medium/' + realPhoto.id + '.webp'))

  // ───────────────────────── 4. 版面：谁用哪一档 ─────────────────────────

  // ---- Featured：源码层面逐块断（版面是模板写的，块与档位一一对应）----
  const KINDS = ['full', 'single', 'pair', 'wide', 'offset']
  const featuredTemplate = templateOf(read('src/views/FeaturedView.vue'))
  const chunks = {}
  for (const kind of KINDS) chunks[kind] = blockChunk(featuredTemplate, kind, KINDS)

  check('Featured 的 pair / wide / offset 三种版面都用 size="medium"',
    ['pair', 'wide', 'offset'].every((kind) => {
      const tags = lazyImageTags(chunks[kind])
      return tags.length > 0 && tags.every((tag) => /size="medium"/.test(tag))
    }),
    ['pair', 'wide', 'offset'].map((k) => k + '=' + lazyImageTags(chunks[k]).length + 'img').join(' '))
  check('Featured 的这三种版面没有一张落回 thumb（每张都显式写了档位）',
    ['pair', 'wide', 'offset'].every((kind) => {
      const tags = lazyImageTags(chunks[kind])
      return tags.length > 0 && tags.every((tag) => /size="(medium|preview)"/.test(tag))
    }))
  check('Featured 的 full / single 仍然是 size="preview"（满幅出血与整幅版心）',
    ['full', 'single'].every((kind) => {
      const tags = lazyImageTags(chunks[kind])
      return tags.length > 0 && tags.every((tag) => /size="preview"/.test(tag))
    }),
    ['full', 'single'].map((k) => k + '=' + (lazyImageTags(chunks[k])[0] ?? '无')).join(' '))

  const featured = await sizesOf('src/views/FeaturedView.vue', {})
  const featuredMedium = featured.sizes.filter((s) => s === 'medium').length
  const featuredPreview = featured.sizes.filter((s) => s === 'preview').length
  check('Featured 真渲染：每张图都显式指定了 medium 或 preview（没有缺省成 thumb 的）',
    featured.sizes.length > 0 && featured.sizes.every((s) => s === 'medium' || s === 'preview'),
    'sizes=' + JSON.stringify(featured.sizes.slice(0, 12)) + ' 共 ' + featured.sizes.length + ' 张')
  check('Featured 真渲染：medium 占多数、preview 只留给 full/single',
    featuredMedium > 0 && featuredPreview > 0 && featuredPreview < featuredMedium,
    'medium=' + featuredMedium + ' preview=' + featuredPreview)

  // ---- Story：第一张是 --lead（preview），其余全是 medium ----
  const storySource = read('src/views/StoryView.vue')
  const storyTemplate = templateOf(storySource)
  const leadAt = storyTemplate.indexOf('story__shot--lead')
  const firstPreviewAt = storyTemplate.search(/<LazyImage[^>]*size="preview"/)
  check('Story 的 --lead 那张用的是 preview（整幅版心的大图）',
    leadAt !== -1 && firstPreviewAt > leadAt)

  // 每一章都有自己的 --lead，所以 preview 的数量应当等于"章节图块"的数量
  const story = await sizesOf('src/views/StoryView.vue', {})
  const leadCount = (story.html.match(/story__shot--lead/g) ?? []).length
  const storyPreviews = story.sizes.filter((s) => s === 'preview').length
  const storyMediums = story.sizes.filter((s) => s === 'medium').length
  check('Story 真渲染：除了每章的 --lead，其余全部是 medium（没有一张落回 thumb）',
    story.sizes.length >= 2 && story.sizes[0] === 'preview' &&
      storyPreviews + storyMediums === story.sizes.length && storyMediums > 0,
    'preview=' + storyPreviews + ' medium=' + storyMediums + ' 共 ' + story.sizes.length + ' 张')
  check('Story 真渲染：preview 的张数恰好等于 --lead 的块数（每章只有一张大图）',
    leadCount > 0 && storyPreviews === leadCount, 'lead 块=' + leadCount + ' preview=' + storyPreviews)

  // ---- Moments：整页都是 medium ----
  const moments = await sizesOf('src/views/MomentsView.vue', {})
  if (moments.sizes.length === 0) skip('Moments 真渲染：每一张都是 medium（620px 的槽位不需要 2048px 的 preview）', '还没有标任何 moment: true 的照片')
  else check('Moments 真渲染：每一张都是 medium（620px 的槽位不需要 2048px 的 preview）',
    moments.sizes.every((s) => s === 'medium'),
    moments.sizes.length + ' 张，档位=' + JSON.stringify([...new Set(moments.sizes)]))
  check('Moments 不再直接请求 preview（点开查看器时由查看器自己取 preview）',
    !/size="preview"/.test(templateOf(read('src/views/MomentsView.vue'))))
}
