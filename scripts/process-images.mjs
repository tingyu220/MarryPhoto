#!/usr/bin/env node
/**
 * 图片处理管线（Wave 1 - 1.1）
 *
 *   node scripts/process-images.mjs            增量：只处理新照片
 *   node scripts/process-images.mjs --force    全量重生成
 *   node scripts/process-images.mjs --check    只校验，不生成
 *
 * 流程：
 *   扫描 photos/original/** → 读 EXIF 拍摄时间 → 分配稳定 ID（photos/index.json）
 *   → sharp 生成 thumb/medium/preview/blur 四层 WebP + 主色 → 写 src/data/photos.json → 校验 overrides
 *
 * 增量语义：index.json 里有记录、且四个产物都存在 → 跳过生成（缺 medium 这类"新加的档"会自动补生成；
 * 但仍从既有 preview 读回
 * width/height/主色，保证 photos.json 与全量重生成完全一致）。
 * ID 语义：已分配过的文件永不重新分配；占位图留下的 placeholder/* 伪记录会被清掉。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isPhotoFile, readTakenAt } from './lib/exif.mjs'
import {
  loadIndex,
  saveIndex,
  prunePlaceholderEntries,
  assignIds,
  sortByTime,
  buildPhotoRecords,
  writePhotosFile
} from './lib/ids.mjs'
import {
  renderAllVariants,
  readExistingVariants,
  hasAllVariants,
  fileBytes,
  humanBytes,
  mapLimit,
  variantPath,
  removeVariantFiles
} from './lib/images.mjs'
import { runChecks, formatReport } from './lib/check.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..')

/** 同时飞的图片任务数（libvips 内部已经多线程，这里只是别把所有文件一次性打开） */
const IMAGE_CONCURRENCY = 4
const META_CONCURRENCY = 8

/** 递归扫描原始照片目录，返回 [{ key, abs }]，key 是相对 photos/original 的 posix 路径 */
export function scanOriginalPhotos(srcDir) {
  const found = []
  const walk = (dir, rel) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      const key = rel ? rel + '/' + entry.name : entry.name
      if (entry.isDirectory()) walk(abs, key)
      else if (entry.isFile() && isPhotoFile(entry.name)) found.push({ key, abs })
    }
  }
  if (fs.existsSync(srcDir)) walk(srcDir, '')
  found.sort((a, b) => a.key.localeCompare(b.key))
  return found
}

function rel(root, target) {
  const r = path.relative(root, target)
  return r === '' ? '.' : r.split(path.sep).join('/')
}

/**
 * 执行整条管线（导出以便自测：可以指向临时目录运行，不污染 public/photos）。
 * @returns {Promise<object>} 统计摘要
 */
