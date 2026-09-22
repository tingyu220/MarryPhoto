/**
 * 人物 / 瞬间（Wave 3-K）的契约级断言。
 *
 * SSR 不执行点击、手势与 IntersectionObserver，所以这里断言的是
 * "渲染出来的 DOM + 真编译过的样式"，交互留给真机走查。
 *
 * 两点说明：
 * 1. 全局路由垫片只把 to.path 写进 href（它丢掉 query），而这两个页面的契约
 *    恰恰在 query 上 —— 所以额外注册一个"带 query 的 RouterLink 垫片"
 *    （序列化方式与 vue-router 一致：{ path, query } → /path?k=v），用它断言
 *    「每个人物链接都带 ?p=<id>」。默认垫片那一条也照常断言（路径部分必须是 /gallery）。
 * 2. 真实数据里 9 个人物都有照片、60 张瞬间都有描述，所以"张数为 0 的人不显示"
 *    "描述缺失时那一行不渲染"这两个非理想状态靠**临时改数据**来验证：
 *    直接改 usePhotos() 模块级单例里的数组，渲染完立刻还原（finally）。
 *    这样测的是组件真正的分支，而不是另写一个假的渲染路径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resetRoute, sass, sfc, setRoute, vue } from '../lib/render.mjs'

/** 把某个 SFC 的 <style> 真编译一次：SSR 的 DOM 里没有 CSS，样式只能这样断言 */
function compiledCss(ROOT, relative) {
  const file = path.join(ROOT, relative)
  const source = fs.readFileSync(file, 'utf8')
  const { descriptor } = sfc.parse(source, { filename: file })
  return descriptor.styles
    .map((style) => sass.compileString(style.content, { syntax: 'scss' }).css)
    .join('\n')
}

/** 带 query 的 RouterLink 垫片：证明组件传的是 { path, query }，不是手拼的字符串 */
function queryAwareLink() {
  return vue.defineComponent({
    name: 'RouterLink',
    props: { to: { type: [String, Object], required: true } },
    setup(props, { slots, attrs }) {
      return () => {
        const to = typeof props.to === 'string' ? { path: props.to, query: {} } : props.to ?? {}
        const query = to.query ?? {}
        const search = Object.keys(query)
          .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(String(query[key])))
          .join('&')
        const href = (to.path ?? '/') + (search ? '?' + search : '')
        return vue.h('a', { href, ...attrs }, slots.default ? slots.default() : [])
      }
    }
  })
}

/** 把 HTML 按 <figure> 切开，便于检查"某一张图那一块"里到底有什么 */
function figures(html) {
  return html
    .split('<figure')
    .slice(1)
    .map((chunk) => '<figure' + chunk.split('</figure>')[0])
}

/** 取出所有 class 含 targetClass 的 <a> 标签 */
function anchorsWithClass(html, className) {
  const pattern = new RegExp('class="[^"]*\\b' + className + '\\b')
  return Array.from(html.matchAll(/<a\b[^>]*>/g))
    .map((match) => match[0])
    .filter((tag) => pattern.test(tag))
}

/** 临时替换数组内容，跑完无论成败都还原 */
async function withContents(array, next, fn) {
  const saved = array.splice(0, array.length)
  array.push(...next)
  try {
    return await fn()
  } finally {
    array.splice(0, array.length)
    array.push(...saved)
  }
}

