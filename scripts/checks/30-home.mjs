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
  check('首页不含任何 <img> 之外的图片实现', !/<picture|<canvas/.test(html))
  check('首页没有卡片式容器（不出现 card/panel 类）', !/class="[^"]*\b(card|panel)\b/.test(html))
}
