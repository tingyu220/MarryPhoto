/**
 * 导航完整性：site.json 里的每一个入口，都必须真的有路由、有页面、能渲染。
 * 这条检查防的是"导航栏有个点进去 404 的链接"这种上线才发现的问题。
 */
export default async function ({ check, render, load }) {
  const site = load('src/data/site.json')
  const routerMod = load('src/router/index.ts')
  const routes = routerMod.routes ?? []
  const paths = new Set(routes.map((r) => r.path))

  check('site.json 有导航定义', Array.isArray(site.nav) && site.nav.length > 0, site.nav.map((n) => n.label).join(' / '))

  for (const item of site.nav) {
    check('导航「' + item.label + '」指向已注册路由 ' + item.to, paths.has(item.to))
  }

  // 首页与那封信必须可达（它们不在导航高亮里，但必须是真路由）
  check('首页路由存在', paths.has('/'))
  check('写给姐姐路由存在', paths.has('/letter'))
  check('404 兜底路由存在', Array.from(paths).some((p) => p.includes('pathMatch')))

  // 每个页面都能被独立渲染（不抛错、有内容）
  const views = [
    ['/', 'src/views/HomeView.vue'],
    ['/featured', 'src/views/FeaturedView.vue'],
    ['/story', 'src/views/StoryView.vue'],
    ['/gallery', 'src/views/GalleryView.vue'],
    ['/people', 'src/views/PeopleView.vue'],
    ['/moments', 'src/views/MomentsView.vue'],
    ['/letter', 'src/views/LetterView.vue']
  ]
  for (const [routePath, file] of views) {
    try {
      const html = await render(file, {})
      check('页面 ' + routePath + ' 能渲染且非空', typeof html === 'string' && html.trim().length > 40, html.trim().length + ' 字符')
    } catch (err) {
      check('页面 ' + routePath + ' 能渲染且非空', false, String(err && err.message ? err.message : err))
    }
  }
}
