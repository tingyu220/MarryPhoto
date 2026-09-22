/**
 * Wave 2-H · PhotoTimeline 的契约检查（scripts/checks/23-timeline.mjs）
 *
 * 断言全部落在「渲染出的 DOM」与「组件源码的硬性约束」上：
 * SSR 不执行 onMounted / IntersectionObserver / 手势，所以不测交互时序，
 * 只测分组结果、折叠阈值、下标保真、空态，以及 token / 禁 import 这类可静态判定的红线。
 */
import fs from 'node:fs'
import path from 'node:path'

const COMPONENT = 'src/components/photo/PhotoTimeline.vue'

/** SSR 会插入 <!--[--> / <!--]--> / <!--v-if--> 之类的片段标记，断言前先剥掉 */
function strip(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/** 拆出一组 <li>（每个 li 就是一个时间组） */
function groupChunks(html) {
  return html
    .split(/<li[ >]/)
    .slice(1)
    .map((chunk) => chunk.split('</li>')[0])
}

/** 拆出一组里的缩略图按钮（不含展开/收起那个按钮） */
function thumbChunks(groupChunk) {
  return groupChunk
    .split('<button')
    .slice(1)
    .map((chunk) => chunk.split('</button>')[0])
    .filter((chunk) => chunk.includes('timeline__thumb'))
}

/** 组头部显示的时间点文字（只看 .timeline__time，不看缩略图的 aria-label） */
function groupTime(groupChunk) {
  const m = /class="timeline__time"[^>]*>([^<]*)</.exec(groupChunk)
  return m ? m[1].trim() : null
}

function indexesOf(groupChunk) {
  return thumbChunks(groupChunk).map((btn) => {
    const m = /data-index="(\d+)"/.exec(btn)
    return m ? Number(m[1]) : null
  })
}

function photoIdsOf(groupChunk) {
  return thumbChunks(groupChunk).map((btn) => {
    const m = /data-photo-id="([^"]+)"/.exec(btn)
    return m ? m[1] : null
  })
}

function countOf(html, needle) {
  return html.split(needle).length - 1
}

/** 造一张指定时间的照片 */
function at(makePhoto, id, time) {
  return makePhoto({ id, time })
}

