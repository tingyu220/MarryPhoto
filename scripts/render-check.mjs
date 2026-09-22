/**
 * 无浏览器渲染检查的运行器。
 *
 *   npm run render-check          跑 scripts/checks/*.mjs 里的全部检查
 *   node scripts/render-check.mjs nav  只跑文件名含 "nav" 的检查
 *
 * 每个 scripts/checks/*.mjs 默认导出一个函数：
 *   export default async function ({ check, render, load, makePhoto, makePhotos }) { ... }
 *
 * 这是本项目在没有浏览器可用时的标准验证手段（配合 npm run typecheck 使用）。
 * 它不能替代真机走查：手势、滚动、IntersectionObserver 都不会在 Node 里执行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, installDomShim, setCollector, setRoute, resetRoute, render, load, makePhoto, makePhotos } from './lib/render.mjs'

installDomShim()

const filter = process.argv[2] ?? ''
const checksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'checks')

let passed = 0
let failed = 0
let skippedCount = 0
function check(name, ok, extra) {
  if (ok) passed++
  else failed++
  const line = (ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : '')
  console.log(line)
}
/**
 * 跳过一条依赖"内容状态"的断言。
 *
 * 为什么需要它：有些断言的前提是"照片已经标注过"（有精选、有人物、有瞬间）。
 * 内容还没整理好时它们必然红，但那不是代码坏了 —— 红黄不分会让这套检查失去意义。
 * 规则：**代码契约只能用 check，内容前提才能用 skip**；宁可 skip 也不许把断言删掉。
 */
function skip(name, reason) {
  skippedCount++
  console.log('SKIP  ' + name + (reason ? '  :: ' + reason : ''))
}
setCollector(check)

// 只认"NN-名字.mjs"这种编号命名；其余 .mjs（临时脚本、dump 文件）跳过并提示，
// 避免某个代理的半成品文件把整轮检查搞崩。
const all = fs.existsSync(checksDir) ? fs.readdirSync(checksDir).filter((f) => f.endsWith('.mjs')) : []
const files = all.filter((f) => /^\d{2}-/.test(f) && f.includes(filter)).sort()
const skipped = all.filter((f) => !/^\d{2}-/.test(f))
if (skipped.length) {
  console.log('提示：以下文件不符合 "NN-名字.mjs" 命名，已跳过：' + skipped.join(', '))
}

if (files.length === 0) {
  console.log('没有找到可运行的检查文件（scripts/checks/*.mjs）')
  process.exit(0)
}

for (const f of files) {
  console.log('\n--- ' + f + ' ---')
  resetRoute()
  let mod
  try {
    mod = await import(pathToFileURL(path.join(checksDir, f)).href)
  } catch (err) {
    // 单个检查文件加载失败不能拖垮整轮
    check(f + ' 能被 Node 加载（import 无错）', false, String(err && err.message ? err.message : err))
    continue
  }
  if (typeof mod.default !== 'function') {
    check(f + ' 默认导出必须是函数', false)
    continue
  }
  try {
    await mod.default({ check, skip, render, load, makePhoto, makePhotos, setRoute, resetRoute, ROOT })
  } catch (err) {
    check(f + ' 执行未抛异常', false, String(err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err))
  }
}

console.log('\n合计：' + passed + ' 通过 / ' + failed + ' 失败' + (skippedCount ? ' / ' + skippedCount + ' 跳过（内容未就绪，不是代码问题）' : ''))
process.exit(failed === 0 ? 0 : 1)
