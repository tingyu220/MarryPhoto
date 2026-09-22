#!/usr/bin/env node
/**
 * 管线自测（不需要真实照片，也不碰 public/photos 与 src/data/photos.json）。
 *
 *   node scripts/selftest.mjs
 *
 * 覆盖：
 *   1) EXIF 读取（DateTimeOriginal / 无 EXIF 退回 mtime）
 *   2) EXIF Orientation 自动纠正（rotate()）与"不放大"（小图保持原尺寸）
 *   3) 四层产物尺寸规格（thumb 480 / medium 1280 / preview 2048 / blur 20）
 *   4) 稳定 ID：重跑不重新分配，增量跳过，--force 全量重生成
 *   5) --check 的四类问题（孤立 ID、未标注计数、越界词表、缺失产物文件）
 *   6) 占位图：同种子完全可重复（photos.json 与文件字节一致）
 *
 * 全部产物写在 scripts/.selftest/ 下，结束时自动删除。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { readTakenAt, toIsoLocal } from './lib/exif.mjs'
import { loadIndex, saveIndex } from './lib/ids.mjs'
import { runPipeline } from './process-images.mjs'
import { runPlaceholders, ratioSequence, createRandom, previewSize, RATIOS, DEFAULT_SEED } from './make-placeholders.mjs'
import { runChecks } from './lib/check.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(REPO_ROOT, 'scripts', '.selftest')

let passed = 0
const failures = []

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log('  ✓ ' + name)
  } else {
    failures.push(name + (detail ? ' —— ' + detail : ''))
    console.log('  ✗ ' + name + (detail ? ' —— ' + detail : ''))
  }
}

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12)
}

/** 手工拼一个带 Orientation + DateTimeOriginal 的 APP1 段，插到真实 JPEG 的 SOI 之后 */
function injectExif(jpegBuffer, { orientation, dateTimeOriginal }) {
  const be = (n, len) => {
    const b = Buffer.alloc(len)
    if (len === 2) b.writeUInt16BE(n)
    else b.writeUInt32BE(n)
    return b
  }
  const ifd0Offset = 8
  const exifIfdOffset = ifd0Offset + (2 + 12 * 2 + 4)
  const dataOffset = exifIfdOffset + (2 + 12 * 1 + 4) // ExifIFD 只有 1 个 entry
  const parts = [
    Buffer.from('MM', 'latin1'), be(0x2a, 2), be(ifd0Offset, 4),
    be(2, 2),
    be(0x0112, 2), be(3, 2), be(1, 4), be(orientation, 2), Buffer.alloc(2),
    be(0x8769, 2), be(4, 2), be(1, 4), be(exifIfdOffset, 4),
    be(0, 4),
    be(1, 2),
    be(0x9003, 2), be(2, 2), be(20, 4), be(dataOffset, 4),
    be(0, 4),
    Buffer.from(dateTimeOriginal + '\0', 'latin1')
  ]
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), ...parts])
  const length = Buffer.alloc(2)
  length.writeUInt16BE(payload.length + 2)
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload])
  return Buffer.concat([jpegBuffer.subarray(0, 2), app1, jpegBuffer.subarray(2)])
}

async function makeSources(srcDir) {
  fs.mkdirSync(path.join(srcDir, 'nested'), { recursive: true })
  // 大图：3000×2000 + EXIF DateTimeOriginal（Orientation 1）
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 180, g: 140, b: 110 } } })
    .jpeg({ quality: 80 })
    .toBuffer()
  fs.writeFileSync(path.join(srcDir, 'big.jpg'), injectExif(big, { orientation: 1, dateTimeOriginal: '2026:10:18 08:23:45' }))
  // 小图 + Orientation 6（应当被 rotate() 纠正为 60×120，且不放大）
  const small = await sharp({ create: { width: 120, height: 60, channels: 3, background: { r: 90, g: 120, b: 90 } } })
    .jpeg({ quality: 80 })
    .toBuffer()
  fs.writeFileSync(path.join(srcDir, 'small.jpg'), injectExif(small, { orientation: 6, dateTimeOriginal: '2026:10:18 07:05:00' }))
  // 无 EXIF：退回文件 mtime
  await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 60, g: 60, b: 90 } } })
    .webp()
    .toFile(path.join(srcDir, 'nested', 'no-exif.webp'))
}

