/**
 * 图片产物：thumb / medium / preview / blur 四层 WebP + 主色提取 + 并发池。
 *
 * 规格（docs/01 第 9.2 节，不要随意改）：
 *   thumb   长边 480px  q72（列表、网格、联系表、时间线缩略图）
 *   medium  长边 1280px q78（桌面端中等尺寸展示：画册版面、Story 错落图、瞬间页）
 *   preview 长边 2048px q82（全屏查看器、首屏大图）
 *   blur    长边 20px   q40
 * 上述四层规格一律"不放大"：窄于长边的小图保持原尺寸（withoutEnlargement，thumb/medium/preview 同一条规则）。
 * 方向：sharp().rotate() 不带参数 = 按 EXIF Orientation 自动纠正。
 * 主色：统一从 preview 产物（WebP）取 stats().dominant，
 *       这样"全量重生成"和"增量跳过"两条路径得到的主色完全一致。
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

export const VARIANTS = {
  thumb: { dir: 'thumb', longEdge: 480, quality: 72 },
  medium: { dir: 'medium', longEdge: 1280, quality: 78 },
  preview: { dir: 'preview', longEdge: 2048, quality: 82 },
  blur: { dir: 'blur', longEdge: 20, quality: 40 }
}

/** 主色提取失败时的兜底（tokens.scss 的暖棕，不是随机魔法值） */
export const FALLBACK_COLOR = '#8a7a6d'

export function variantPath(outRoot, variantName, id) {
  return path.join(outRoot, VARIANTS[variantName].dir, id + '.webp')
}

/**
 * 删除一批照片的全部产物（四层都删）。用于"占位图退出历史舞台"这类场景：
 * 只清理 index 记录是不够的，磁盘上的旧文件会让新照片被误判为"已生成"。
 * @returns {number} 实际删掉的文件数
 */
export function removeVariantFiles(outRoot, ids) {
  let removed = 0
  for (const variantName of Object.keys(VARIANTS)) {
    for (const id of ids) {
      const file = variantPath(outRoot, variantName, id)
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file)
          removed++
        }
      } catch {
        // 删不掉不算致命（可能被别的进程占用），下一次 --force 会覆盖它
      }
    }
  }
  return removed
}

export function variantUrl(variantName, id) {
  return '/photos/' + VARIANTS[variantName].dir + '/' + id + '.webp'
}

/** 保证目标文件的父目录存在（sharp 的 toFile 不会自动建目录） */
export function ensureDirFor(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

export async function fileExists(file) {
  try {
    await fs.promises.access(file)
    return true
  } catch {
    return false
  }
}

export async function fileBytes(file) {
  try {
    return (await fs.promises.stat(file)).size
  } catch {
    return 0
  }
}

/** 长边限制、不放大、EXIF 自动纠正 → WebP buffer */
export async function toWebpBuffer(input, { longEdge, quality }) {
  return sharp(input)
    .rotate()
    .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer()
}

/** 写单个产物，返回 { bytes, width, height } */
export async function writeVariant(input, outFile, variant) {
  const buf = await toWebpBuffer(input, variant)
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true })
  await fs.promises.writeFile(outFile, buf)
  const meta = await sharp(buf).metadata()
  return { bytes: buf.length, width: meta.width ?? 0, height: meta.height ?? 0 }
}

function channelToHex(value) {
  const n = Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
  return n.toString(16).padStart(2, '0')
}

/** 从任意图片源（路径或 buffer）取主色，输出小写 '#rrggbb' */
export async function extractColor(source) {
  try {
    const stats = await sharp(source).stats()
    const d = stats.dominant
    if (!d) return FALLBACK_COLOR
    return '#' + channelToHex(d.r) + channelToHex(d.g) + channelToHex(d.b)
  } catch {
    return FALLBACK_COLOR
  }
}

/** 读一张产物图片的实际像素 */
export async function imageSize(file) {
  const meta = await sharp(file).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}

/**
 * 生成一张照片的四个产物，返回 { width, height, color, bytes }。
 * width/height 来自 preview 产物本身（不是原图），与 PhotoTech 的约定一致。
 */
export async function renderAllVariants(input, outRoot, id) {
  const previewFile = variantPath(outRoot, 'preview', id)
  const preview = await writeVariant(input, previewFile, VARIANTS.preview)
  const medium = await writeVariant(input, variantPath(outRoot, 'medium', id), VARIANTS.medium)
  const thumb = await writeVariant(input, variantPath(outRoot, 'thumb', id), VARIANTS.thumb)
  const blur = await writeVariant(input, variantPath(outRoot, 'blur', id), VARIANTS.blur)
  const color = await extractColor(previewFile)
  return {
    width: preview.width,
    height: preview.height,
    color,
    bytes: { preview: preview.bytes, medium: medium.bytes, thumb: thumb.bytes, blur: blur.bytes }
  }
}

/** 增量跳过时必须做的：从既有产物把 width/height/color 读回来 */
export async function readExistingVariants(outRoot, id) {
  const previewFile = variantPath(outRoot, 'preview', id)
  const size = await imageSize(previewFile)
  const color = await extractColor(previewFile)
  return { width: size.width, height: size.height, color }
}

/** 四个产物是否都在（缺任何一个都要补生成 —— 新增 medium 档时旧的产物目录只有三层） */
export async function hasAllVariants(outRoot, id) {
  const names = ['thumb', 'medium', 'preview', 'blur']
  const found = await Promise.all(names.map((n) => fileExists(variantPath(outRoot, n, id))))
  return found.every(Boolean)
}

/** 并发池：libvips 本身多线程，这里限制的是同时在飞的 Promise 数量 */
export async function mapLimit(items, limit, worker, onProgress) {
  const results = new Array(items.length)
  let cursor = 0
  let done = 0
  const width = Math.max(1, Math.min(limit, items.length || 1))
  const runners = []
  for (let i = 0; i < width; i++) {
    runners.push(
      (async () => {
        for (;;) {
          const index = cursor
          cursor += 1
          if (index >= items.length) return
          results[index] = await worker(items[index], index)
          done += 1
          if (onProgress) onProgress(done, items.length)
        }
      })()
    )
  }
  await Promise.all(runners)
  return results
}

export function humanBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}
