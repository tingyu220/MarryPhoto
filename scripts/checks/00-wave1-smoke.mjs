/**
 * Wave 1 交付组件的最小回归：只要这些组件被改坏，这里立刻变红。
 * 断言刻意保持"契约级"（不是像素级），细节观感由真机走查负责。
 */
export default async function ({ check, render, load, makePhoto, makePhotos, setRoute, resetRoute }) {
  const photo = makePhoto({ description: '妈妈帮姐姐整理衣服', scene: 'preparation' })

  // --- LazyImage ---
  const idle = await render('src/components/common/LazyImage.vue', { photo })
  check('LazyImage 未进入视口时不渲染 img（不发请求）', !idle.includes('<img'), idle.slice(0, 120))
  check('LazyImage 用 aspect-ratio 撑开、用主色打底', idle.includes('aspect-ratio') && idle.includes('#8a7a6d'))

  const eager = await render('src/components/common/LazyImage.vue', { photo, eager: true })
  check('LazyImage eager 直接出图且 fetchpriority=high', eager.includes('<img') && eager.includes('fetchpriority'))
  check('LazyImage alt 回落永不为空', /alt="[^"]+"/.test(eager))

  // --- RevealOnScroll ---
  const reveal = await render('src/components/common/RevealOnScroll.vue', { delay: 120 }, { slot: '<p>x</p>' })
  check('RevealOnScroll 渲染容器与 slot', reveal.includes('reveal') && reveal.includes('<p>x</p>'))

  // --- SiteHeader / SiteFooter / PageShell ---
  const header = await render('src/components/layout/SiteHeader.vue', {})
  check('SiteHeader 渲染出 site.json 里的导航项', header.includes('精选') && header.includes('全部照片'))
  check('SiteHeader 无 logo/图标（不出现 img/svg）', !header.includes('<img') && !header.includes('<svg'))

  const footer = await render('src/components/layout/SiteFooter.vue', {})
  check('SiteFooter 含通往 /letter 的入口', footer.includes('/letter'))

  // 站在那一页时不再显示自链接（否则终点页上会出现一个指向自己的链接）
  setRoute({ path: '/letter' })
  const footerOnLetter = await render('src/components/layout/SiteFooter.vue', {})
  check('SiteFooter 在 /letter 上不显示自链接', !footerOnLetter.includes('href="/letter"'), footerOnLetter.includes('href="/letter"') ? '仍然出现' : '已抑制')
  check('SiteFooter 在 /letter 上仍保留站名与日期', footerOnLetter.includes('Wedding Memory') && footerOnLetter.includes('2026'))
  resetRoute()

  const shell = await render('src/components/layout/PageShell.vue', {}, { slot: '<p>page</p>' })
  check('PageShell 结构 header + main + footer', shell.includes('<header') && shell.includes('<main') && shell.includes('<footer'))
  check('PageShell 渲染 slot 内容', shell.includes('<p>page</p>'))
  check('PageShell main 用 --header-h 还回导航高度', shell.includes('--header-h') || shell.includes('page-shell__main'))

  // --- 全屏查看器 ---
  const viewer = load('src/composables/usePhotoViewer.ts')
  check('usePhotoViewer 导出冻结签名', typeof viewer.usePhotoViewer === 'function')
  const state = viewer.usePhotoViewer()
  check('usePhotoViewer 有 open/close/next/prev',
    ['open', 'close', 'next', 'prev'].every((k) => typeof state[k] === 'function'))

  const list = makePhotos(3)
  state.open(list, 1)
  check('open() 后 isOpen=true 且 index=1', state.isOpen.value === true && state.index.value === 1)
  check('current 指向第 2 张', state.current.value && state.current.value.id === 'P0002')
  state.close()
  check('close() 后 isOpen=false', state.isOpen.value === false)

  // 查看器 UI 层常驻 DOM、靠 opacity 显隐（设计如此），
  // 所以断言"隐藏态是否对辅助技术不可见 + 打开态是否出现计数"，而不是"节点是否存在"
  const closedHtml = await render('src/components/photo/PhotoViewer.vue', {})
  check('PhotoViewer 关闭时 UI 层对辅助技术隐藏', closedHtml.includes('is-ui-hidden') && closedHtml.includes('aria-hidden="true"'))

  state.open(list, 1)
  const openHtml = await render('src/components/photo/PhotoViewer.vue', {})
  check('PhotoViewer 打开时显示 2 / 3', openHtml.includes('viewer-ui__counter') && openHtml.includes('2 / 3'))
  check('PhotoViewer 打开时不再是隐藏态', !openHtml.includes('is-ui-hidden'))
  state.close()
}