export default async function ({ check, render, makePhoto, makePhotos, ROOT }) {
  // ───────────────────────── 1. 分组正确性 ─────────────────────────
  const threeHours = [
    at(makePhoto, 'P0001', '2026-09-16T08:23:00'),
    at(makePhoto, 'P0002', '2026-09-16T08:41:00'),
    at(makePhoto, 'P0003', '2026-09-16T09:05:00'),
    at(makePhoto, 'P0004', '2026-09-16T11:30:00')
  ]
  const html3 = strip(await render(COMPONENT, { photos: threeHours }))
  const g3 = groupChunks(html3)

  check('3 个不同小时 → 恰好 3 组', g3.length === 3, '得到 ' + g3.length + ' 组')
  check('同一小时的两张归在同一组（08 点 · 2 张）', g3[0]?.includes('08 点 · 2 张'))
  check('另外两组各 1 张（09 点 · 1 张 / 11 点 · 1 张）',
    g3[1]?.includes('09 点 · 1 张') && g3[2]?.includes('11 点 · 1 张'))
  check('组时间点取组内最早一张（08:23，不是 08:41）', groupTime(g3[0] ?? '') === '08:23', String(groupTime(g3[0] ?? '')))
  check('每组只有一个时间点', g3.every((g) => countOf(g, 'class="timeline__time"') === 1))
  check('三组时间点分别是 08:23 / 09:05 / 11:30',
    g3.map(groupTime).join(',') === '08:23,09:05,11:30', g3.map(groupTime).join(','))
  check('组按时间升序排列', html3.indexOf('08:23') < html3.indexOf('09:05') && html3.indexOf('09:05') < html3.indexOf('11:30'))
  check('每张照片都渲染了缩略图（4 张）', countOf(html3, 'data-photo-id=') === 4)
  check('缩略图用的是 LazyImage（lazy-image 容器）',
    g3.every((g) => thumbChunks(g).every((btn) => btn.includes('class="lazy-image'))))
  check('竖向细线 + 时间点短横线存在（timeline__list::before / timeline__mark）',
    html3.includes('timeline__mark') && html3.includes('timeline__list'))

  // 同一天不同小时要分开；不同天的同一小时也要分开
  const crossDay = [
    at(makePhoto, 'P0001', '2026-09-16T08:00:00'),
    at(makePhoto, 'P0002', '2026-09-17T08:00:00')
  ]
  const htmlCross = strip(await render(COMPONENT, { photos: crossDay }))
  check('不同日期的同一小时是两组（09-16 08 / 09-17 08）', groupChunks(htmlCross).length === 2)

  // ───────────────────────── 2. time = null → 最后一组「时间未知」 ─────────────────────────
  const withNull = [
    at(makePhoto, 'P0001', '2026-09-16T08:23:00'),
    at(makePhoto, 'P0002', null),
    at(makePhoto, 'P0003', '2026-09-16T09:05:00'),
    at(makePhoto, 'P0004', null)
  ]
  const htmlNull = strip(await render(COMPONENT, { photos: withNull }))
  const gNull = groupChunks(htmlNull)

  check('有时间的两组 + 时间未知一组 = 3 组', gNull.length === 3, '得到 ' + gNull.length + ' 组')
  check('时间未知组是最后一组', gNull[2]?.includes('时间未知 · 2 张'))
  check('时间未知组里有那两张没有时间的照片',
    photoIdsOf(gNull[2] ?? '').join(',') === 'P0002,P0004')
  check('time=null 的照片一张都没有被丢弃', countOf(htmlNull, 'data-photo-id=') === 4)
  check('时间未知组排在有时间的组之后', htmlNull.indexOf('09 点') < htmlNull.indexOf('时间未知'))
  check('时间未知组的时间点位置不留空（用 — 占位）', groupTime(gNull[2] ?? '') === '—', String(groupTime(gNull[2] ?? '')))

  // 全都是 null：只出一组，仍然全部渲染
  const allNull = [at(makePhoto, 'P0001', null), at(makePhoto, 'P0002', null)]
  const htmlAllNull = strip(await render(COMPONENT, { photos: allNull }))
  check('全部没有时间 → 只有一组「时间未知 · 2 张」',
    groupChunks(htmlAllNull).length === 1 && htmlAllNull.includes('时间未知 · 2 张'))

  // 非法时间字符串也要落到「时间未知」，不能抛异常、不能算成 1970 年某小时
  const badTime = strip(await render(COMPONENT, { photos: [at(makePhoto, 'P0001', 'not-a-date'), at(makePhoto, 'P0002', '2026-09-16T08:00:00')] }))
  check('非法时间字符串 → 归到「时间未知」而不是崩掉',
    badTime.includes('时间未知 · 1 张') && badTime.includes('08 点 · 1 张'))

  // ───────────────────────── 3. 折叠阈值（默认 6 张）─────────────────────────
  const six = makePhotos(6).map((p, i) => makePhoto({ id: p.id, time: '2026-09-16T08:' + String(10 + i).padStart(2, '0') + ':00' }))
  const htmlSix = strip(await render(COMPONENT, { photos: six }))
  check('6 张不折叠：没有展开入口', !htmlSix.includes('timeline__toggle'))
  check('6 张全部渲染', countOf(htmlSix, 'data-photo-id=') === 6)

  const seven = makePhotos(7, { time: '2026-09-16T08:00:00' })
  const htmlSeven = strip(await render(COMPONENT, { photos: seven }))
  check('7 张 → 渲染 6 张 + 展开入口 +1',
    countOf(htmlSeven, 'data-photo-id=') === 6 && htmlSeven.includes('+1'))

  const ten = makePhotos(10, { time: '2026-09-16T08:00:00' })
  const htmlTen = strip(await render(COMPONENT, { photos: ten }))
  const gTen = groupChunks(htmlTen)

  check('10 张 → 默认只渲染 6 张缩略图', countOf(htmlTen, 'data-photo-id=') === 6)
  check('10 张 → 出现 "+4" 展开入口', htmlTen.includes('timeline__toggle') && htmlTen.includes('+4'))
  check('展开入口是真正的 <button type="button">',
    /<button[^>]*class="timeline__toggle"[^>]*type="button"|<button[^>]*type="button"[^>]*class="timeline__toggle"/.test(htmlTen))
  check('折叠态 aria-expanded="false"（可展开）', /timeline__toggle[^>]*aria-expanded="false"/.test(htmlTen))
  check('展开入口有无障碍名称（aria-label）', /timeline__toggle[^>]*aria-label="[^"]+"/.test(htmlTen))
  check('组的 data-count 仍然是整组张数 10（折叠只影响渲染，不影响数据）', (gTen[0] ?? '').includes('data-count="10"'))
  check('折叠后前 6 张的下标是 0..5',
    JSON.stringify(indexesOf(gTen[0] ?? '')) === JSON.stringify([0, 1, 2, 3, 4, 5]),
    JSON.stringify(indexesOf(gTen[0] ?? '')))

  // ───────────────────────── 4. 空数组 ─────────────────────────
  const htmlEmpty = strip(await render(COMPONENT, { photos: [] }))
  check('空数组 → 一行提示，不崩', htmlEmpty.includes('timeline__empty') && htmlEmpty.includes('这一天还没有照片'))
  check('空数组 → 没有分组、没有缩略图、没有展开入口',
    groupChunks(htmlEmpty).length === 0 &&
    !htmlEmpty.includes('data-photo-id=') &&
    !htmlEmpty.includes('timeline__toggle'))

  // ───────────────────────── 5. index 保真 ─────────────────────────
  // 5a. 前一组折叠掉 2 张，后一组的下标不能被"接着数"，必须还是原始下标 8..11
  const twelve = [
    ...makePhotos(8, { time: '2026-09-16T08:10:00' }),
    ...makePhotos(4).map((p, i) => makePhoto({ id: 'Q' + String(i + 1).padStart(4, '0'), time: '2026-09-16T09:1' + i + ':00' }))
  ]
  const htmlTwelve = strip(await render(COMPONENT, { photos: twelve }))
  const gTwelve = groupChunks(htmlTwelve)

  check('12 张：第一组 8 张折叠到 6 张，下标仍是 0..5',
    JSON.stringify(indexesOf(gTwelve[0] ?? '')) === JSON.stringify([0, 1, 2, 3, 4, 5]),
    JSON.stringify(indexesOf(gTwelve[0] ?? '')))
  check('第一组显示 "+2"', (gTwelve[0] ?? '').includes('+2'))
  check('第二组第一张（原数组第 9 张）下标是 8，不是 6',
    indexesOf(gTwelve[1] ?? '')[0] === 8, JSON.stringify(indexesOf(gTwelve[1] ?? '')))
  check('第二组 4 张下标连续为 8,9,10,11',
    JSON.stringify(indexesOf(gTwelve[1] ?? '')) === JSON.stringify([8, 9, 10, 11]))
  check('被折叠掉的下标 6 / 7 没有出现在 DOM 里',
    !htmlTwelve.includes('data-index="6"') && !htmlTwelve.includes('data-index="7"'))
  check('12 张里折叠掉 2 张，其余 10 张的按钮都在（6 + 4）',
    countOf(htmlTwelve, 'class="timeline__thumb"') === 10, String(countOf(htmlTwelve, 'class="timeline__thumb"')))

  // 5b. 明确验证「第 7 张照片对应的 index 是 6」：
  //     前一组 6 张（不折叠）+ 后一组从第 7 张开始，后一组第一张必须带 data-index="6" 且是 P0007
  const tenSplit = [
    ...makePhotos(6, { time: '2026-09-16T08:10:00' }),
    ...makePhotos(4).map((p, i) => makePhoto({ id: 'P' + String(i + 7).padStart(4, '0'), time: '2026-09-16T09:1' + i + ':00' }))
  ]
  const htmlSplit = strip(await render(COMPONENT, { photos: tenSplit }))
  const gSplit = groupChunks(htmlSplit)
  const secondGroupThumbs = thumbChunks(gSplit[1] ?? '')

  check('10 张分两组：第 7 张（P0007）落在第二组，且它的下标仍是 6',
    indexesOf(gSplit[1] ?? '')[0] === 6 && photoIdsOf(gSplit[1] ?? '')[0] === 'P0007',
    JSON.stringify(indexesOf(gSplit[1] ?? '')) + ' / ' + JSON.stringify(photoIdsOf(gSplit[1] ?? '')))
  check('第一组只有 6 张，因此不折叠（展开入口不出现）', !(gSplit[0] ?? '').includes('timeline__toggle'))
  check('第一组渲染的 6 张下标 0..5',
    JSON.stringify(indexesOf(gSplit[0] ?? '')) === JSON.stringify([0, 1, 2, 3, 4, 5]))
  check('缩略图按钮的无障碍名称里也是全局序号（第 7 张）',
    (secondGroupThumbs[0] ?? '').includes('查看第 7 张'))

  // 5c. 10 张同一小时：折叠后第 7 张以后不渲染，但组仍记着 10 张、原数组没有被改动
  check('10 张同一小时且折叠：data-index=6 不渲染，但组仍记着 10 张',
    !htmlTen.includes('data-index="6"') && (gTen[0] ?? '').includes('data-count="10"'))
  check('渲染不会改动传入的数组（props.photos 仍是原样 10 张）',
    ten.length === 10 && ten[6]?.id === 'P0007')

  // ───────────────────────── 6. 源码级硬性约束 ─────────────────────────
  const source = fs.readFileSync(path.join(ROOT, COMPONENT), 'utf8')
  const styleBlock = (/<style[^>]*>([\s\S]*?)<\/style>/.exec(source) ?? ['', ''])[1]
  const templateBlock = (/<template>([\s\S]*?)<\/template>/.exec(source) ?? ['', ''])[1]

  check('冻结契约：只有一个 prop photos: Photo[]', source.includes('defineProps<{ photos: Photo[] }>()'))
  check('不 import 其它浏览模式组件（四种模式互不 import）',
    !/PhotoMasonry|PhotoContactSheet|PhotoFilm/.test(source))
  check('不自己读 JSON、不碰数据层（无 .json import / 无 usePhotos）',
    !/\.json['"]/.test(source) && !source.includes('usePhotos'))
  check('通过 usePhotoViewer().open(props.photos, index) 打开大图',
    source.includes('usePhotoViewer') && /open\(props\.photos,\s*index\)/.test(source))
  check('缩略图用 LazyImage size="thumb"', /<LazyImage[^>]*size="thumb"/.test(source))
  check('样式里没有硬编码色值', !/#[0-9a-fA-F]{3,8}\b/.test(styleBlock) && !/rgba?\(/.test(styleBlock))
  check('样式里没有阴影 / 圆角', !/box-shadow/.test(styleBlock) && !/border-radius/.test(styleBlock))
  check('竖线是 1px 且用 --c-line',
    /timeline__list::before[\s\S]{0,200}?width:\s*1px/.test(styleBlock) && styleBlock.includes('var(--c-line)'))
  check('时间/计数用等宽字体与 label 字号（--f-mono / --t-label / --ls-label）',
    styleBlock.includes('var(--f-mono)') && styleBlock.includes('var(--t-label)') && styleBlock.includes('var(--ls-label)'))
  check('间距/时长全部走 token（--s-* / --d-* / --e-out）',
    styleBlock.includes('var(--s-') && styleBlock.includes('var(--d-fast)') && styleBlock.includes('var(--e-out)'))
  check('模板里没有图标（无 svg）', !templateBlock.includes('<svg'))
  check('缩略图不在 SSR 阶段发请求（懒加载，输出里没有 <img）',
    !html3.includes('<img') && !htmlTen.includes('<img'))
}
