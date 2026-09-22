/**
 * 全部照片页：筛选行 + 四种浏览方式的切换 + 空状态 + 全站唯一查看器挂载点。
 */
export default async function ({ check, skip, render, load }) {
  // --- 应用外壳：全站只有一个 PhotoViewer ---
  const app = await render('src/App.vue', {})
  check('App 外壳挂载了全屏查看器', app.includes('viewer-host'))
  check('App 外壳只挂一个查看器实例', (app.match(/viewer-host/g) || []).length === 1)

  // --- Gallery ---
  const html = await render('src/views/GalleryView.vue', {})

  check('Gallery 有页面标题', html.includes('全部照片'))
  check('Gallery 显示照片张数', /\d+\s*张/.test(html))
  check('Gallery 有筛选行', html.includes('filters__item') && html.includes('全部'))
  check('Gallery 有四种浏览方式', ['瀑布流', '联系表', '胶片', '时间线'].every((l) => html.includes(l)))
  check('默认是瀑布流（masonry 组件已渲染）', html.includes('masonry'))
  check('默认不同时渲染其它三种模式',
    !html.includes('contact-sheet') && !html.includes('film__') && !html.includes('timeline__'))
  check('筛选与模式都是 button（不是胶囊标签 / 下拉框）',
    !html.includes('<select') && html.includes('type="button"'))

  // --- 空状态：直接给组件喂空数组 ---
  const emptyMasonry = await render('src/components/photo/PhotoMasonry.vue', { photos: [] })
  check('瀑布流空数组不崩且不渲染图片', emptyMasonry.length > 0 && !emptyMasonry.includes('<img'))

  // --- taxonomy 是唯一分类来源 ---
  const tax = load('src/data/taxonomy.ts')
  check('词表口径：Gallery 用的筛选来自 taxonomy.FILTERS',
    Array.isArray(tax.FILTERS) && tax.FILTERS.some((f) => f.id === 'all'))
  check('词表口径：浏览方式来自 taxonomy.GALLERY_VIEWS',
    tax.GALLERY_VIEWS.length === 4 && tax.GALLERY_VIEWS.map((v) => v.id).join() === 'masonry,contact,film,timeline')

  // --- 数据层：筛选谓词真的在过滤 ---
  const { usePhotos } = load('src/composables/usePhotos.ts')
  const source = usePhotos()
  const all = source.all.value
  check('数据源已加载照片', all.length > 0, 'total=' + all.length)
  check('featured 非空且是真子集', source.featured.value.length > 0 && source.featured.value.length < all.length)
  check('按 order 升序', all.every((p, i) => i === 0 || all[i - 1].order <= p.order))
  const tagPredicate = tax.FILTERS.find((f) => f.id === 'candid')
  const hit = all.filter(tagPredicate.match)
  if (hit.length === 0) skip('抓拍筛选命中数少于全部', '还没有任何标了 candid 标签的照片')
  else check('抓拍筛选命中数少于全部', hit.length < all.length, 'candid=' + hit.length)
}