export async function runPipeline(options = {}) {
  const root = options.root ?? REPO_ROOT
  const srcDir = options.srcDir ?? path.join(root, 'photos', 'original')
  const outRoot = options.outRoot ?? path.join(root, 'public', 'photos')
  const indexFile = options.indexFile ?? path.join(root, 'photos', 'index.json')
  const photosFile = options.photosFile ?? path.join(root, 'src', 'data', 'photos.json')
  const force = options.force === true
  const placeholder = options.placeholder === true
  const log = options.log ?? ((line) => process.stdout.write(line + '\n'))

  log('照片管线 · ' + rel(root, srcDir) + (force ? '（--force 全量重生成）' : '（增量）'))
  const files = scanOriginalPhotos(srcDir)
  log('  扫描到 ' + files.length + ' 个原始文件')

  const index = loadIndex(indexFile)

  // 安全阀：没有任何原始照片时绝不覆盖生成物（否则会把占位数据/线上数据抹成空）
  if (files.length === 0) {
    log('  没有原始照片（' + rel(root, srcDir) + ' 为空或不存在）。')
    log('  保留现有 ' + rel(root, photosFile) + ' 与 ' + rel(root, indexFile) + ' 不动。')
    log('  用 npm run placeholders 生成占位数据；确实要清空请手动删除 ' + rel(root, photosFile) + ' 后再运行。')
    return { total: 0, processed: 0, skipped: 0, failed: 0, untouched: true, written: false }
  }

  // 真正有真实照片要处理时，才清掉占位图的伪记录（真实照片会接管这些 ID）
  const pruned = prunePlaceholderEntries(index)
  if (pruned.removed.length > 0) {
    log('  清理占位图伪记录 ' + pruned.removed.length + ' 条')
    // 必须连磁盘产物一起删：新照片会接管这批 ID，而残留的旧 webp 会让它们被误判为"已生成"
    const purged = removeVariantFiles(outRoot, pruned.removedIds)
    if (purged > 0) log('  删除占位图遗留产物 ' + purged + ' 个（否则新照片会显示成旧图）')
  }

  // ---- 1. 读拍摄时间（DateTimeOriginal → CreateDate → mtime → null）----
  const scanned = await mapLimit(files, META_CONCURRENCY, async (file) => {
    const taken = await readTakenAt(file.abs)
    return { key: file.key, abs: file.abs, time: taken.time, source: taken.source }
  })
  const sourceCount = {}
  for (const item of scanned) sourceCount[item.source] = (sourceCount[item.source] ?? 0) + 1
  log(
    '  拍摄时间来源：' +
      Object.entries(sourceCount)
        .map(([k, v]) => k + ' ' + v)
        .join(' / ')
  )

  // ---- 2. 稳定 ID ----
  const fresh = scanned.filter((file) => !index[file.key])
  assignIds(index, sortByTime(fresh).map((file) => file.key))
  if (fresh.length > 0) {
    const ids = fresh.map((file) => index[file.key]).sort()
    log('  新分配 ID ' + fresh.length + ' 个：' + ids[0] + ' … ' + (ids[ids.length - 1] ?? ids[0]))
  } else {
    log('  没有新文件，ID 映射不变')
  }

  // ---- 3. 决定跳过 / 生成 ----
  const entries = []
  for (const file of scanned) entries.push({ key: file.key, abs: file.abs, time: file.time, id: index[file.key] })

  const reusable = await mapLimit(entries, META_CONCURRENCY, async (entry) => {
    if (force) return false
    return hasAllVariants(outRoot, entry.id)
  })

  const todo = entries.filter((_entry, i) => !reusable[i])
  const skipped = entries.filter((_entry, i) => reusable[i])
  log('  需要生成 ' + todo.length + ' 个，直接跳过 ' + skipped.length + ' 个')

  // ---- 4. 生成产物 ----
  const failures = []
  let done = 0
  const generated = await mapLimit(todo, IMAGE_CONCURRENCY, async (entry) => {
    try {
      const result = await renderAllVariants(entry.abs, outRoot, entry.id)
      done += 1
      if (done % 25 === 0 || done === todo.length) {
        log('    处理中 ' + done + '/' + todo.length)
      }
      return { ...entry, ...result }
    } catch (err) {
      failures.push({ id: entry.id, key: entry.key, message: String(err?.message ?? err) })
      return null
    }
  })

  // ---- 5. 跳过的从既有产物读回元数据（保证与全量重生成一致）----
  const reused = await mapLimit(skipped, META_CONCURRENCY, async (entry) => {
    try {
      const meta = await readExistingVariants(outRoot, entry.id)
      return { ...entry, ...meta }
    } catch (err) {
      failures.push({ id: entry.id, key: entry.key, message: '读取既有产物失败：' + String(err?.message ?? err) })
      return null
    }
  })

  const all = [...generated, ...reused].filter(Boolean)
  const records = buildPhotoRecords(all)

  // ---- 6. 写生成物 ----
  const payload = writePhotosFile(photosFile, records, { placeholder })
  saveIndex(indexFile, index)

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

  log('  写出 ' + rel(root, photosFile) + '（' + records.length + ' 张，placeholder=' + placeholder + '）')
  log('  写出 ' + rel(root, indexFile) + '（' + Object.keys(index).length + ' 条映射）')
  log(
    '  产物体积：thumb 平均 ' + humanBytes(Math.round(thumbBytes / n)) +
      ' · medium 平均 ' + humanBytes(Math.round(mediumBytes / n)) +
      ' · preview 平均 ' + humanBytes(Math.round(previewBytes / n)) +
      ' · blur 平均 ' + humanBytes(Math.round(blurBytes / n))
  )
  if (failures.length > 0) {
    log('  ⚠ 失败 ' + failures.length + ' 个：')
    for (const failure of failures.slice(0, 10)) log('    ' + failure.id + ' ' + failure.key + ' —— ' + failure.message)
  }

  return {
    total: records.length,
    processed: generated.filter(Boolean).length,
    skipped: reused.filter(Boolean).length,
    failed: failures.length,
    failures,
    written: true,
    generatedAt: payload.generatedAt,
    bytes: { thumb: thumbBytes, medium: mediumBytes, preview: previewBytes, blur: blurBytes }
  }
}

/** --check：只校验，不生成 */
export async function runCheckCommand(repoRoot = REPO_ROOT) {
  const result = await runChecks({ repoRoot })
  process.stdout.write(formatReport(result))
  return result
}

function printUsage() {
  process.stdout.write(
    [
      '用法：node scripts/process-images.mjs [--force] [--check]',
      '  （无参数）  增量处理 photos/original 下的新照片',
      '  --force     全部重新生成',
      '  --check     只校验 photos.json / overrides / 产物文件，不生成',
      ''
    ].join('\n')
  )
}

async function main() {
  const args = process.argv.slice(2)
  const known = new Set(['--force', '--check'])
  const unknown = args.filter((arg) => !known.has(arg))
  if (unknown.length > 0) {
    process.stderr.write('未知参数：' + unknown.join(' ') + '\n')
    printUsage()
    process.exit(2)
  }

  if (args.includes('--check')) {
    const result = await runCheckCommand(REPO_ROOT)
    process.exit(result.errors.length > 0 ? 1 : 0)
  }

  const summary = await runPipeline({ force: args.includes('--force') })
  if (summary.untouched) {
    printUsage()
    process.exit(0)
  }
  const result = await runCheckCommand(REPO_ROOT)
  if (result.errors.length > 0) process.exit(1)
  if (summary.failed > 0) process.exit(1)
  process.exit(0)
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() : ''
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch((err) => {
    process.stderr.write('管线失败：' + (err?.stack ?? String(err)) + '\n')
    process.exit(1)
  })
}
