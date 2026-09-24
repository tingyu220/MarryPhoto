import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

/**
 * 路由表。冻结于 Wave 0；只有总控可以修改本文件。
 * Gallery 的四种浏览模式是 /gallery 下的视图切换（?view=masonry|contact|film|timeline），
 * 不是独立路由 —— 它们看的是同一批数据。
 */
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { title: 'OUR DAY' } },
  { path: '/featured', name: 'featured', component: () => import('@/views/FeaturedView.vue'), meta: { title: '精选' } },
  { path: '/story', name: 'story', component: () => import('@/views/StoryView.vue'), meta: { title: '这一天' } },
  { path: '/gallery', name: 'gallery', component: () => import('@/views/GalleryView.vue'), meta: { title: '全部照片' } },
  { path: '/people', name: 'people', component: () => import('@/views/PeopleView.vue'), meta: { title: '人物' } },
  { path: '/moments', name: 'moments', component: () => import('@/views/MomentsView.vue'), meta: { title: '瞬间' } },
  { path: '/letter', name: 'letter', component: () => import('@/views/LetterView.vue'), meta: { title: '写给姐姐' } },
  // 影像馆是独立页面，不是 /gallery 的一种浏览模式：它看的是同一批照片，但换了一种空间。
  { path: '/experience', name: 'experience', component: () => import('@/views/ExperienceView.vue'), meta: { title: '影像馆' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') }
]

export const router = createRouter({
  // 必须传 import.meta.env.BASE_URL：部署到 GitHub Pages 项目站点时 base 是 /<仓库名>/，
  // 传空的话路由会按根路径解析，所有链接都会 404。
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    // 切换浏览模式（同一路由不同 query）时不重置滚动位置
    if (to.path === from.path) return false
    return { top: 0 }
  }
})
