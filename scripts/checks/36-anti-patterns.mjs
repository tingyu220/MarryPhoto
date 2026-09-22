/**
 * 视觉反模式扫描（不依赖浏览器）。
 *
 * docs/02 §10 列了一份"出现任何一条即判不合格"的清单。这份检查把它变成可回归的断言：
 * 直接扫全站 .vue 的源码，而不是等某个人肉眼看出来。
 *
 * 反模式不是"风格偏好"：卡片三件套、彩色胶囊、图标、轮播、渐变、阴影
 * 每一条都会把网站推向"婚庆模板感"，而这个项目存在的意义恰恰是不要那个。
 */
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ check, ROOT }) {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.vue')) files.push(full)
    }
  }
  walk(path.join(ROOT, 'src'))

  check('扫描到了全站组件与页面', files.length >= 15, files.length + ' 个 .vue')

  const violations = { shadow: [], radius: [], hex: [], svg: [], card: [], carousel: [] }

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const source = fs.readFileSync(file, 'utf8')
    const styleBlocks = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    const template = (source.match(/<template>[\s\S]*<\/template>/) || [''])[0]
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

    const style = stripComments(styleBlocks)
    if (/box-shadow\s*:/.test(style)) violations.shadow.push(rel)
    for (const m of style.matchAll(/border-radius\s*:\s*([^;]+);/g)) {
      const value = m[1].trim()
      if (value !== 'var(--r)' && value !== '0' && value !== '50%') violations.radius.push(rel + ' → ' + value)
    }
    if (/#[0-9a-fA-F]{3,8}\b/.test(style)) violations.hex.push(rel)
    if (/<svg/i.test(template)) violations.svg.push(rel)
    if (/class="[^"]*\b(card|panel|badge|chip|pill)\b/i.test(template)) violations.card.push(rel)
    if (/carousel|slider|swiper/i.test(source)) violations.carousel.push(rel)
  }

  const report = (label, list) => {
    const uniq = [...new Set(list)]
    check(label, uniq.length === 0, uniq.length ? uniq.join(' | ') : '无')
  }

  report('没有任何 box-shadow（全站不用阴影表达层级）', violations.shadow)
  report('圆角只用 var(--r) 或 50%（后者仅人物头像）', violations.radius)
  report('样式里没有硬编码 hex 色值（一切颜色走 token）', violations.hex)
  report('模板里没有图标（不出现 <svg>）', violations.svg)
  report('没有卡片 / 胶囊 / 徽章类名', violations.card)
  report('没有轮播 / 幻灯片组件', violations.carousel)

  // 允许清单：全站仅两处刻意例外，且必须仍然存在（防止被"顺手清理"掉）
  const home = fs.readFileSync(path.join(ROOT, 'src/views/HomeView.vue'), 'utf8')
  check('首页首屏的暗角渐变仍然存在（照片上的文字可读性依赖它）',
    /linear-gradient/.test(home) && /hero__veil/.test(home))
  const people = fs.readFileSync(path.join(ROOT, 'src/views/PeopleView.vue'), 'utf8')
  check('人物头像的 50% 圆形裁切仍然存在（全站唯一允许的圆角）', /border-radius:\s*50%/.test(people))
}
