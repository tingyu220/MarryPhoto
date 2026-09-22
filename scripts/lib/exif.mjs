/**
 * EXIF 工具：扩展名过滤、拍摄时间读取、时间格式化。
 *
 * 时间语义（关键）：
 *   EXIF 的 DateTimeOriginal 是"相机本地墙上时间"，不含时区。
 *   全站 photos.json 的 time 同样使用不带时区的本地墙上时间（如 2026-10-18T08:23:00）。
 *   所以这里用 { reviveValues: false } 直接取原始字符串（"2026:10:18 08:23:45"）自己解析，
 *   绝不做时区换算 —— 否则整批照片会被平移几个小时。
 *   若某个 exifr 版本仍返回 Date，则用"本地 getter"格式化（实测 exifr 把墙上时间
 *   放在本地时区语义上，本地 getter 能还原原始墙上时间）。
 */
import fs from 'node:fs'
import exifr from 'exifr'

/** 支持扫描的扩展名（小写，含点） */
export const PHOTO_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.webp'
])

/** exifr 无法解析时仍要退回 mtime 的容错：任何异常都不允许中断整条管线 */
const EXIF_PICK = ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized']

export function isPhotoFile(fileName) {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return false
  return PHOTO_EXTENSIONS.has(fileName.slice(dot).toLowerCase())
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Date → 'YYYY-MM-DDTHH:mm:ss'（本地墙上时间，不带时区） */
export function formatLocal(date) {
  return (
    String(date.getFullYear()) +
    '-' + pad2(date.getMonth() + 1) +
    '-' + pad2(date.getDate()) +
    'T' + pad2(date.getHours()) +
    ':' + pad2(date.getMinutes()) +
    ':' + pad2(date.getSeconds())
  )
}

/**
 * 把 exifr 的返回值（原始字符串 / Date）统一成 'YYYY-MM-DDTHH:mm:ss'。
 * 无法识别时返回 null。
 */
export function toIsoLocal(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : formatLocal(value)
  }
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : formatLocal(d)
  }
  if (typeof value === 'string') {
    const m = /^(\d{4})[:\-/](\d{2})[:\-/](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim())
    if (m) return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] ?? '00')
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : formatLocal(d)
  }
  return null
}

/**
 * 读取一张照片的拍摄时间。
 * 优先级：DateTimeOriginal → CreateDate → 文件 mtime → null
 * @returns {Promise<{ time: string|null, source: 'DateTimeOriginal'|'CreateDate'|'mtime'|'none' }>}
 */
export async function readTakenAt(filePath) {
  let tags = null
  try {
    tags = await exifr.parse(filePath, { pick: EXIF_PICK, reviveValues: false })
  } catch {
    tags = null
  }
  if (tags && typeof tags === 'object') {
    const original = toIsoLocal(tags.DateTimeOriginal)
    if (original) return { time: original, source: 'DateTimeOriginal' }
    const created = toIsoLocal(tags.CreateDate ?? tags.DateTimeDigitized)
    if (created) return { time: created, source: 'CreateDate' }
  }
  try {
    const st = fs.statSync(filePath)
    return { time: formatLocal(st.mtime), source: 'mtime' }
  } catch {
    return { time: null, source: 'none' }
  }
}

/** 便于在没有 EXIF 时单独取 mtime */
export function mtimeIso(filePath) {
  try {
    return formatLocal(fs.statSync(filePath).mtime)
  } catch {
    return null
  }
}