function sameExceptGeneratedAt(a, b) {
  const strip = (payload) => JSON.stringify({ ...payload, generatedAt: null })
  return strip(a) === strip(b)
}

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true })
  const srcDir = path.join(TMP, 'original')
  const outRoot = path.join(TMP, 'public', 'photos')
  const indexFile = path.join(TMP, 'index.json')
  const photosFile = path.join(TMP, 'photos.json')
  const overridesFile = path.join(TMP, 'overrides.json')
  await makeSources(srcDir)

  console.log('\n=== 1. EXIF 读取 ===')
  const big = await readTakenAt(path.join(srcDir, 'big.jpg'))
  check('DateTimeOriginal 被读取且不做时区换算', big.time === '2026-10-18T08:23:45', JSON.stringify(big))
  check('来源标记为 DateTimeOriginal', big.source === 'DateTimeOriginal', JSON.stringify(big))
  const noExif = await readTakenAt(path.join(srcDir, 'nested', 'no-exif.webp'))
  check('无 EXIF 时退回 mtime', noExif.source === 'mtime' && /^\d{4}-\d{2}-\d{2}T/.test(noExif.time ?? ''), JSON.stringify(noExif))
  check('缺失时间返回 null', toIsoLocal(undefined) === null && toIsoLocal('') === null)

  console.log('\n=== 2. 首次运行（增量管线）===')
  const first = await runPipeline({ root: TMP, srcDir, outRoot, indexFile, photosFile, log: (l) => console.log('    ' + l) })
  check('处理 3 个文件', first.processed === 3 && first.total === 3, JSON.stringify(first))
  const photosA = JSON.parse(fs.readFileSync(photosFile, 'utf8'))
  check('photos.json 条数 = 3', photosA.photos.length === 3)
  check('placeholder = false', photosA.placeholder === false)
  const timesAscending = photosA.photos.every((p, i) => i === 0 || photosA.photos[i - 1].time <= p.time)
  check('order 为 1..3 且 time 升序', photosA.photos.map((p) => p.order).join(',') === '1,2,3' && timesAscending,
    photosA.photos.map((p) => p.order + ':' + p.time).join(' | '))
  const bigPhoto = photosA.photos.find((p) => p.time === '2026-10-18T08:23:45')
  const smallPhoto = photosA.photos.find((p) => p.time === '2026-10-18T07:05:00')
  check('大图 preview 缩到长边 2048', bigPhoto.width === 2048 && bigPhoto.height === 1365, JSON.stringify(bigPhoto))
  check('Orientation 6 被纠正为竖构图', smallPhoto.width === 60 && smallPhoto.height === 120, JSON.stringify(smallPhoto))
  check('ratio = width/height（4 位小数）', Math.abs(bigPhoto.ratio - 2048 / 1365) < 0.00005, String(bigPhoto.ratio))
  check('两张 EXIF 照片的相对顺序正确', smallPhoto.order < bigPhoto.order, smallPhoto.order + ' < ' + bigPhoto.order)
  check('color 是小写 #rrggbb', /^#[0-9a-f]{6}$/.test(bigPhoto.color), bigPhoto.color)
  const thumbMeta = await sharp(path.join(outRoot, 'thumb', bigPhoto.id + '.webp')).metadata()
  const previewMeta = await sharp(path.join(outRoot, 'preview', bigPhoto.id + '.webp')).metadata()
  const blurMeta = await sharp(path.join(outRoot, 'blur', bigPhoto.id + '.webp')).metadata()
  check('thumb 长边 = 480', Math.max(thumbMeta.width, thumbMeta.height) === 480, JSON.stringify(thumbMeta))
  check('preview 长边 = 2048', Math.max(previewMeta.width, previewMeta.height) === 2048, JSON.stringify(previewMeta))
  check('blur 长边 = 20', Math.max(blurMeta.width, blurMeta.height) === 20, JSON.stringify(blurMeta))
  const indexA = loadIndex(indexFile)
  check('index.json 记录了 3 条映射', Object.keys(indexA).length === 3, JSON.stringify(indexA))

  console.log('\n=== 3. 再跑一次：ID 稳定 + 增量跳过 ===')
  const second = await runPipeline({ root: TMP, srcDir, outRoot, indexFile, photosFile, log: () => {} })
  const indexB = loadIndex(indexFile)
  const photosB = JSON.parse(fs.readFileSync(photosFile, 'utf8'))
  check('第二次全部跳过（0 个重新生成）', second.processed === 0 && second.skipped === 3, JSON.stringify(second))
  check('ID 映射完全不变', JSON.stringify(indexA) === JSON.stringify(indexB))
  check('photos.json 与首次一致（除 generatedAt）', sameExceptGeneratedAt(photosA, photosB))

  console.log('\n=== 4. --force 全量重生成 ===')
  const third = await runPipeline({ root: TMP, srcDir, outRoot, indexFile, photosFile, force: true, log: () => {} })
  const photosC = JSON.parse(fs.readFileSync(photosFile, 'utf8'))
  check('force 重新生成 3 个', third.processed === 3, JSON.stringify(third))
  check('force 结果与增量结果一致', sameExceptGeneratedAt(photosA, photosC))
  check('force 后 ID 仍不变', JSON.stringify(loadIndex(indexFile)) === JSON.stringify(indexA))

  console.log('\n=== 5. --check ===')
  fs.writeFileSync(overridesFile, JSON.stringify({ [photosA.photos[0].id]: { scene: 'preparation', people: ['sister'], tags: ['candid'] } }, null, 2))
  const clean = await runChecks({ repoRoot: REPO_ROOT, photosFile, overridesFile, publicRoot: outRoot, indexFile })
  check('干净数据 0 错误', clean.errors.length === 0, JSON.stringify(clean.errors))
  check('未标注照片计入提示', clean.notes.some((n) => n.title.includes('没有 overrides')), JSON.stringify(clean.notes))

  fs.writeFileSync(
    overridesFile,
    JSON.stringify(
      {
        [photosA.photos[0].id]: { scene: 'not-a-scene', people: ['sister', 'aunt'], tags: ['candid', 'sparkle'] },
        P0999: { featured: true }
      },
      null,
      2
    )
  )
  fs.rmSync(path.join(outRoot, 'thumb', photosA.photos[1].id + '.webp'))
  const dirty = await runChecks({ repoRoot: REPO_ROOT, photosFile, overridesFile, publicRoot: outRoot, indexFile })
  const titles = dirty.errors.map((e) => e.title).join(' | ')
  check('检出孤立 overrides ID', titles.includes('不存在的照片 ID'), titles)
  check('检出越界词表值', titles.includes('超出受控词表'), titles)
  check('检出缺失产物文件', titles.includes('缺失的产物文件'), titles)
  check('错误时退出码非 0（errors > 0）', dirty.errors.length >= 3, String(dirty.errors.length))

  console.log('\n=== 6. 占位图可重复性 ===')
  const seqA = ratioSequence(11, createRandom(DEFAULT_SEED)).map((r) => r.label)
  const seqB = ratioSequence(11, createRandom(DEFAULT_SEED)).map((r) => r.label)
  check('同种子的纵横比序列一致', seqA.join(',') === seqB.join(','), seqA.join(',') + ' vs ' + seqB.join(','))
  check('纵横比覆盖全部 6 种（每 6 张一轮）', new Set(seqA.slice(0, 6)).size === RATIOS.length)
  check('preview 尺寸按长边 2048 计算', previewSize({ w: 16, h: 9 }).height === 1152 && previewSize({ w: 9, h: 16 }).width === 1152)
  await runPlaceholders({ root: TMP, count: 6, outRoot: path.join(TMP, 'ph1'), indexFile: path.join(TMP, 'idx1.json'), photosFile: path.join(TMP, 'ph1.json'), log: () => {} })
  await runPlaceholders({ root: TMP, count: 6, outRoot: path.join(TMP, 'ph2'), indexFile: path.join(TMP, 'idx2.json'), photosFile: path.join(TMP, 'ph2.json'), log: () => {} })
  const ph1 = JSON.parse(fs.readFileSync(path.join(TMP, 'ph1.json'), 'utf8'))
  const ph2 = JSON.parse(fs.readFileSync(path.join(TMP, 'ph2.json'), 'utf8'))
  check('占位 photos.json 完全可重复', sameExceptGeneratedAt(ph1, ph2))
  check('占位 placeholder = true', ph1.placeholder === true)
  check('占位 ID 从 P0001 顺延', ph1.photos[0].id === 'P0001' && ph1.photos[5].id === 'P0006')
  check(
    '占位文件字节一致',
    sha1(path.join(TMP, 'ph1', 'preview', 'P0003.webp')) === sha1(path.join(TMP, 'ph2', 'preview', 'P0003.webp'))
  )
  const placeholderIndex = loadIndex(path.join(TMP, 'idx1.json'))
  check('占位 index 用 placeholder/ 伪路径', Object.keys(placeholderIndex).every((k) => k.startsWith('placeholder/')))
  const phCheck = await runChecks({ repoRoot: REPO_ROOT, photosFile: path.join(TMP, 'ph1.json'), overridesFile: path.join(TMP, 'no-overrides.json'), publicRoot: path.join(TMP, 'ph1'), indexFile: path.join(TMP, 'idx1.json') })
  check('占位数据自身校验通过', phCheck.errors.length === 0, JSON.stringify(phCheck.errors))

  // Windows 上 libvips 可能还持有映射句柄，删不掉也不影响结论
  let cleaned = true
  try {
    fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch {
    cleaned = false
  }
  console.log('\n────────────────────────────')
  console.log(failures.length === 0 ? '全部通过：' + passed + ' 项' : '失败 ' + failures.length + ' 项：\n  - ' + failures.join('\n  - '))
  console.log(cleaned
    ? '（临时目录 ' + path.relative(REPO_ROOT, TMP).split(path.sep).join('/') + ' 已删除）'
    : '（临时目录 ' + path.relative(REPO_ROOT, TMP).split(path.sep).join('/') + ' 未能删除，可手动清理）')
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
