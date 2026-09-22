/**
 * 性能预算检查：读 dist/ 实际产物，对照 docs/01 §15 的指标。
 * 用法：npm run build && npm run budget
 *
 * 为什么要有它：性能目标写在文档里如果没人量，就等于没有。
 * 这里只量"能静态量到的"（JS/CSS 体积、图片体积分布）；
 * LCP / CLS 这类需要真实浏览器，交给 Wave 4 真机走查。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const PHOTOS = path.join(ROOT, 'public', 'photos')

/** 单位：KB（gzip 后） */
const BUDGET = {
  entryJs: 200,      // 首屏必需的 JS（index-*.js）gzip 上限
  entryCss: 30,
  totalJs: 400,      // 所有 JS 分包合计（不是首屏下载量，只防失控）
  thumbAvg: 60,      // 单张缩略图平均
  mediumAvg: 200,    // 单张中图平均（桌面端中等尺寸展示用；介于 thumb 与 preview 之间）
  previewAvg: 500    // 单张预览图平均（真实照片会比现在大很多，这条才是真防线）
}

let failed = 0
function check(label, ok, detail) {
  if (!ok) failed++
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  :: ' + detail : ''))
}

const gz = (buf) => zlib.gzipSync(buf).length
const kb = (n) => Number((n / 1024).toFixed(2))

if (!fs.existsSync(DIST)) {
  console.log('没有 dist/，先跑 npm run build')
  process.exit(1)
}

const assetsDir = path.join(DIST, 'assets')
const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : []
const js = assets.filter((f) => f.endsWith('.js'))
const css = assets.filter((f) => f.endsWith('.css'))

const entry = js.find((f) => /^index-.*\.js$/.test(f))
if (entry) {
  const size = gz(fs.readFileSync(path.join(assetsDir, entry)))
  check('首屏入口 JS gzip < ' + BUDGET.entryJs + 'KB', kb(size) < BUDGET.entryJs, entry + ' = ' + kb(size) + 'KB')
} else {
  check('存在首屏入口 JS', false, 'assets 里没有 index-*.js')
}

const entryCss = css.find((f) => /^index-.*\.css$/.test(f))
if (entryCss) {
  const size = gz(fs.readFileSync(path.join(assetsDir, entryCss)))
  check('首屏入口 CSS gzip < ' + BUDGET.entryCss + 'KB', kb(size) < BUDGET.entryCss, kb(size) + 'KB')
}

const totalJs = js.reduce((sum, f) => sum + gz(fs.readFileSync(path.join(assetsDir, f))), 0)
check('全部 JS 合计 gzip < ' + BUDGET.totalJs + 'KB', kb(totalJs) < BUDGET.totalJs, kb(totalJs) + 'KB / ' + js.length + ' 个分包')

// 路由级代码分割：每个页面应有自己的分包
check('路由级代码分割生效（≥5 个页面分包）', js.filter((f) => !/^index-/.test(f)).length >= 5,
  js.filter((f) => !/^index-/.test(f)).length + ' 个非入口分包')

for (const [dir, limit, label] of [
  ['thumb', BUDGET.thumbAvg, '缩略图'],
  ['medium', BUDGET.mediumAvg, '中图'],
  ['preview', BUDGET.previewAvg, '预览图']
]) {
  const d = path.join(PHOTOS, dir)
  if (!fs.existsSync(d)) continue
  const files = fs.readdirSync(d)
  if (files.length === 0) continue
  const sum = files.reduce((s, f) => s + fs.statSync(path.join(d, f)).size, 0)
  const avg = kb(sum / files.length)
  const max = kb(Math.max(...files.map((f) => fs.statSync(path.join(d, f)).size)))
  check(label + '平均 < ' + limit + 'KB（' + files.length + ' 张）', avg < limit, '平均 ' + avg + 'KB / 最大 ' + max + 'KB')
}

console.log('\n' + (failed === 0 ? '✅ 预算全部达标' : '❌ ' + failed + ' 项超预算'))
process.exit(failed === 0 ? 0 : 1)
