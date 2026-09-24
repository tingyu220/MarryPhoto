/**
 * 超清档（large，长边 3840）的契约级断言。
 *
 * 为什么要多这一档：preview 的长边只有 2048px，在 2 倍屏（DPR 2）上只能铺满约 1024 CSS px，
 * 用户一旦点开放大到 100% 看细节（蕾丝、戒指、发丝）就是插值放大出来的假细节。
 * large 补上 3840px：高 DPI 屏幕与"放大查看"用得上，而列表 / 画册版面一律不加载它
 * —— 否则 gallery 会瞬间多下载几十 MB（这一档的定位是"要的时候才要"）。
 *
 * 断言分四组：
 *   1. 类型与规格：PhotoTech 有 large、VARIANTS.large 是 3840/large、check-budget 有 largeAvg；
 *   2. 生成物：photos.json 每条都有、磁盘上真有文件、large 严格大于 preview、
 *      并且（本机有原图时）逐张核对 large 长边 = min(3840, 原图长边) —— 不放大；
 *   3. 不放大：临时目录里造一张 800×600 的小图跑真实管线，large 必须仍是 800×600；
 *      顺带验证"缺 large 会被增量自动补生成"与"check 能报出 large 缺失"；
 *   4. 消费端：usePhotos() 真的把 large 传下去了，而 LazyImage 默认/medium/preview 都不碰它。
 *
 * 全部临时产物写在系统临时目录，跑完即删，不碰仓库里的 public/photos 与 src/data/photos.json。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { VARIANTS, hasAllVariants, readExistingVariants, variantPath } from '../lib/images.mjs'
import { runChecks } from '../lib/check.mjs'
import { runPipeline } from '../process-images.mjs'

const LAZY_IMAGE = 'src/components/common/LazyImage.vue'

/** 造一张 w×h 的 JPEG（管线吃真实文件，不吃 buffer） */
async function makeJpeg(sharp, file, width, height) {
  await sharp({ create: { width, height, channels: 3, background: { r: 176, g: 138, b: 108 } } })
    .jpeg({ quality: 80 })
    .toFile(file)
}

async function longEdgeOf(sharp, file) {
  const meta = await sharp(file).metadata()
  return Math.max(meta.width ?? 0, meta.height ?? 0)
}

