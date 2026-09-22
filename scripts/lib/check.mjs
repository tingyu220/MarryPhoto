/**
 * 校验：把生成物（photos.json + public/photos/**）与人工标注（photos.overrides.json）
 * 对起来，找出真正会坏事的问题。
 *
 * 受控词表的唯一来源是 src/data/taxonomy.ts —— 这里运行时解析它的 label map，
 * 解析失败才退回下面镜像的常量（保证 --check 不会因为文件格式微调而失效）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadIndex, readPhotosFile, parseId } from './ids.mjs'

export const VOCAB_FALLBACK = {
  scenes: ['preparation', 'pickup', 'ceremony', 'family', 'banquet', 'after'],
  people: ['sister', 'groom', 'father', 'mother', 'family', 'friends', 'bridesmaid', 'groomsman', 'kid'],
  tags: ['portrait', 'candid', 'detail', 'scene', 'group', 'moment', 'preparation', 'emotion']
}

/** 从 taxonomy.ts 里抠出 label map 的键 */
function parseLabelKeys(text, constName) {
  const body = new RegExp('export const ' + constName + '[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}').exec(text)
  if (!body) return null
  const keys = []
  const keyRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm
  let m
  while ((m = keyRe.exec(body[1])) !== null) keys.push(m[1])
  return keys.length > 0 ? keys : null
}

/** 读取受控词表：优先解析 taxonomy.ts，失败退回镜像常量 */
export function readVocabulary(repoRoot) {
  const file = path.join(repoRoot, 'src', 'data', 'taxonomy.ts')
  try {
    const text = fs.readFileSync(file, 'utf8')
    const scenes = parseLabelKeys(text, 'SCENE_LABELS')
    const people = parseLabelKeys(text, 'PEOPLE_LABELS')
    const tags = parseLabelKeys(text, 'TAG_LABELS')
    if (scenes && people && tags) return { source: 'src/data/taxonomy.ts', scenes, people, tags }
  } catch {
    /* 落到下面的兜底 */
  }
  return { source: '(内置镜像常量，未能解析 taxonomy.ts)', ...VOCAB_FALLBACK }
}

/** 读取 photos.overrides.json；不存在时返回 {} */
export function readOverrides(file) {
  if (!fs.existsSync(file)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return null
  }
}

const SAMPLE = 8

function sample(ids) {
  if (ids.length <= SAMPLE) return ids.join('、')
  return ids.slice(0, SAMPLE).join('、') + ' …（共 ' + ids.length + ' 个）'
}

/**
 * 执行全部校验。
 * @returns {{ errors: {title: string, detail: string}[], notes: {title: string, detail: string}[],
 *             stats: Record<string, unknown>, vocabulary: object }}
 */
