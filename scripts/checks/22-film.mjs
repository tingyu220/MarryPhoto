/**
 * 22 · 胶片 Film（docs/01 §7.6）的契约级检查（Wave 2-G）。
 *
 * SSR 不执行 onMounted / IntersectionObserver / 键盘 / 滚动，
 * 因此这里断言两件事：
 *   1) 真编译真渲染出来的 DOM 与类名（数据形态、编号时间格式、缺失行的取舍）；
 *   2) 源码里的硬约束（唯一 prop、preventDefault、tokens-only 的样式、不越界 import）。
 * 手势、滚动落点、真实的提前加载时机只能真机走查。
 */
import fs from 'node:fs'
import path from 'node:path'

const FILE = 'src/components/photo/PhotoFilm.vue'

export default async function ({ check, render, load, makePhoto, makePhotos, ROOT }) {
  const source = fs.readFileSync(path.join(ROOT, FILE), 'utf8')
  const style = source.slice(source.indexOf('<style'))

  // ---------- 契约：只有一个 prop ----------
  const component = load(FILE)
  check(
    'PhotoFilm 的 prop 只有 photos',
    JSON.stringify(Object.keys(component.props ?? {})) === '["photos"]',
    JSON.stringify(Object.keys(component.props ?? {}))
  )
  check('点击走 usePhotoViewer().open(props.photos, index)', /open\(\s*props\.photos\s*,\s*index\s*\)/.test(source))
  check(
    '不 import 其它浏览模式，也不自己读 JSON',
    !/PhotoMasonry|PhotoContact|PhotoTimeline/.test(source) && !/\.json/.test(source)
  )

  // ---------- 空数组 ----------
  const empty = await render(FILE, { photos: [] })
  check('空数组不渲染任何帧', !empty.includes('film__frame'))
  check('空数组渲染一行安静的空态，不画框', empty.includes('film__empty') && empty.includes('这一类别还没有照片'))
  check('空数组 DOM 里没有 <img>（一个请求都不发）', !empty.includes('<img'))

  // ---------- 单张：不出现冗余计数 ----------
  const one = await render(FILE, { photos: [makePhoto({ order: 1, description: '化妆开始' })] })
  check('单张只渲染一帧', (one.match(/data-film-index/g) ?? []).length === 1)
  check('单张不出现「1 / 1」这类冗余计数', !/>\s*\d+\s*\/\s*\d+\s*</.test(one))
  check('单张也有编号 + 时间 + 描述', one.includes('film__no') && one.includes('film__time') && one.includes('film__desc'))
  check('大图 alt 非空且优先用描述（与 LazyImage 一致）', one.includes('alt="化妆开始"'))
  check('每张照片是一个真 button（可点、可回车）', (one.match(/<button type="button"/g) ?? []).length === 1)

  // ---------- 一屏一张 + 不一次性加载全部大图 ----------
  const three = await render(FILE, { photos: makePhotos(3) })
  check('3 张渲染 3 帧且顺序与 props 一致', three.indexOf('data-film-index="0"') < three.indexOf('data-film-index="1"') && three.indexOf('data-film-index="1"') < three.indexOf('data-film-index="2"'))
  check('用 ol/li 表达「一组按顺序看的照片」', three.includes('<ol') && three.includes('<li'))
  check(
    '只有首屏那一张出 <img>：其余帧在 DOM 里连标签都没有（不预载全部大图）',
    (three.match(/photos\/preview\//g) ?? []).length === 1 && (three.match(/<img/g) ?? []).length === 2,
    'preview=' + (three.match(/photos\/preview\//g) ?? []).length + ' img=' + (three.match(/<img/g) ?? []).length
  )
  check('大图用 preview（2048px）而不是 thumb', three.includes('photos/preview/P0001.webp') && !three.includes('photos/thumb/'))
  check('大图以 object-fit: contain 呈现', three.includes('lazy-image__img is-contain'))
  check('首屏那一张 fetchpriority=high', three.includes('fetchpriority="high"'))

  // ---------- 编号与时间的格式 ----------
  const formatted = await render(FILE, {
    photos: [
      makePhoto({ id: 'P0001', order: 12, time: '2026-10-18T08:23:00', description: null }),
      makePhoto({ id: 'P0002', order: 1000, time: '2026-10-18T19:05:00', description: '晚宴开始' })
    ]
  })
  check('编号补零到 3 位（012）', />\s*012\s*</.test(formatted))
  check('编号超过 3 位不截断（1000）', />\s*1000\s*</.test(formatted))
  check('时间取 EXIF 的墙上时刻 08:23', />\s*08:23\s*</.test(formatted))
  check('时间用等宽字体、与编号同一行', formatted.includes('film__meta') && formatted.includes('film__time'))
  // 按帧切开看：第一张没有描述，第二张有
  const frames = formatted.split('data-film-index')
  check('第一张描述缺失时 film__desc 整行不渲染', frames.length === 3 && !frames[1].includes('film__desc'))
  check('第二张的描述照常渲染', />\s*晚宴开始\s*</.test(frames[2] ?? ''))

  // ---------- 描述缺失：整行不渲染 ----------
  const noDesc = await render(FILE, { photos: [makePhoto({ description: null })] })
  check('没有任何描述时 DOM 里没有 film__desc', !noDesc.includes('film__desc'))
  const blank = await render(FILE, { photos: [makePhoto({ description: '   ' })] })
  check('纯空格描述也算缺失', !blank.includes('film__desc'))

  // ---------- 时间缺失：不留孤立分隔符 ----------
  const noTime = await render(FILE, { photos: [makePhoto({ time: null, description: '准备出门' })] })
  check('无时间时不渲染 film__time', !noTime.includes('film__time'))
  check('无时间时不留孤立的「·」分隔符', !noTime.includes('film__sep'))
  check('无时间时编号与描述照常', />\s*001\s*</.test(noTime) && />\s*准备出门\s*</.test(noTime))

  // ---------- 时间与描述都缺：只剩编号一行 ----------
  const bare = await render(FILE, { photos: [makePhoto({ time: null, description: null })] })
  check('两者都缺时只剩编号一行', bare.includes('film__meta') && !bare.includes('film__time') && !bare.includes('film__desc'))
  check('两者都缺时不出现「暂无」类占位文案', !/暂无|无描述|未命名/.test(bare))

  // ---------- 键盘与滚动（源码级，SSR 跑不到） ----------
  check('键盘：空格 / ↓ 下一张，↑ 上一张', source.includes("' '") && source.includes('ArrowDown') && source.includes('ArrowUp'))
  check('空格会 preventDefault（否则默认滚页面）', source.includes('event.preventDefault()'))
  check('查看器打开时把键盘让给查看器', /isOpen\.value\)\s*return/.test(source))
  check('滚动吸附用 proximity，绝不用 mandatory', /scroll-snap-type:\s*y proximity/.test(style) && !/y mandatory/.test(style))
  check('一屏一张：min-height 用 dvh，并留了 vh 兜底', /min-height:\s*100dvh/.test(style) && /min-height:\s*100vh;/.test(style))
  check('禁止幻灯片：没有定时器 / 自动播放 / 进度条', !/setInterval|setTimeout|autoplay|<progress/.test(source))

  // ---------- 样式纪律：只用 token ----------
  check('样式里没有硬编码色值', !/#[0-9a-fA-F]{3,8}/.test(source))
  check('没有阴影、没有圆角、没有渐变', !/box-shadow|border-radius|gradient/.test(style))
  check('时长只用 token（不出现裸 ms）', !/\b\d+m?s\b/.test(style))
  check('字号只引用 --t-*', /font-size:\s*var\(--t-/.test(style) && !/font-size:\s*\d/.test(style))
}