export default async function ({ check, skip, render, load, makePhoto, ROOT }) {
  const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
  const sharp = (await import('sharp')).default
  // 关掉 libvips 的操作缓存：它会把读过的文件句柄留到进程退出，
  // 而这一组断言要在临时目录里反复删/建文件（Windows 上留着句柄就会 EPERM）
  sharp.cache(false)

  // ───────────────────────── 1. 类型与规格 ─────────────────────────

  const techBlock = /interface PhotoTech \{([\s\S]*?)\n\}/.exec(read('src/types/photo.ts'))?.[1] ?? ''
  const iMedium = techBlock.indexOf('medium: string')
  const iLarge = techBlock.indexOf('large: string')
  const iBlur = techBlock.indexOf('blur: string')
  check('PhotoTech 声明了 large: string，且排在 medium 之后、blur 之前（档位阶梯顺序）',
    iMedium !== -1 && iLarge !== -1 && iBlur !== -1 && iMedium < iLarge && iLarge < iBlur,
    'medium@' + iMedium + ' large@' + iLarge + ' blur@' + iBlur)
  const largeDoc = iLarge === -1 ? '' : techBlock.slice(0, iLarge).split('/**').pop() ?? ''
  check('large 的注释写清了规格与用途（长边 3840px + 高 DPI / 放大查看 + 不放大）',
    iLarge !== -1 && /3840px/.test(largeDoc) && /(高 DPI|放大查看)/.test(largeDoc) && /不放大|保持原尺寸/.test(largeDoc),
    largeDoc.replace(/\s+/g, ' ').trim().slice(0, 90))

  check('VARIANTS.large 的规格是 dir="large" / longEdge=3840（与 thumb/medium/preview 同构）',
    VARIANTS.large !== undefined && VARIANTS.large.dir === 'large' && VARIANTS.large.longEdge === 3840,
    JSON.stringify(VARIANTS.large))
  check('large 的质量高于 preview（它是给放大看细节用的，不该比全屏图更糙）',
    VARIANTS.large.quality > VARIANTS.preview.quality && VARIANTS.large.quality <= 95,
    'large q' + VARIANTS.large.quality + ' > preview q' + VARIANTS.preview.quality)
  check('五档齐全且 large 严格大于 preview 的规格长边',
    Object.keys(VARIANTS).length === 5 && VARIANTS.large.longEdge > VARIANTS.preview.longEdge &&
      VARIANTS.preview.longEdge > VARIANTS.medium.longEdge && VARIANTS.medium.longEdge > VARIANTS.thumb.longEdge,
    Object.keys(VARIANTS).map((n) => n + ':' + VARIANTS[n].longEdge).join(' '))

  const budgetSource = read('scripts/check-budget.mjs')
  const largeAvg = /largeAvg:\s*(\d+)/.exec(budgetSource)
  check('check-budget.mjs 有 largeAvg 预算，且统计循环里带上了 large（否则"生成了但没人知道"）',
    largeAvg !== null && Number(largeAvg[1]) > 0 && /\[\s*'large'\s*,\s*BUDGET\.largeAvg/.test(budgetSource),
    largeAvg ? 'largeAvg = ' + largeAvg[1] + 'KB' : '没有找到 largeAvg')

  // ───────────────────────── 2. 真实的 24 张生成物 ─────────────────────────

  const payload = load('src/data/photos.json')
  const photos = Array.isArray(payload?.photos) ? payload.photos : []
  check('photos.json 每张照片都有 large，且指向 /photos/large/<id>.webp',
    photos.length > 0 && photos.every((p) => p.large === '/photos/large/' + p.id + '.webp'),
    '共 ' + photos.length + ' 张，首条=' + JSON.stringify(photos[0]?.large))

  const largeDir = path.join(ROOT, 'public', 'photos', 'large')
  const largeFiles = fs.existsSync(largeDir) ? fs.readdirSync(largeDir).filter((f) => f.endsWith('.webp')) : []
  check('public/photos/large/ 的产物数量与照片数一致',
    photos.length > 0 && largeFiles.length === photos.length,
    'large=' + largeFiles.length + ' photos=' + photos.length)

  // 抽查：首 / 25% / 37% / 尾各一个 id，不只看目录计数
  const sampled = photos.length
    ? [photos[0], photos[Math.floor(photos.length * 0.25)], photos[Math.floor(photos.length * 0.37)], photos[photos.length - 1]]
    : []
  const missing = sampled.filter((p) => {
    const file = path.join(largeDir, p.id + '.webp')
    return !fs.existsSync(file) || fs.statSync(file).size === 0
  })
  check('抽查 4 个 id 的 large 产物真实存在且非空',
    sampled.length === 4 && missing.length === 0,
    missing.length ? '缺失：' + missing.map((p) => p.id).join('、') : sampled.map((p) => p.id).join('、'))

  const idSet = new Set(photos.map((p) => p.id))
  const orphans = largeFiles.filter((f) => !idSet.has(f.replace(/\.webp$/, '')))
  check('large 目录里没有 photos.json 之外的孤儿产物', orphans.length === 0, orphans.slice(0, 5).join('、') || '无')

  // 像素：large 必须严格大于 preview（这就是加这一档的理由）
  const shape = []
  for (const photo of sampled) {
    shape.push({
      id: photo.id,
      large: await longEdgeOf(sharp, path.join(largeDir, photo.id + '.webp')),
      preview: await longEdgeOf(sharp, path.join(ROOT, 'public', 'photos', 'preview', photo.id + '.webp')),
      largeBytes: fs.statSync(path.join(largeDir, photo.id + '.webp')).size,
      previewBytes: fs.statSync(path.join(ROOT, 'public', 'photos', 'preview', photo.id + '.webp')).size
    })
  }
  check('large 长边严格大于 preview 长边（否则这一档白加）',
    shape.length === 4 && shape.every((s) => s.large > s.preview),
    shape.map((s) => s.id + ' large' + s.large + '/preview' + s.preview).join('  '))
  check('large 的体积大于 preview（同样内容更大尺寸，不可能更小）',
    shape.length === 4 && shape.every((s) => s.largeBytes > s.previewBytes),
    shape.map((s) => s.id + ' ' + Math.round(s.largeBytes / 1024) + 'KB/' + Math.round(s.previewBytes / 1024) + 'KB').join('  '))

  // 不放大（真实照片）：large 长边必须 = min(3840, 原图长边)。需要 photos/original（被 gitignore，仅开发机有）
  const indexFile = path.join(ROOT, 'photos', 'index.json')
  const originalDir = path.join(ROOT, 'photos', 'original')
  if (fs.existsSync(indexFile) && fs.existsSync(originalDir)) {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
    const pairOf = (id) => Object.keys(index).find((key) => index[key] === id)
    const rows = []
    for (const photo of sampled) {
      const key = pairOf(photo.id)
      const file = key ? path.join(originalDir, key) : null
      if (!file || !fs.existsSync(file)) continue
      const meta = await sharp(file).metadata()
      const originalLong = Math.max(meta.width ?? 0, meta.height ?? 0)
      rows.push({ id: photo.id, original: originalLong, expected: Math.min(VARIANTS.large.longEdge, originalLong) })
    }
    check('large 长边 = min(3840, 原图长边)：与 thumb/medium/preview 同一条"不放大"规则',
      rows.length === 4 && rows.every((r) => {
        const actual = shape.find((s) => s.id === r.id)?.large ?? 0
        return actual === r.expected
      }),
      rows.map((r) => r.id + ' 原图' + r.original + '→' + r.expected).join('  '))
  } else {
    skip('large 长边 = min(3840, 原图长边)', '本机没有 photos/original（被 gitignore），只能靠第 3 组在临时目录验证')
  }

  // ───────────────────────── 3. 不放大：临时目录里造一张 800×600 的小图 ─────────────────────────

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'marryphoto-large-'))
  const srcDir = path.join(TMP, 'original')
  const outRoot = path.join(TMP, 'public', 'photos')
  const tmpPhotos = path.join(TMP, 'photos.json')
  const tmpIndex = path.join(TMP, 'index.json')
  const tmpOverrides = path.join(TMP, 'overrides.json')

  try {
    fs.mkdirSync(srcDir, { recursive: true })
    await makeJpeg(sharp, path.join(srcDir, 'tiny.jpg'), 800, 600)

    await runPipeline({ root: TMP, srcDir, outRoot, indexFile: tmpIndex, photosFile: tmpPhotos, log: () => {} })
    const tiny = JSON.parse(fs.readFileSync(tmpPhotos, 'utf8')).photos[0]

    const tinyLarge = await sharp(variantPath(outRoot, 'large', tiny.id)).metadata()
    const tinyPreview = await sharp(variantPath(outRoot, 'preview', tiny.id)).metadata()
    const tinyThumb = await sharp(variantPath(outRoot, 'thumb', tiny.id)).metadata()
    check('小图（800×600）的 large 是 800×600 —— 原图小于 3840 时绝不放大',
      tinyLarge.width === 800 && tinyLarge.height === 600,
      'large=' + tinyLarge.width + '×' + tinyLarge.height + '（若被放大就会是 3840×2880）')
    check('同一张小图的 preview/thumb 也保持不放大（large 与它们同一条规则）',
      tinyPreview.width === 800 && tinyPreview.height === 600 && tinyThumb.width === 480 && tinyThumb.height === 360,
      'preview=' + tinyPreview.width + '×' + tinyPreview.height + ' thumb=' + tinyThumb.width + '×' + tinyThumb.height)
    check('小图的 photos.json 记录同样带 large 路径（生成物与类型对得上）',
      tiny.large === '/photos/large/' + tiny.id + '.webp', JSON.stringify(tiny.large))
    check('小图的 large 不大于 preview（既然没放大，两者应当一样大）',
      Math.max(tinyLarge.width, tinyLarge.height) <= Math.max(tinyPreview.width, tinyPreview.height),
      'large=' + Math.max(tinyLarge.width, tinyLarge.height) + ' preview=' + Math.max(tinyPreview.width, tinyPreview.height))

    const clean = await runChecks({ repoRoot: ROOT, photosFile: tmpPhotos, overridesFile: tmpOverrides, publicRoot: outRoot, indexFile: tmpIndex })
    check('产物齐全时 --check 报 0 错误', clean.errors.length === 0, JSON.stringify(clean.errors.map((e) => e.title)))
    check('增量判断认 large：五个产物都在时 hasAllVariants 为真', await hasAllVariants(outRoot, tiny.id))

    // "只有 V1 四档产物"这个状态用复制来造，而不是就地删 outRoot 里的 large：
    // 刚被 sharp 读过的文件在 Windows 上还握着句柄，原地删会 EPERM（实测过），
    // 复制一份出来既等价又不依赖文件锁的运气。
    const v1Root = path.join(TMP, 'v1-public', 'photos')
    for (const name of ['thumb', 'medium', 'preview', 'blur']) {
      fs.mkdirSync(path.join(v1Root, name), { recursive: true })
      fs.copyFileSync(variantPath(outRoot, name, tiny.id), variantPath(v1Root, name, tiny.id))
    }

    check('只有 V1 四档产物、没有 large 时 hasAllVariants 为假（旧产物会被补生成，而不是被当成"已生成"）',
      (await hasAllVariants(v1Root, tiny.id)) === false)
    let threw = false
    try {
      await readExistingVariants(v1Root, tiny.id)
    } catch {
      threw = true
    }
    check('跳过路径读元数据时，缺 large 会直接报错而不是静默写出坏 photos.json', threw)

    const dirty = await runChecks({ repoRoot: ROOT, photosFile: tmpPhotos, overridesFile: tmpOverrides, publicRoot: v1Root, indexFile: tmpIndex })
    const dirtyDetail = dirty.errors.map((e) => e.title + ' ' + e.detail).join(' | ')
    check('check.mjs 的缺失产物校验能报出 large 缺失（五档而不是四档）',
      dirty.errors.some((e) => e.title.includes('缺失的产物文件')) && /large 缺 1 个/.test(dirtyDetail),
      dirtyDetail.slice(0, 160))

    // 在这份"V1 状态"的产物目录上跑一次增量：large 应当被自动补回来（V1 → V2 升级路径）
    await runPipeline({ root: TMP, srcDir, outRoot: v1Root, indexFile: tmpIndex, photosFile: tmpPhotos, log: () => {} })
    check('在只有四档的目录上跑一次增量，large 被自动补生成且仍是 800×600（原图小就不放大）',
      fs.existsSync(variantPath(v1Root, 'large', tiny.id)) &&
        (await longEdgeOf(sharp, variantPath(v1Root, 'large', tiny.id))) === 800)
    const after = await runChecks({ repoRoot: ROOT, photosFile: tmpPhotos, overridesFile: tmpOverrides, publicRoot: v1Root, indexFile: tmpIndex })
    check('补生成后 --check 重新回到 0 错误，且 hasAllVariants 恢复为真',
      after.errors.length === 0 && (await hasAllVariants(v1Root, tiny.id)),
      JSON.stringify(after.errors.map((e) => e.title)))
  } finally {
    try {
      fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    } catch {
      /* Windows 上 libvips 可能还持有句柄，删不掉不影响结论 */
    }
  }

  // ───────────────────────── 4. 消费端：传下去了，且列表不会加载它 ─────────────────────────

  const { usePhotos } = load(path.join(ROOT, 'src/composables/usePhotos.ts'))
  const allPhotos = usePhotos().all.value
  check('usePhotos() 合并出的 Photo 每条都带 large（type 与 composable 两条链路都改了）',
    allPhotos.length > 0 && allPhotos.every((p) => p.large === '/photos/large/' + p.id + '.webp'),
    '共 ' + allPhotos.length + ' 张，首条=' + JSON.stringify(allPhotos[0]?.large))

  const withLarge = { ...makePhoto(), large: '/photos/large/P0001.webp' }
  const fallback = await render(LAZY_IMAGE, { photo: withLarge, eager: true })
  const asMedium = await render(LAZY_IMAGE, { photo: withLarge, size: 'medium', eager: true })
  const asPreview = await render(LAZY_IMAGE, { photo: withLarge, size: 'preview', eager: true })
  check('LazyImage 缺省（thumb）不碰 large —— 列表不该为"放大查看"付流量',
    !fallback.includes('/photos/large/') && fallback.includes('/photos/thumb/P0001.webp'))
  check('LazyImage size="medium" / "preview" 也都不碰 large（这一档由查看器按设备条件单独取）',
    !asMedium.includes('/photos/large/') && !asPreview.includes('/photos/large/'),
    (asMedium.match(/src="[^"]*"/g) ?? []).join(' ') + ' ' + (asPreview.match(/src="[^"]*"/g) ?? []).join(' '))
}
