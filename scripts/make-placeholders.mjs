#!/usr/bin/env node
/**
 * 占位图生成器（Wave 1 - 1.1 附带）
 *
 *   node scripts/make-placeholders.mjs --count 300
 *
 * 用途：真实照片尚未拍摄时，用 300 张合成图跑通"瀑布流布局 / 性能 / 压测"全链路。
 * 全部离线合成（sharp 从 SVG 渲染），不下载任何东西；同一 --seed 下结果可重复。
 *
 * ── 关于 EXIF 的说明（重要，与任务书一致）────────────────────────────
 * 本脚本**跳过"写 EXIF → 用 exifr 读回来"这条分支**。原因（实测）：
 *   sharp 的 withMetadata({ exif: { ExifIFD: { DateTimeOriginal } } }) 只能写出
 *   Make / ModifyDate / Orientation 一类标签，DateTimeOriginal 会丢失，
 *   所以"合成图带 EXIF"并不可靠。
 * 替代方案：直接把这批照片的时间写进 photos/index.json 记录的生成过程与
 *   src/data/photos.json（起始 2026-09-16T07:30，每张 +3 分钟，足够覆盖到晚上）。
 * 真实照片到位后由 scripts/process-images.mjs 覆盖，那条路径走真正的 EXIF。
 * ─────────────────────────────────────────────────────────────────
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { formatLocal } from './lib/exif.mjs'
import {
  loadIndex,
  saveIndex,
  prunePlaceholderEntries,
  reserveIds,
  buildPhotoRecords,
  writePhotosFile,
  PLACEHOLDER_KEY_PREFIX
} from './lib/ids.mjs'
import { VARIANTS, ensureDirFor, extractColor, fileBytes, humanBytes, mapLimit, variantPath } from './lib/images.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..')

/** 长边取自 images.mjs 的规格：preview 2048 / medium 1280 / thumb 480 / blur 20 */
export const DEFAULT_COUNT = 300
/** 固定种子：同一种子必然得到同一批图，压测数据可重复 */
export const DEFAULT_SEED = 20261018
/** 时间轴起点与步长（婚礼当天清晨 → 晚上） */
export const TIME_START = { year: 2026, month: 9, day: 16, hour: 7, minute: 30 }
export const TIME_STEP_MINUTES = 3

/** 暖色系（取自 docs/02 tokens 的暖棕/纸色，不引入其它色相） */
export const PALETTE = ['#8a7a6d', '#6f6a63', '#a2948a', '#7d6b5d', '#f5f2ec']
/** 纸色：深色背景上的字色 */
const PAPER = '#f5f2ec'
/** 深墨色：浅色背景上的字色 */
const INK = '#33302c'

/** 纵横比轮换池 */
export const RATIOS = [
  { label: '16:9', w: 16, h: 9 },
  { label: '3:2', w: 3, h: 2 },
  { label: '1:1', w: 1, h: 1 },
  { label: '2:3', w: 2, h: 3 },
  { label: '3:4', w: 3, h: 4 },
  { label: '9:16', w: 9, h: 16 }
]

/** mulberry32：小、快、确定的伪随机数发生器 */
export function createRandom(seed) {
  let state = seed >>> 0
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 确定性洗牌（Fisher–Yates，用固定种子的 random） */
function shuffle(list, random) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/**
 * 纵横比序列：每 6 张恰好各用一次（分布均匀），
 * 每轮的先后顺序由固定种子的伪随机打乱 —— 确定、可重复，但不是呆板的循环。
 */
export function ratioSequence(count, random) {
  const seq = []
  let pool = []
  while (seq.length < count) {
    if (pool.length === 0) pool = shuffle(RATIOS, random)
    seq.push(pool.pop())
  }
  return seq
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  }
}

/** 相对亮度（0～1）：用来决定字色，保证占位图上的文字永远读得清 */
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** 纵横比 → preview 实际像素（长边 2048，不放大） */
export function previewSize(ratio, longEdge = VARIANTS.preview.longEdge) {
  if (ratio.w >= ratio.h) {
    return { width: longEdge, height: Math.round((longEdge * ratio.h) / ratio.w) }
  }
  return { width: Math.round((longEdge * ratio.w) / ratio.h), height: longEdge }
}