export default async function ({ check, skip, render, load, makePhoto, ROOT }) {
  const tax = load('src/data/taxonomy.ts')
  const { usePhotos } = load('src/composables/usePhotos.ts')
  const source = usePhotos()
  const counts = tax.PEOPLE.map((id) => [id, source.byPerson(id).length])

  // 真实张数直接打到终端，汇报与人工复核都用它
  console.log(
    '人物张数（真实数据）：' +
      counts.map(([id, n]) => tax.PEOPLE_LABELS[id] + ' ' + n).join(' / ')
  )
  console.log('瞬间张数（真实数据）：' + source.moments.value.length)

  // ============================ PeopleView ============================
  const html = await render('src/views/PeopleView.vue', {})

  check('人物页有页面标题与一句说明', html.includes('人物') && html.includes('按人看。人工标的，可能会漏。'))
  check('人物页走 PageShell（header + main + footer 齐全）',
    html.includes('<header') && html.includes('<main') && html.includes('site-footer'))

  check('数据前提：受控词表恰好 9 个人物', tax.PEOPLE.length === 9 && Object.keys(tax.PEOPLE_LABELS).length === 9,
    tax.PEOPLE.join(','))
  const allPeopleHavePhotos = counts.every(([, n]) => n > 0)
  if (allPeopleHavePhotos) check('数据前提：9 个人物都有照片（否则下面第 4 条不成立）', true, counts.map(([id, n]) => id + '=' + n).join(' '))
  else skip('数据前提：9 个人物都有照片（否则下面第 4 条不成立）', '只标注了一部分人物：' + counts.map(([id, n]) => id + '=' + n).join(' '))

  const labels = tax.PEOPLE.map((id) => tax.PEOPLE_LABELS[id])
  const missing = labels.filter((label) => !html.includes(label))
  if (!allPeopleHavePhotos) skip('渲染出全部 9 个人物标签', '人物还没标全，页面合理地只显示有照片的人')
  else check('渲染出全部 9 个人物标签', missing.length === 0, missing.length ? '缺：' + missing.join('、') : labels.join('、'))

  const rows = anchorsWithClass(html, 'person')
  const expectedRows = counts.filter(([, n]) => n > 0).length
  check('条目数 = 有照片的人物数，且没有卡片墙的多余容器',
    rows.length === expectedRows && /<ul class="people"/.test(html) && !/\b(card|panel|tile)\b/.test(html),
    'rows=' + rows.length + ' expected=' + expectedRows)

  const countMissing = counts.filter(([, n]) => n > 0 && !html.includes(n + ' 张'))
  check('每条都显示张数（等宽小字）',
    countMissing.length === 0 && html.includes('person__count'), countMissing.map(([id]) => id).join(','))

  const hrefs = rows.map((tag) => (/href="([^"]*)"/.exec(tag) || [])[1])
  check('每个人物链接都指向 /gallery（默认垫片只看得到 path）',
    hrefs.length === expectedRows && hrefs.every((href) => href === '/gallery'), hrefs.join(' '))

  // 关键：query 才是本页的契约（筛选由 useFilters 从 ?p= 读）
  const linked = await render('src/views/PeopleView.vue', {}, {
    setup: (app) => {
      // render() 已经注册过全局垫片；这里直接改 appContext 的注册表，
      // 避开 app.component() 的"重复注册"告警（那条告警与本次断言无关）。
      // 如果哪天这条内部路径失效，下面的 href 断言会立刻变红，不会静默通过。
      app._context.components.RouterLink = queryAwareLink()
    }
  })
  const linkedHrefs = anchorsWithClass(linked, 'person').map((tag) => (/href="([^"]*)"/.exec(tag) || [])[1])
  const expectedHrefs = counts.filter(([, n]) => n > 0).map(([id]) => '/gallery?p=' + id)
  check('每个人物链接带 ?p=<personId>（href 里真的有 query）',
    linkedHrefs.length === expectedHrefs.length && expectedHrefs.every((href) => linkedHrefs.includes(href)),
    linkedHrefs.join(' '))

  // 链接的 query key 必须与 /gallery 真正读取的 key 一致，否则点进去等于没筛
  const filtersSource = fs.readFileSync(path.join(ROOT, 'src/composables/useFilters.ts'), 'utf8')
  const personKey = (/QUERY_PERSON\s*=\s*'([^']+)'/.exec(filtersSource) || [])[1]
  check('链接里的 query key 与 useFilters 读取的 key 一致',
    personKey !== undefined && linkedHrefs.every((href) => href.includes('?' + personKey + '=')),
    'useFilters 读 ?' + personKey + '=')

  // 端到端：真的按链接走一遍，Gallery 必须筛出这个人的张数
  const sisterCount = source.byPerson('sister').length
  setRoute({ path: '/gallery', query: { p: 'sister' } })
  let galleryHtml = ''
  try {
    galleryHtml = await render('src/views/GalleryView.vue', {})
  } finally {
    resetRoute()
  }
  check('按链接走一遍：/gallery?p=sister 真的筛出这个人的张数',
    sisterCount > 0 && galleryHtml.includes(sisterCount + ' 张'),
    'sister=' + sisterCount)

  check('头像用圆形取景框（DOM 上是 person__avatar）',
    (html.match(/class="person__avatar"/g) || []).length === expectedRows)

  const peopleCss = compiledCss(ROOT, 'src/views/PeopleView.vue')
  check('头像的圆角真的写在样式里：border-radius: 50%',
    /\.person__avatar\s*\{[^}]*border-radius:\s*50%/.test(peopleCss))
  check('全页只有这一处圆角（全站唯一的例外）',
    (peopleCss.match(/border-radius/g) || []).length === 1)
  check('没有阴影、没有硬编码色值',
    !/box-shadow/.test(peopleCss) && !/#[0-9a-fA-F]{3,8}\b/.test(peopleCss) && !/rgba?\(/.test(peopleCss))
  // px 只允许出现在 1px 描边与媒体查询断点上：先把 @media 条件从句子里抹掉
  const peopleDecls = peopleCss.replace(/@media[^{]*/g, '@media')
  const peoplePx = peopleDecls.match(/[0-9.]+px/g) || []
  check('除了 1px 细线与 768px 断点，样式里没有别的 px',
    peoplePx.every((value) => value === '1px') &&
      (peopleCss.match(/[0-9.]+px/g) || []).filter((v) => v !== '1px').join(',') === '768px',
    peoplePx.join(',') + ' / 断点 ' + (peopleCss.match(/[0-9.]+px/g) || []).filter((v) => v !== '1px').join(','))

  // 非理想状态 1：张数为 0 的人物不显示
  const kid = source.byPerson('kid')
  const kidCount = kid.length
  await withContents(kid, [], async () => {
    const injected = await render('src/views/PeopleView.vue', {})
    const rowCount = anchorsWithClass(injected, 'person').length
    if (kidCount === 0) skip('张数为 0 的人物不渲染（把 kid 清零后标签消失）', '原本就没有小朋友的照片，构造不出清空这一步')
    else check('张数为 0 的人物不渲染（把 kid 清零后标签消失）',
      !injected.includes(tax.PEOPLE_LABELS.kid) && rowCount === expectedRows - 1,
      'kid=' + kidCount + ' rows=' + rowCount)
  })

  // 非理想状态 2：一个人都没有照片时不崩
  const everyPerson = tax.PEOPLE.map((id) => source.byPerson(id))
  const savedLengths = everyPerson.map((list) => list.length)
  await withContents(everyPerson[0], [], async () => {
    const injected = await render('src/views/PeopleView.vue', {})
    check('只有一个人没有照片时，其余 8 条照常渲染',
      anchorsWithClass(injected, 'person').length === expectedRows - 1)
  })

  // 非理想状态 3：所有人都是空的
  const cleared = everyPerson.map((list) => list.splice(0, list.length))
  try {
    const injected = await render('src/views/PeopleView.vue', {})
    check('全空时不崩：一行安静文案 + 0 条目',
      anchorsWithClass(injected, 'person').length === 0 &&
        injected.includes('还没有标注人物的照片') &&
        !injected.includes('person__avatar'))
  } finally {
    everyPerson.forEach((list, i) => list.push(...cleared[i]))
  }

  check('临时注入的数据已完整还原（不影响后续检查）',
    tax.PEOPLE.every((id, i) => source.byPerson(id).length === savedLengths[i]),
    savedLengths.join(','))

  // ============================ MomentsView ============================
  const moments = source.moments.value
  const total = moments.length
  const mHtml = await render('src/views/MomentsView.vue', {})
  const mFigures = figures(mHtml)

  check('瞬间页有标题与那句朴素的话', mHtml.includes('瞬间') && mHtml.includes('没人在看镜头的时候。'))
  if (total === 0) skip('瞬间页的图数与 moments 数量一致', '还没有标任何 moment: true 的照片')
  else check('瞬间页的图数与 moments 数量一致',
    mFigures.length === total && mHtml.includes(total + ' 张'),
    'figures=' + mFigures.length + ' moments=' + total)
  check('每张图都属于 moments（data-photo-id 一一对应）',
    new Set(moments.map((p) => p.id)).size === total &&
      moments.every((p) => mHtml.includes('data-photo-id="' + p.id + '"')))
  check('每张图下面只有一行极小的时间 + 描述（真实数据 60 张都有描述）',
    mFigures.filter((figure) => figure.includes('moment__meta')).length === total &&
      mFigures.filter((figure) => figure.includes('moment__note')).length === total)
  if (total === 0) skip('图片一律走 LazyImage（没有裸 <img> 实现）', '瞬间页当前没有照片可渲染')
  else check('图片一律走 LazyImage（没有裸 <img> 实现）',
    !/<picture|<canvas/.test(mHtml) && mHtml.includes('lazy-image'))

  // 非理想状态 3：没有描述只显示时间 —— 那一行（描述）不渲染
  const timeOnly = makePhoto({ id: 'P9901', moment: true, time: '2026-10-18T14:05:00', description: null })
  // 非理想状态 4：时间和描述都没有 —— 整行不渲染
  const bare = makePhoto({ id: 'P9902', moment: true, time: null, description: null })
  await withContents(moments, [...moments, timeOnly, bare], async () => {
    const injected = await render('src/views/MomentsView.vue', {})
    const blocks = figures(injected)
    const timeBlock = blocks.find((figure) => figure.includes('data-photo-id="P9901"')) ?? ''
    const bareBlock = blocks.find((figure) => figure.includes('data-photo-id="P9902"')) ?? ''
    check('注入两张后总张数 +2，且两张都在 DOM 里',
      blocks.length === total + 2 && timeBlock !== '' && bareBlock !== '', 'figures=' + blocks.length)
    check('描述缺失时不渲染描述那段（只留时间）',
      timeBlock.includes('moment__time') && timeBlock.includes('14:05') &&
        !timeBlock.includes('moment__note') && !timeBlock.includes('暂无描述'))
    check('时间与描述都没有时整行不渲染',
      bareBlock !== '' && !bareBlock.includes('moment__meta') && !bareBlock.includes('moment__note'))
  })

  // 非理想状态 5：空数组不崩
  await withContents(moments, [], async () => {
    const injected = await render('src/views/MomentsView.vue', {})
    check('moments 为空时一行安静文案，不崩',
      injected.includes('这里还没有照片。') && figures(injected).length === 0 &&
        injected.includes('0 张') && !injected.includes('moment__hit'))
  })
  check('moments 数据已还原', source.moments.value.length === total, String(source.moments.value.length))

  const momentsCss = compiledCss(ROOT, 'src/views/MomentsView.vue')
  check('瞬间页没有任何圆角与阴影', !/border-radius/.test(momentsCss) && !/box-shadow/.test(momentsCss))
  check('瞬间页没有硬编码色值', !/#[0-9a-fA-F]{3,8}\b/.test(momentsCss) && !/rgba?\(/.test(momentsCss))
  check('桌面端最多两列（移动端单列）',
    /grid-template-columns:\s*1fr\s*1fr/.test(momentsCss) &&
      (momentsCss.match(/grid-template-columns/g) || []).length === 2)
}
