/**
 * 构建后处理：把 dist/ 变成 GitHub Pages 能直接用的静态站点。
 *
 * 两件事，缺一不可：
 * 1. .nojekyll —— GitHub Pages 默认用 Jekyll 处理站点，它会**忽略下划线开头的文件**
 *    （Vite 产物里就有 _plugin-vue_export-helper-*.js 这类文件），没有它页面会白屏。
 * 2. 404.html = index.html 的副本 —— 本项目路由是 history 模式（/gallery、/story…），
 *    直接访问或刷新子路径时 GitHub Pages 找不到文件会返回它的 404 页；
 *    用同样的 HTML 兜底，SPA 启动后路由能自己解析回正确的页面。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html 不存在，先跑 vite build')
  process.exit(1)
}

fs.writeFileSync(path.join(DIST, '.nojekyll'), '')
fs.copyFileSync(path.join(DIST, 'index.html'), path.join(DIST, '404.html'))

console.log('postbuild: 已写入 .nojekyll 与 404.html（SPA 兜底）')
