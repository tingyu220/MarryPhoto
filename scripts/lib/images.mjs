/**
 * 图片产物：thumb / medium / large / preview / blur 五档 WebP + 主色提取 + 并发池。
 *
 * 规格（docs/01 第 9.2 节，不要随意改）：
 *   thumb   长边 480px  q72（列表、网格、联系表、时间线缩略图）
 *   medium  长边 1280px q78（桌面端中等尺寸展示：画册版面、Story 错落图、瞬间页）
 *   large   长边 3840px q86（高 DPI 屏幕、放大查看 —— 定档依据见 VARIANTS.large）
 *   preview 长边 2048px q82（全屏查看器、首屏大图）
 *   blur    长边 20px   q40
 * 上述各档规格一律"不放大"：窄于长边的小图保持原尺寸（withoutEnlargement，thumb/medium/large/preview 同一条规则）。
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
  // large 的 q86 是实测定的，不是拍的：24 张 6000×4000 的真实照片，同一批图在各质量下的平均体积
  //   q82 568KB · q85 709KB · q86 782KB · q88 984KB（PSNR 抽样 3 张、相对 q95 参考：38.1/38.7/39.1/39.6 dB）
  // 3840 是 2048 的 3.5 倍像素，且这一档只在"高 DPI / 放大查看"时下载（列表、画册一律不加载），
  // 所以不需要 preview 之上的额外质量余量；86 落在"再往上只多 0.5dB、体积却多 26%"的拐点右侧。
  large: { dir: 'large', longEdge: 3840, quality: 86 },
  blur: { dir: 'blur', longEdge: 20, quality: 40 }
}

/** 主色提取失败时的兜底（tokens.scss 的暖棕，不是随机魔法值） */
export const FALLBACK_COLOR = '#8a7a6d'

export function variantPath(outRoot, variantName, id) {
  return path.join(outRoot, VARIANTS[variantName].dir, id + '.webp')
}

/**
 * 删除一批照片的全部产物（五档都删，遍历 VARIANTS 保证新增档位自动纳入）。用于"占位图退出历史舞台"这类场景：
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
 * 生成一张照片的全部产物，返回 { width, height, color, bytes }。
 * width/height 来自 preview 产物本身（不是原图），与 PhotoTech 的约定一致
 * —— large 的实际像素比它大，不参与宽高比占位。
 */
export async function renderAllVariants(input, outRoot, id) {
  const previewFile = variantPath(outRoot, 'preview', id)
  const large = await writeVariant(input, variantPath(outRoot, 'large', id), VARIANTS.large)
  const preview = await writeVariant(input, previewFile, VARIANTS.preview)
  const medium = await writeVariant(input, variantPath(outRoot, 'medium', id), VARIANTS.medium)
  const thumb = await writeVariant(input, variantPath(outRoot, 'thumb', id), VARIANTS.thumb)
  const blur = await writeVariant(input, variantPath(outRoot, 'blur', id), VARIANTS.blur)
  const color = await extractColor(previewFile)
  return {
    width: preview.width,
    height: preview.height,
    // large 的真实像素单独带出去：查看器要用它写 srcset 的宽度描述符。
    // 写错了（例如小原图却声称 3840w）会让浏览器按错误的信息选图，所以必须是实测值。
    largeWidth: large.width,
    largeHeight: large.height,
    color,
    bytes: {
      large: large.bytes,
      preview: preview.bytes,
      medium: medium.bytes,
      thumb: thumb.bytes,
      blur: blur.bytes
    }
  }
}

/**
 * 增量跳过时必须做的：从既有产物把 width/height/color 读回来。
 *
 * 顺带确认 large 产物也在：width/height/color 都取自 preview，跳过路径本该看不见 large，
 * 但一旦 large 缺失而这里不报，就会写出一份指向 /photos/large/ 的 photos.json
 * （浏览器 404、管线却报成功）。宁可在这里失败，也不要静默产出坏数据。
 */
export async function readExistingVariants(outRoot, id) {
  const previewFile = variantPath(outRoot, 'preview', id)
  const largeFile = variantPath(outRoot, 'large', id)
  if (!(await fileExists(largeFile))) {
    throw new Error('既有产物缺少 large（' + largeFile + '）—— 用 node scripts/process-images.mjs --force 补生成')
  }
  const size = await imageSize(previewFile)
  const largeSize = await imageSize(largeFile)
  const color = await extractColor(previewFile)
  return { width: size.width, height: size.height, largeWidth: largeSize.width, largeHeight: largeSize.height, color }
}

/** 五个产物是否都在（缺任何一个都要补生成 —— 新增 large 档时旧的产物目录里没有这一层） */
export async function hasAllVariants(outRoot, id) {
  const names = ['thumb', 'medium', 'large', 'preview', 'blur']
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