/** 单张占位图的 SVG：暖色渐变 + 三分线 + 内框 + 大号 ID + 右下角时间 */
export function buildSvg({ id, time, ratio, width, height, colorA, colorB }) {
  const min = Math.min(width, height)
  const ink = luminance(colorA) * 0.5 + luminance(colorB) * 0.5 > 0.62 ? INK : PAPER
  const idSize = Math.round(min * 0.17)
  const labelSize = Math.round(min * 0.032)
  const metaSize = Math.round(min * 0.042)
  const stroke = Math.max(2, Math.round(min * 0.004))
  const pad = Math.round(min * 0.055)
  const cx = Math.round(width / 2)
  const cy = Math.round(height / 2)
  const clock = time.slice(11, 16)
  const date = time.slice(0, 10).replace(/-/g, '.')

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">',
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0" stop-color="' + colorA + '"/>',
    '<stop offset="1" stop-color="' + colorB + '"/>',
    '</linearGradient>',
    '<radialGradient id="vig" cx="0.5" cy="0.46" r="0.78">',
    '<stop offset="0.55" stop-color="#000000" stop-opacity="0"/>',
    '<stop offset="1" stop-color="#000000" stop-opacity="0.30"/>',
    '</radialGradient>',
    '</defs>',
    '<rect width="' + width + '" height="' + height + '" fill="url(#bg)"/>',
    '<rect width="' + width + '" height="' + height + '" fill="url(#vig)"/>',
    '<g stroke="' + ink + '" stroke-opacity="0.12" stroke-width="' + stroke + '">',
    '<line x1="' + Math.round(width / 3) + '" y1="0" x2="' + Math.round(width / 3) + '" y2="' + height + '"/>',
    '<line x1="' + Math.round((width * 2) / 3) + '" y1="0" x2="' + Math.round((width * 2) / 3) + '" y2="' + height + '"/>',
    '<line x1="0" y1="' + Math.round(height / 3) + '" x2="' + width + '" y2="' + Math.round(height / 3) + '"/>',
    '<line x1="0" y1="' + Math.round((height * 2) / 3) + '" x2="' + width + '" y2="' + Math.round((height * 2) / 3) + '"/>',
    '</g>',
    '<rect x="' + Math.round(pad / 2) + '" y="' + Math.round(pad / 2) + '" width="' + (width - pad) + '" height="' + (height - pad) + '" fill="none" stroke="' + ink + '" stroke-opacity="0.45" stroke-width="' + stroke + '"/>',
    '<text x="' + cx + '" y="' + Math.round(cy + idSize * 0.35) + '" font-family="Segoe UI, Arial, sans-serif" font-size="' + idSize + '" font-weight="600" letter-spacing="' + Math.round(idSize * 0.06) + '" fill="' + ink + '" fill-opacity="0.95" text-anchor="middle">' + id + '</text>',
    '<text x="' + cx + '" y="' + Math.round(cy + idSize * 0.35 + idSize * 0.68) + '" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="' + labelSize + '" letter-spacing="' + Math.round(labelSize * 0.35) + '" fill="' + ink + '" fill-opacity="0.7" text-anchor="middle">占位图 · PLACEHOLDER</text>',
    '<text x="' + (width - pad) + '" y="' + (height - pad) + '" font-family="Consolas, monospace" font-size="' + metaSize + '" letter-spacing="' + Math.round(metaSize * 0.12) + '" fill="' + ink + '" fill-opacity="0.85" text-anchor="end">' + clock + '</text>',
    '<text x="' + pad + '" y="' + (height - pad) + '" font-family="Consolas, monospace" font-size="' + metaSize + '" letter-spacing="' + Math.round(metaSize * 0.12) + '" fill="' + ink + '" fill-opacity="0.7">' + date + '</text>',
    '<text x="' + pad + '" y="' + (pad + metaSize) + '" font-family="Consolas, monospace" font-size="' + labelSize + '" letter-spacing="' + Math.round(labelSize * 0.12) + '" fill="' + ink + '" fill-opacity="0.7">' + ratio.label + ' · ' + width + '×' + height + '</text>',
    '</svg>'
  ].join('')
}