export async function runChecks(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const photosFile = options.photosFile ?? path.join(repoRoot, 'src', 'data', 'photos.json')
  const overridesFile = options.overridesFile ?? path.join(repoRoot, 'src', 'data', 'photos.overrides.json')
  const publicRoot = options.publicRoot ?? path.join(repoRoot, 'public', 'photos')
  const indexFile = options.indexFile ?? path.join(repoRoot, 'photos', 'index.json')

  const vocabulary = readVocabulary(repoRoot)
  const errors = []
  const notes = []
  const stats = {
    photosFile,
    overridesFile,
    publicRoot,
    total: 0,
    overridesCount: 0,
    unannotated: 0,
    placeholder: false,
    generatedAt: null,
    indexCount: 0
  }

  const photosPayload = readPhotosFile(photosFile)
  if (!photosPayload) {
    errors.push({
      title: 'photos.json 缺失或无法解析',
      detail: photosFile + ' —— 请先运行 npm run photos 或 npm run placeholders'
    })
    return { errors, notes, stats, vocabulary }
  }

  const allPhotos = Array.isArray(photosPayload.photos) ? photosPayload.photos : []
  stats.placeholder = photosPayload.placeholder === true
  stats.generatedAt = photosPayload.generatedAt ?? null
  stats.total = allPhotos.length

  const overrides = readOverrides(overridesFile)
  if (overrides === null) {
    errors.push({ title: 'photos.overrides.json 不是合法 JSON', detail: overridesFile })
  }
  const overrideEntries = overrides ? Object.entries(overrides) : []
  stats.overridesCount = overrideEntries.length

  // ---- 1. ID 自身的一致性 ----
  const idSet = new Set()
  const duplicates = []
  for (const photo of allPhotos) {
    if (typeof photo?.id !== 'string' || parseId(photo.id) === null) {
      errors.push({ title: 'photos.json 里存在非法 ID', detail: JSON.stringify(photo?.id) })
      continue
    }
    if (idSet.has(photo.id)) duplicates.push(photo.id)
    idSet.add(photo.id)
  }
  if (duplicates.length > 0) {
    errors.push({ title: 'photos.json 存在重复 ID', detail: sample(duplicates) })
  }

  // ---- 2. overrides 指向不存在的 id ----
  const orphans = overrideEntries.filter(([id]) => !idSet.has(id)).map(([id]) => id)
  if (orphans.length > 0) {
    errors.push({
      title: 'overrides 里指向不存在的照片 ID：' + orphans.length + ' 条',
      detail: sample(orphans) + '  —— 通常是 ID 拼错，或照片已被移除'
    })
  }

  // ---- 3. overrides 里超出受控词表的值 ----
  const badScene = []
  const badPeople = []
  const badTags = []
  for (const [id, value] of overrideEntries) {
    if (!value || typeof value !== 'object') continue
    if (value.scene !== undefined && value.scene !== null && !vocabulary.scenes.includes(value.scene)) {
      badScene.push(id + ' → ' + JSON.stringify(value.scene))
    }
    if (Array.isArray(value.people)) {
      for (const person of value.people) {
        if (!vocabulary.people.includes(person)) badPeople.push(id + ' → ' + JSON.stringify(person))
      }
    }
    if (Array.isArray(value.tags)) {
      for (const tag of value.tags) {
        if (!vocabulary.tags.includes(tag)) badTags.push(id + ' → ' + JSON.stringify(tag))
      }
    }
  }
  const badVocab = [
    ...badScene.map((s) => 'scene ' + s),
    ...badPeople.map((s) => 'people ' + s),
    ...badTags.map((s) => 'tags ' + s)
  ]
  if (badVocab.length > 0) {
    errors.push({
      title: 'overrides 里超出受控词表的值：' + badVocab.length + ' 处',
      detail: sample(badVocab) + '  —— 词表见 ' + vocabulary.source
    })
  }

  // ---- 4. 缺失的产物文件 ----
  const missing = { thumb: [], medium: [], preview: [], blur: [] }
  for (const photo of allPhotos) {
    if (typeof photo?.id !== 'string') continue
    for (const name of ['thumb', 'medium', 'preview', 'blur']) {
      const file = path.join(publicRoot, name, photo.id + '.webp')
      if (!fs.existsSync(file)) missing[name].push(photo.id)
    }
  }
  const missingTotal = missing.thumb.length + missing.medium.length + missing.preview.length + missing.blur.length
  if (missingTotal > 0) {
    const lines = []
    if (missing.preview.length) lines.push('preview 缺 ' + missing.preview.length + ' 个：' + sample(missing.preview))
    if (missing.medium.length) lines.push('medium 缺 ' + missing.medium.length + ' 个：' + sample(missing.medium))
    if (missing.thumb.length) lines.push('thumb 缺 ' + missing.thumb.length + ' 个：' + sample(missing.thumb))
    if (missing.blur.length) lines.push('blur 缺 ' + missing.blur.length + ' 个：' + sample(missing.blur))
    errors.push({
      title: '缺失的产物文件：' + missingTotal + ' 个',
      detail: lines.join('\n           ') + '  —— 运行 npm run photos 重新生成'
    })
  }

  // ---- 5. 尚未标注的照片（提示，不算错误）----
  const unannotated = allPhotos.filter((p) => typeof p?.id === 'string' && !overrides?.[p.id]).map((p) => p.id)
  stats.unannotated = unannotated.length
  if (unannotated.length > 0) {
    notes.push({
      title: 'photos 里没有 overrides 的照片：' + unannotated.length + ' 张',
      detail: sample(unannotated) + '  —— 未标注不影响运行，只是这些照片没有描述/分类'
    })
  }

  // ---- 6. 生成物内部一致性（提示）----
  const orderIssues = []
  const ratioIssues = []
  const sorted = allPhotos.filter((p) => typeof p?.id === 'string')
  sorted.forEach((photo, i) => {
    if (photo.order !== i + 1) orderIssues.push(photo.id + '(order=' + photo.order + ')')
    const expected = photo.width / photo.height
    if (!(photo.width > 0) || !(photo.height > 0) || Math.abs(photo.ratio - expected) > 0.001) {
      ratioIssues.push(photo.id)
    }
  })
  if (orderIssues.length > 0) {
    notes.push({ title: 'order 不是 1..N 连续：' + orderIssues.length + ' 张', detail: sample(orderIssues) })
  }
  if (ratioIssues.length > 0) {
    notes.push({ title: 'ratio 与 width/height 不一致：' + ratioIssues.length + ' 张', detail: sample(ratioIssues) })
  }

  const timeNulls = allPhotos.filter((p) => p?.time === null || p?.time === undefined)
  if (timeNulls.length > 0) {
    notes.push({
      title: '没有拍摄时间的照片（排在最后）：' + timeNulls.length + ' 张',
      detail: sample(timeNulls.map((p) => p.id))
    })
  }

  // ---- 7. index.json 与 photos.json 的对照（提示）----
  try {
    const index = loadIndex(indexFile)
    stats.indexCount = Object.keys(index).length
    const indexIds = new Set(Object.values(index))
    const notIndexed = allPhotos.filter((p) => !indexIds.has(p?.id)).map((p) => p.id)
    if (notIndexed.length > 0) {
      notes.push({
        title: 'photos.json 里存在 index.json 未记录的照片：' + notIndexed.length + ' 张',
        detail: sample(notIndexed)
      })
    }
  } catch (err) {
    errors.push({ title: 'photos/index.json 无法解析', detail: String(err.message ?? err) })
  }

  return { errors, notes, stats, vocabulary }
}

