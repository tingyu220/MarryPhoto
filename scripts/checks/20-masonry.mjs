/**
 * PhotoMasonry（Wave 2-E）的契约级断言。
 *
 * 覆盖：空数组 / 1 张 / 多种比例混合 / columns 而非 grid / 列数断点 /
 *       键盘可达 / 点击交给查看器的下标 / 错开上限 / token 纪律 / 无 JS 布局。
 *
 * 说明：SSR 不执行 onMounted、IntersectionObserver 与手势，也**不会**输出 <style>，
 * 所以"用什么 CSS"这类断言直接读组件源码（.vue 的 <style> 块），
 * "渲染出什么 DOM"这类断言读 render() 的 HTML。两者合起来才是这个组件的全貌。
 */
import fs from 'node:fs'
import path from 'node:path'

const SFC = 'src/components/photo/PhotoMasonry.vue'

export default async function ({ check, render, load, makePhoto, makePhotos, ROOT }) {
  // ------------------------------------------------------------------ 源码
  const src = fs.readFileSync(path.join(ROOT, SFC), 'utf8')
  const style = (src.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1] || ''
  const template = (src.match(/<template>([\s\S]*)<\/template>/) || [])[1] || ''

  // --- 冻结契约：只有一个 prop ---
  const comp = load(SFC)
  check('只有 photos 一个 prop', JSON.stringify(Object.keys(comp.props || {})) === '["photos"]',
    JSON.stringify(Object.keys(comp.props || {})))
  check('点击调用 usePhotoViewer().open(props.photos, index)',
    /viewer\.open\(props\.photos,\s*index\)/.test(src))
  check('不自读 JSON、不 import 其它浏览模式组件',
    !/@\/data\//.test(src) && !/Photo(ContactSheet|Film|Timeline)/.test(src))
  check('不自己写 <img>，图片一律交给 LazyImage',
    !/<img/.test(template) && /<LazyImage[^>]*size="thumb"/.test(src))
  check('组件不监听任何事件/不测尺寸（无 JS 布局）',
    !/addEventListener/.test(src) && !/getBoundingClientRect/.test(src) && !/\bwindow\./.test(src))

  // --- 布局：CSS columns，不是 grid，也不是 JS masonry ---
  check('用 CSS columns 排布（column-count 由 columns 简写给出）', /columns:\s*\d/.test(style) && /column-gap:\s*var\(--s-/.test(style))
  check('没有用 grid / float / 绝对定位做瀑布流',
    !/display:\s*grid/.test(style) && !/grid-template-columns/.test(style) && !/float:/.test(style) && !/position:\s*absolute/.test(style))
  check('列项目 break-inside: avoid（否则竖图会被劈成两半）', /break-inside:\s*avoid/.test(style))
  check('移动端 2 列', /columns:\s*2\b/.test(style))
  check('≥768px 3 列', /@media \(min-width: 768px\)[\s\S]*?columns:\s*3\b/.test(style))
  check('≥1280px 4 列', /@media \(min-width: 1280px\)[\s\S]*?columns:\s*4\b/.test(style))
  check('列间距只用 --s-* token', (style.match(/column-gap:\s*([^;]+);/g) || [])
    .every((d) => /var\(--s-\d+\)/.test(d)))

  // --- 视觉纪律：零圆角 / 无阴影 / 无硬编码色值 ---
  check('没有 box-shadow', !/box-shadow/.test(style))
  check('圆角只允许 var(--r)', !/border-radius:\s*(?![^;]*var\()/.test(style))
  check('没有硬编码色值（#hex / rgb / hsl / 具名色）',
    !/#[0-9a-fA-F]{3,8}\b/.test(style) && !/\b(rgba?|hsla?)\(/.test(style))
  check('焦点轮廓用 token 的 accent 色', /outline:[^;]*var\(--c-accent\)/.test(style))
  // 注释里的 "≥768px" 只是说明文字，不是声明：先去掉注释与媒体查询断点再数 px
  const css = style.replace(/\/\*[\s\S]*?\*\//g, '').replace(/min-width:\s*\d+px/g, '')
  const pxOutsideMedia = css.match(/[\d.]+px/g) || []
  check('px 只出现在 1px 描边 / 2px offset', pxOutsideMedia.every((v) => v === '1px' || v === '2px'),
    pxOutsideMedia.join(','))

  // ------------------------------------------------------------- 空数组
  const emptyRaw = await render(SFC, { photos: [] })
  // SSR 会把模板注释也输出成 <!-- -->，去注释后再断言可见内容
  const empty = emptyRaw.replace(/<!--[\s\S]*?-->/g, '')
  check('空数组：不渲染任何照片', !empty.includes('lazy-image') && !empty.includes('masonry__item'))
  check('空数组：给出一行安静的空状态文案', empty.includes('masonry__empty') && empty.includes('这一类别还没有照片'))
  check('空数组：不越权渲染筛选器（"返回全部"属于 Gallery）', !empty.includes('返回全部') && !/<a\b/.test(empty))
  check('空数组：容器与 class 仍在（不塌成 undefined）', empty.includes('class="masonry"'))

  // ------------------------------------------------------------- 1 张
  const portrait = makePhoto({ id: 'P0001', width: 1200, height: 1600, ratio: 0.75, color: '#8a7a6d' })
  const one = await render(SFC, { photos: [portrait] })
  check('1 张：恰好 1 个 LazyImage', (one.match(/class="lazy-image[^"]*"/g) || []).length === 1)
  check('1 张：恰好 1 个可聚焦按钮热区', (one.match(/<button type="button"/g) || []).length === 1)
  check('1 张：保持原始比例（1200 / 1600，不强制裁切）', one.includes('aspect-ratio:1200 / 1600'))
  check('1 张：不显示任何计数（计数属于查看器）', !/\b1\s*\/\s*1\b/.test(one))
  check('1 张：第一张不延迟出现', one.includes('transition-delay:0ms'))

  // ------------------------------------------------- 多种比例混合 + 顺序
  const mixed = [
    makePhoto({ id: 'P0001', width: 1200, height: 1600, ratio: 0.75 }), // 竖
    makePhoto({ id: 'P0002', width: 2048, height: 1365, ratio: 1.5 }),  // 横
    makePhoto({ id: 'P0003', width: 1500, height: 1500, ratio: 1 }),   // 方
    makePhoto({ id: 'P0004', width: 1080, height: 1920, ratio: 0.5625 }), // 手机竖
    makePhoto({ id: 'P0005', width: 3000, height: 1200, ratio: 2.5 })  // 全景
  ]
  const html = await render(SFC, { photos: mixed })
  const rendered = html.match(/class="lazy-image[^"]*"/g) || []
  const ratios = (html.match(/aspect-ratio:[^;"]+/g) || []).map((s) => s.replace('aspect-ratio:', ''))
  const ids = (html.match(/data-photo-id="([^"]+)"/g) || []).map((s) => s.replace(/data-photo-id="|"/g, ''))
  check('混合比例：5 张就渲染 5 个 LazyImage（全部用 thumb）', rendered.length === 5, 'got ' + rendered.length)
  check('混合比例：每张都有 aspect-ratio（杜绝 CLS）', ratios.length === 5, 'got ' + ratios.length)
  check('混合比例：5 个比例互不相同，横竖方自然混排',
    new Set(ratios).size === 5, ratios.join(' | '))
  check('混合比例：颜色占位来自 photo.color', (html.match(/background-color:#8a7a6d/g) || []).length === 5)
  check('DOM 顺序 === 数组顺序（时间顺序；CSS columns 的视觉填充顺序是另一回事）',
    ids.join(',') === mixed.map((p) => p.id).join(','), ids.join(','))
  check('每张图都是 <button type="button">（键盘可达）',
    (html.match(/<button type="button"/g) || []).length === 5)
  check('按钮里没有多余的可访问名（名字来自 LazyImage 的 alt）', !/aria-label=/.test(html))
  check('渲染结果里没有 grid / card / panel 类',
    !/\b(grid|card|panel|badge|chip)\b/.test(html))

  // ------------------------------------------------------------- 错开上限
  const many = await render(SFC, { photos: makePhotos(8) })
  const delays = (many.match(/transition-delay:(\d+)ms/g) || []).map((s) => Number(s.replace(/\D/g, '')))
  check('出场错开 60～80ms 一档', delays.slice(0, 6).join(',') === '0,70,140,210,280,350', delays.slice(0, 6).join(','))
  check('同屏最多错开 6 项（第 7 张回到 0ms）', delays.length === 8 && delays[6] === 0 && delays[7] === 70, delays.join(','))

  // ------------------------------------------- 点击：index 是原数组下标
  try {
    const viewerMod = load('src/composables/usePhotoViewer.ts')
    const state = viewerMod.usePhotoViewer()
    const list = makePhotos(6)
    const inst = comp.setup({ photos: list }, { expose() {}, emit() {}, attrs: {}, slots: {} })
    const buttons = []
    const walk = (n) => {
      if (n === null || n === undefined || typeof n !== 'object') return
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (n.type === 'button') buttons.push(n)
      const ch = n.children
      if (Array.isArray(ch)) walk(ch)
      else if (ch && typeof ch === 'object' && typeof ch.default === 'function') walk(ch.default())
    }
    walk(inst({}, []))
    check('6 张对应 6 个按钮热区', buttons.length === 6, 'got ' + buttons.length)
    buttons[4].props.onClick()
    check('点第 5 张 → 查看器 index=4', state.index.value === 4)
    check('查看器拿到的是完整数组（不切片、不重排）',
      state.photos.value.length === 6 && state.current.value && state.current.value.id === 'P0005',
      state.current.value && state.current.value.id)
    state.close()
    check('关闭后查看器状态复位（不污染其它检查）', state.isOpen.value === false)
  } catch (err) {
    check('点击交互可从编译后的 setup 中触发', false, String(err && err.message))
  }
}