/** 时间轴：起点 + index × 3 分钟 */
export function timeAt(index) {
  const start = new Date(TIME_START.year, TIME_START.month - 1, TIME_START.day, TIME_START.hour, TIME_START.minute, 0)
  return formatLocal(new Date(start.getTime() + index * TIME_STEP_MINUTES * 60000))
}

/**
 * 生成 N 张占位图 + ID 映射 + photos.json。
 * 导出以便自测（可指向临时目录，不污染 public/photos）。
 */
export async function runPlaceholders(options = {}) {
  const root = options.root ?? REPO_ROOT
  const count = Math.max(1, Number(options.count ?? DEFAULT_COUNT) | 0)
  const seed = Number(options.seed ?? DEFAULT_SEED) | 0
  const outRoot = options.outRoot ?? path.join(root, 'public', 'photos')
  const indexFile = options.indexFile ?? path.join(root, 'photos', 'index.json')
  const photosFile = options.photosFile ?? path.join(root, 'src', 'data', 'photos.json')
  const log = options.log ?? ((line) => process.stdout.write(line + '\n'))
  const placeholder = options.placeholder !== false

  const random = createRandom(seed)
  const ratios = ratioSequence(count, random)
  const index = loadIndex(indexFile)
  const pruned = prunePlaceholderEntries(index)
  const ids = reserveIds(index, count)

  log('占位图生成 · ' + count + ' 张 · 长边 ' + VARIANTS.preview.longEdge + '/' + VARIANTS.medium.longEdge + '/' + VARIANTS.thumb.longEdge + '/' + VARIANTS.blur.longEdge + ' · 种子 ' + seed)
  log('  时间轴：' + timeAt(0) + ' → ' + timeAt(count - 1) + '（每张 +' + TIME_STEP_MINUTES + ' 分钟）')
  log('  纵横比：' + RATIOS.map((r) => r.label).join(' ') + '（固定种子伪随机洗牌后轮换）')
  log('  ID 区间：' + ids[0] + ' … ' + ids[ids.length - 1] + (pruned.removed.length > 0 ? '（清理旧占位记录 ' + pruned.removed.length + ' 条）' : ''))
  log('')

  const jobs = ids.map((id, i) => ({ id, ratio: ratios[i], time: timeAt(i) }))

  let done = 0
  const results = await mapLimit(jobs, 4, async (job) => {
    const size = previewSize(job.ratio)
    const a = PALETTE[Math.floor(random() * PALETTE.length)]
    let b = PALETTE[Math.floor(random() * PALETTE.length)]
    if (b === a) b = PALETTE[(PALETTE.indexOf(a) + 2) % PALETTE.length]

    const svg = Buffer.from(
      buildSvg({ id: job.id, time: job.time, ratio: job.ratio, width: size.width, height: size.height, colorA: a, colorB: b })
    )
    // 中间母版：按 preview 实际像素渲染一次，再向下缩出 medium / thumb / blur
    const master = await sharp(svg).png().toBuffer()

    const previewFile = variantPath(outRoot, 'preview', job.id)
    const mediumFile = variantPath(outRoot, 'medium', job.id)
    const thumbFile = variantPath(outRoot, 'thumb', job.id)
    const blurFile = variantPath(outRoot, 'blur', job.id)
    ensureDirFor(previewFile)
    ensureDirFor(mediumFile)
    ensureDirFor(thumbFile)
    ensureDirFor(blurFile)

    await sharp(master).webp({ quality: VARIANTS.preview.quality, effort: 4 }).toFile(previewFile)
    await sharp(master)
      .resize({ width: VARIANTS.medium.longEdge, height: VARIANTS.medium.longEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: VARIANTS.medium.quality, effort: 4 })
      .toFile(mediumFile)
    await sharp(master)
      .resize({ width: VARIANTS.thumb.longEdge, height: VARIANTS.thumb.longEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: VARIANTS.thumb.quality, effort: 4 })
      .toFile(thumbFile)
    await sharp(master)
      .resize({ width: VARIANTS.blur.longEdge, height: VARIANTS.blur.longEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: VARIANTS.blur.quality, effort: 4 })
      .toFile(blurFile)

    // 主色与 process-images.mjs 走同一条路径（preview 产物 stats().dominant），保证一致
    const color = await extractColor(previewFile)

    done += 1
    if (done % 25 === 0 || done === count) log('    已生成 ' + done + '/' + count)

    return { id: job.id, width: size.width, height: size.height, color, time: job.time, ratio: job.ratio.label }
  })

  fs.mkdirSync(path.dirname(indexFile), { recursive: true })
  for (const item of results) index[PLACEHOLDER_KEY_PREFIX + item.id + '.svg'] = item.id
  saveIndex(indexFile, index)

  const records = buildPhotoRecords(results)
  const payload = writePhotosFile(photosFile, records, { placeholder })

  let thumbBytes = 0
  let mediumBytes = 0
  let previewBytes = 0
  let blurBytes = 0
  for (const photo of records) {
    thumbBytes += await fileBytes(variantPath(outRoot, 'thumb', photo.id))
    mediumBytes += await fileBytes(variantPath(outRoot, 'medium', photo.id))
    previewBytes += await fileBytes(variantPath(outRoot, 'preview', photo.id))
    blurBytes += await fileBytes(variantPath(outRoot, 'blur', photo.id))
  }
  const n = records.length || 1
  const ratioCount = {}
  for (const item of results) ratioCount[item.ratio] = (ratioCount[item.ratio] ?? 0) + 1

  log('')
  log('  写出 ' + path.relative(root, photosFile).split(path.sep).join('/') + '（' + records.length + ' 张，placeholder=' + payload.placeholder + '）')
  log('  写出 ' + path.relative(root, indexFile).split(path.sep).join('/') + '（' + Object.keys(index).length + ' 条映射）')
  log('  纵横比分布：' + Object.entries(ratioCount).map(([k, v]) => k + '×' + v).join('  '))
  const avgOf = (sum, name) => name + ' 平均 ' + humanBytes(Math.round(sum / n)) + '（合计 ' + humanBytes(sum) + '）'
  log(
    '  产物体积：' +
      [avgOf(thumbBytes, 'thumb'), avgOf(mediumBytes, 'medium'), avgOf(previewBytes, 'preview'), avgOf(blurBytes, 'blur')].join(' · ')
  )
  log('  时间范围：' + records[0].time + ' → ' + records[records.length - 1].time)
  log('')
  log('  提示：真实照片到位后运行 npm run photos，占位记录会被自动清理并覆盖。')

  return {
    count: records.length,
    seed,
    ids: { first: records[0].id, last: records[records.length - 1].id },
    bytes: { thumb: thumbBytes, medium: mediumBytes, preview: previewBytes, blur: blurBytes },
    ratioCount
  }
}

function printUsage() {
  process.stdout.write(
    [
      '用法：node scripts/make-placeholders.mjs [--count 300] [--seed 20261018]',
      '  --count N   生成 N 张占位图（默认 ' + DEFAULT_COUNT + '）',
      '  --seed N    随机种子（默认 ' + DEFAULT_SEED + '，同种子结果完全一致）',
      ''
    ].join('\n')
  )
}

async function main() {
  const args = process.argv.slice(2)
  let count = DEFAULT_COUNT
  let seed = DEFAULT_SEED
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--count') count = Number(args[++i])
    else if (arg.startsWith('--count=')) count = Number(arg.slice(8))
    else if (arg === '--seed') seed = Number(args[++i])
    else if (arg.startsWith('--seed=')) seed = Number(arg.slice(7))
    else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else {
      process.stderr.write('未知参数：' + arg + '\n')
      printUsage()
      process.exit(2)
    }
  }
  if (!Number.isFinite(count) || count <= 0) {
    process.stderr.write('--count 必须是正整数\n')
    process.exit(2)
  }
  await runPlaceholders({ count, seed })
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() : ''
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch((err) => {
    process.stderr.write('生成占位图失败：' + (err?.stack ?? String(err)) + '\n')
    process.exit(1)
  })
}
