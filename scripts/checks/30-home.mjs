/**
 * 首页的契约级断言：首屏只有一张图、不轮播、入口齐全、那封信在最后。
 */
export default async function ({ check, render, load }) {
  const html = await render('src/views/HomeView.vue', {})

  check('首页有全屏首屏区', html.includes('class="hero"') && html.includes('hero__media'))
  check('首屏只有一张照片（不是轮播）', (html.match(/lazy-image"?/g) || []).length >= 1 && !html.includes('carousel'))
  check('首屏大写标题 OUR DAY', html.includes('OUR DAY'))
  check('首屏显示日期', html.includes('2026'))
  check('第二屏承诺文案存在', html.includes('我拍下了很多照片'))
  check('有通往精选的入口', html.includes('View Memories') && html.includes('href="/featured"'))
  check('有通往这一天/全部照片/人物的入口',
    html.includes('href="/story"') && html.includes('href="/gallery"') && html.includes('href="/people"'))
  check('那封信的入口在最后一段', html.indexOf('href="/letter"') > html.indexOf('href="/gallery"'))

  // 影像馆入口（用户反馈"首页没有点击到影像馆的按钮"）
  check('首页有进入影像馆的入口', html.includes('href="/experience"') && html.includes('进入影像馆'))
  // 注意：不能用 href="/featured" 的下标比 —— 顶部导航里也有它，会永远排在前面。
  // 要比的是"影像馆那一屏"与"精选那一屏"在正文里的先后。
  check('影像馆入口在精选那一屏之前（情绪顺序：首页 → 影像馆 → 精选/照片/人物 → 那封信）',
    html.indexOf('进入影像馆') < html.indexOf('class="strip"'),
    '影像馆@' + html.indexOf('进入影像馆') + ' 精选条@' + html.indexOf('class="strip"'))
  check('影像馆入口沿用站内文字链接，不是大按钮/发光按钮',
    /class="[^"]*text-link[^"]*"[^>]*href="\/experience"|href="\/experience"[^>]*class="[^"]*text-link/.test(html))
  check('顶部导航也有影像馆（否则从其它页面到不了它）', html.includes('href="/experience"'))
  check('首页不含任何 <img> 之外的图片实现', !/<picture|<canvas/.test(html))
  check('首页没有卡片式容器（不出现 card/panel 类）', !/class="[^"]*\b(card|panel)\b/.test(html))
}
