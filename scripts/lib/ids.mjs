/**
 * 稳定 ID、时间排序、photos.json 生成物读写。
 *
 * 设计：
 *   photos/index.json 是 { "文件名相对路径": "P0001" } 的纯映射，进仓库。
 *   ID 一旦分配永不改变 —— 人工标注（overrides）永远指向同一张照片。
 *   占位图用 'placeholder/P0001.svg' 这类伪路径占位，真实照片接手时会被自动清掉。
 */
import fs from 'node:fs'
import path from 'node:path'

export const PLACEHOLDER_KEY_PREFIX = 'placeholder/'

const ID_RE = /^P(\d{4,})$/

/** 数字 → 'P0001' */
export function formatId(n) {
  return 'P' + String(n).padStart(4, '0')
}

/** 'P0001' → 1；不是合法 ID 时返回 null */
export function parseId(id) {
  const m = ID_RE.exec(String(id ?? ''))
  return m ? Number(m[1]) : null
}

export function isPlaceholderKey(key) {
  return String(key).startsWith(PLACEHOLDER_KEY_PREFIX)
}

/** 读取 photos/index.json；不存在时返回空映射 */
export function loadIndex(file) {
  if (!fs.existsSync(file)) return {}
  const raw = fs.readFileSync(file, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error('photos/index.json 不是合法 JSON：' + err.message)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('photos/index.json 结构错误：应当是 { "相对路径": "P0001" } 的对象')
  }
  const index = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || parseId(value) === null) {
      throw new Error('photos/index.json 中的 "' + key + '" 不是合法 ID：' + JSON.stringify(value))
    }
    index[key] = value
  }
  return index
}

/** 写出 photos/index.json（键排序，保证 diff 稳定、可重入） */
export function saveIndex(file, index) {
  const sorted = {}
  for (const key of Object.keys(index).sort()) sorted[key] = index[key]
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
}

/** 当前已使用的最大 ID 数字（空映射为 0） */
export function maxIdNumber(index) {
  let max = 0
  for (const id of Object.values(index)) {
    const n = parseId(id)
    if (n !== null && n > max) max = n
  }
  return max
}

/**
 * 清掉占位图留下的伪记录（真实照片接管时调用），返回 { index, removed, removedIds }。
 *
 * removedIds 必须一并交出去删除磁盘产物：占位图给 P0001…P0300 留了真实的 webp 文件，
 * 真实照片接管同一批 ID 时，产物目录里的旧文件会被 hasAllVariants() 误判为"已生成"，
 * 于是新照片拿到的是旧图 —— 元数据是新的、画面是旧的，而且不报任何错。
 */
export function prunePlaceholderEntries(index) {
  const removed = []
  const removedIds = []
  for (const key of Object.keys(index)) {
    if (isPlaceholderKey(key)) {
      removed.push(key)
      const id = index[key]
      if (typeof id === 'string' && id) removedIds.push(id)
      delete index[key]
    }
  }
  return { index, removed, removedIds }
}

/**
 * 给一批"尚无 ID 的文件"分配新 ID（按传入顺序顺延），并写入 index。
 * @returns {Map<string, string>} key → id
 */
export function assignIds(index, keys) {
  const assigned = new Map()
  let next = maxIdNumber(index) + 1
  for (const key of keys) {
    if (index[key]) {
      assigned.set(key, index[key])
      continue
    }
    const id = formatId(next)
    next += 1
    index[key] = id
    assigned.set(key, id)
  }
  return assigned
}

/** 预留 N 个连续的新 ID（用于没有真实文件对应的记录，例如占位图） */
export function reserveIds(index, count) {
  const start = maxIdNumber(index) + 1
  const ids = []
  for (let i = 0; i < count; i++) ids.push(formatId(start + i))
  return ids
}

/**
 * 按拍摄时间升序排序（time 为 null 的排最后，同时间用 key/id 兜底保证稳定）。
 * @param {{ key?: string, id?: string, time: string|null }[]} items
 */
export function sortByTime(items) {
  return items.slice().sort((a, b) => {
    const ta = a.time
    const tb = b.time
    if (ta === tb) return String(a.key ?? a.id).localeCompare(String(b.key ?? b.id))
    if (ta === null || ta === undefined) return 1
    if (tb === null || tb === undefined) return -1
    return ta < tb ? -1 : 1
  })
}

function round4(n) {
  return Number(n.toFixed(4))
}

/**
 * entries → PhotoTech[]（字段严格对齐 src/types/photo.ts）。
 * width/height 必须是 preview 产物的实际像素；order 按时间升序从 1 开始。
 */
export function buildPhotoRecords(entries) {
  return sortByTime(entries).map((entry, i) => ({
    id: entry.id,
    src: '/photos/preview/' + entry.id + '.webp',
    thumb: '/photos/thumb/' + entry.id + '.webp',
    medium: '/photos/medium/' + entry.id + '.webp',
    blur: '/photos/blur/' + entry.id + '.webp',
    width: entry.width,
    height: entry.height,
    ratio: round4(entry.width / entry.height),
    time: entry.time ?? null,
    color: entry.color,
    order: i + 1
  }))
}

/** 写 src/data/photos.json */
export function writePhotosFile(file, photos, { placeholder = false, generatedAt = new Date().toISOString() } = {}) {
  const payload = { generatedAt, placeholder, photos }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  return payload
}

/** 读 src/data/photos.json；不存在或损坏返回 null（由调用方决定怎么报告） */
export function readPhotosFile(file) {
  if (!fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}