/** 人类可读的中文报告 */
export function formatReport(result) {
  const { errors, notes, stats, vocabulary } = result
  const lines = []
  lines.push('')
  lines.push('──────── 照片管线校验报告 ────────')
  lines.push('photos.json      : ' + stats.photosFile)
  lines.push('overrides        : ' + stats.overridesFile + '（' + stats.overridesCount + ' 条）')
  lines.push('产物目录         : ' + stats.publicRoot)
  lines.push('受控词表来源     : ' + vocabulary.source)
  lines.push('照片总数         : ' + stats.total + (stats.placeholder ? '（占位数据 placeholder=true）' : '（真实照片 placeholder=false）'))
  lines.push('index.json 记录  : ' + stats.indexCount + ' 条')
  lines.push('生成时间         : ' + (stats.generatedAt ?? '—'))
  lines.push('')
  if (errors.length > 0) {
    lines.push('【错误】' + errors.length + ' 项')
    errors.forEach((item, i) => {
      lines.push('  ' + (i + 1) + '. ' + item.title)
      if (item.detail) lines.push('           ' + item.detail)
    })
    lines.push('')
  }
  if (notes.length > 0) {
    lines.push('【提示】' + notes.length + ' 项（不影响运行）')
    notes.forEach((item, i) => {
      lines.push('  ' + (i + 1) + '. ' + item.title)
      if (item.detail) lines.push('           ' + item.detail)
    })
    lines.push('')
  }
  if (errors.length === 0 && notes.length === 0) {
    lines.push('  一切正常：没有孤立 ID、没有越界词表值、产物文件齐全。')
    lines.push('')
  }
  lines.push(errors.length === 0 ? '结论：✅ 校验通过（0 个错误）' : '结论：❌ 校验未通过（' + errors.length + ' 个错误）')
  lines.push('')
  return lines.join('\n')
}
