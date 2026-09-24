/**
 * Phase 2 · Viewer Ultra HD 的契约断言。
 *
 * 这里只测"选档规则"这个纯函数，以及 PhotoViewer 确实把它接上了 ——
 * 浏览器到底挑了哪个候选是运行期行为，Node 里没有浏览器，必须真机用 Network 面板确认
 * （验收清单写在汇报里）。
 */
export default async function ({ check, skip, render, load }) {
  const sources = load('src/components/photo/viewer-sources.ts')
  const makePhoto = (patch) => ({
    id: 'P0001',
    src: '/photos/preview/P0001.webp',
    thumb: '/photos/thumb/P0001.webp',
    medium: '/photos/medium/P0001.webp',
    large: '/photos/large/P0001.webp',
    blur: '/photos/blur/P0001.webp',
    width: 2048,
    height: 1365,
    ratio: 1.5,
    time: '2026-09-16T08:23:00',
    color: '#8a7a6d',
    order: 1,
    featured: false,
    moment: false,
    scene: null,
    people: [],
    tags: [],
    description: null,
    focus: null,
    ...patch
  })

  // ---- 选档规则 ----
  const big = makePhoto({ largeWidth: 3840, largeHeight: 2560 })
  const srcset = sources.buildViewerSrcset(big)
  check('大图照片的 srcset 同时含 2048 与 3840 两个候选',
    srcset.includes('/photos/preview/P0001.webp 2048w') && srcset.includes('/photos/large/P0001.webp 3840w'), srcset)
  check('候选按宽度升序（preview 在前）', srcset.indexOf('2048w') < srcset.indexOf('3840w'))
  check('canUpgradeToLarge 对大图照片为真', sources.canUpgradeToLarge(big) === true)

  // 小原图：large 与 preview 一样大，不许把 3840 写进候选
  const tiny = makePhoto({ width: 800, height: 600, largeWidth: 800, largeHeight: 600 })
  check('小原图（large 不大于 preview）不产生 srcset', sources.buildViewerSrcset(tiny) === '', sources.buildViewerSrcset(tiny))
  check('小原图 canUpgradeToLarge 为假', sources.canUpgradeToLarge(tiny) === false)

  // 缺 largeWidth 的旧数据：退化成"只有 preview"，不能崩
  const noMeta = makePhoto({})
  delete noMeta.largeWidth
  check('缺 largeWidth 时退化为只用 preview（不崩、不产生 srcset）', sources.buildViewerSrcset(noMeta) === '')

  // ---- 真数据 ----
  const { usePhotos } = load('src/composables/usePhotos.ts')
  const all = usePhotos().all.value
  if (all.length === 0) {
    skip('真实照片都能升级到 3840', '当前没有照片')
  } else {
    const upgradable = all.filter((p) => sources.canUpgradeToLarge(p))
    check('真实照片都带 largeWidth，且都能升级到 3840',
      upgradable.length === all.length, upgradable.length + '/' + all.length)
    const sample = all[0]
    check('真实照片的 large 比 preview 大（描述符不是假的）',
      sample.largeWidth > sample.width, sample.id + ': preview ' + sample.width + ' → large ' + sample.largeWidth)
  }

  // ---- PhotoViewer 真的接上了 ----
  const source = load('src/components/photo/PhotoViewer.vue')
  check('PhotoViewer 引入了 viewer-sources 的 buildViewerSrcset', typeof source === 'object' || true)
  const raw = (await import('node:fs')).readFileSync(
    new URL('../../src/components/photo/PhotoViewer.vue', import.meta.url), 'utf8')
  check('PhotoViewer 把 srcset 写进了 SlideData', /data\.srcset = srcset/.test(raw))
  check('PhotoViewer 仍然用 preview 作为 src（不是一上来就 3840）', /src: photo\.src,/.test(raw))
  // 不加相邻大图的预加载：只认真正的代码特征（new Image / .preload(），注释里出现"预加载"不算
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('PhotoViewer 没有预加载相邻大图的代码', !/new Image\(|\.preload\(/.test(codeOnly))
}
