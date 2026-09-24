/**
 * 无浏览器渲染验证工具（scripts/lib/render.mjs）
 *
 * 为什么需要它：本项目的开发环境里 Vite 起不来（esbuild 需要 spawn 子进程，沙箱拒绝），
 * 也不是随时都有真实浏览器。这个模块用 vue/compiler-sfc + sass + vue/server-renderer
 * 在 Node 里**真编译、真渲染**组件，把"组件能不能跑、输出什么 DOM"变成可断言的检查。
 *
 * 用法（在 scripts/checks/*.mjs 里）：
 *   export default async function ({ check, render, load, makePhoto }) {
 *     const html = await render('src/components/common/LazyImage.vue', { photo: makePhoto() })
 *     check('渲染出 img', html.includes('<img'))
 *   }
 *
 * 注意：SSR 不执行 onMounted / IntersectionObserver / 手势 —— 交互逻辑仍需真机走查。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const req = createRequire(path.join(ROOT, 'package.json'))

const vue = req('vue')
const sfc = req('vue/compiler-sfc')
const sass = req('sass')
const ts = req('typescript')
const { renderToString } = req('vue/server-renderer')

export { vue, sfc, sass, ts, renderToString }

/** 极简 DOM 垫片：只够组件在 SSR 里初始化，不实现任何浏览器行为 */
export function installDomShim() {
  if (globalThis.document) return
  globalThis.document = { title: '', addEventListener() {}, removeEventListener() {}, documentElement: { style: {} } }
  globalThis.window = {
    scrollY: 0,
    innerHeight: 800,
    innerWidth: 1440,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  }
  globalThis.matchMedia = globalThis.window.matchMedia
}

/** 路由垫片：路由表是冻结文件，这里只替代 RouterLink / RouterView / useRoute */
let CURRENT = { path: '/', query: {}, meta: { title: '' } }
export function setRoute(patch) {
  CURRENT = { ...CURRENT, ...patch }
}
export function resetRoute() {
  CURRENT = { path: '/', query: {}, meta: { title: '' } }
}
const vueRouterStub = {
  RouterLink: vue.defineComponent({
    name: 'RouterLink',
    props: { to: { type: [String, Object], required: true } },
    setup(props, { slots, attrs }) {
      const to = typeof props.to === 'string' ? props.to : props.to?.path ?? '/'
      return () => vue.h('a', { href: to, ...attrs }, slots.default ? slots.default() : [])
    }
  }),
  RouterView: { name: 'RouterView', render: () => null },
  useRoute: () => CURRENT,
  useRouter: () => ({ push() {}, replace() {}, back() {} }),
  // 让 src/router/index.ts 能被加载并读出 routes（检查导航完整性用）
  createWebHistory: () => ({ base: '/' }),
  createWebHashHistory: () => ({ base: '/' }),
  createMemoryHistory: () => ({ base: '/' }),
  createRouter: (options = {}) => ({
    ...options,
    currentRoute: { value: CURRENT },
    install() {},
    push() {},
    replace() {},
    back() {},
    forward() {},
    go() {},
    beforeEach() {},
    afterEach() {},
    resolve: (to) => ({ href: typeof to === 'string' ? to : to?.path ?? '/' }),
    isReady: () => Promise.resolve(true)
  })
}

const cache = new Map()
let collector = null

/**
 * 源码里的 import.meta.env.* 必须先替换成字面量。
 * 原因：这个渲染器用 new Function 执行转译后的代码，而 new Function 里
 * 不存在 import.meta（它不是模块作用域），会直接抛
 * "Cannot use 'import.meta' outside a module"。
 * src/router/index.ts 用了 import.meta.env.BASE_URL，正是靠这一步才能被加载。
 */
const IMPORT_META_ENV = { BASE_URL: '/', MODE: 'test', DEV: false, PROD: true, SSR: false }
function shimImportMeta(source) {
  return source.replace(/import\.meta\.env\.(\w+)/g, (_m, key) =>
    JSON.stringify(Object.prototype.hasOwnProperty.call(IMPORT_META_ENV, key) ? IMPORT_META_ENV[key] : '')
  )
}

function resolveSpec(spec, fromFile) {
  if (spec.startsWith('@/')) spec = path.join(ROOT, 'src', spec.slice(2))
  else if (spec.startsWith('.')) spec = path.resolve(path.dirname(fromFile), spec)
  else return spec
  if (fs.existsSync(spec) && fs.statSync(spec).isFile()) return spec
  for (const e of ['.ts', '.vue', '.json', '/index.ts']) {
    if (fs.existsSync(spec + e)) return spec + e
  }
  throw new Error('unresolved import ' + spec + ' from ' + fromFile)
}

function localRequireFor(fromFile) {
  return (spec) => {
    if (spec === 'vue') return vue
    if (spec === 'vue-router') return vueRouterStub
    if (spec === 'photoswipe') return { default: class {} }
    if (spec === 'photoswipe/dist/photoswipe.css') return {}
    if (spec.startsWith('@/') || spec.startsWith('.')) return load(resolveSpec(spec, fromFile))
    throw new Error('unresolved import ' + spec + ' from ' + fromFile)
  }
}

/** 加载任意 src 下的 .ts / .vue / .json（含 @/ 别名解析） */
export function load(file) {
  file = path.resolve(file)
  const hit = cache.get(file)
  if (hit !== undefined) return hit
  const ext = path.extname(file)
  if (ext === '.json') {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    cache.set(file, data)
    return data
  }
  if (ext === '.ts') {
    const out = ts.transpileModule(shimImportMeta(fs.readFileSync(file, 'utf8')), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, isolatedModules: true },
      fileName: file
    }).outputText
    const module = { exports: {} }
    cache.set(file, module.exports)
    const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', out)
    fn(module.exports, localRequireFor(file), module, file, path.dirname(file))
    const exported = module.exports.default !== undefined ? module.exports.default : module.exports
    cache.set(file, exported)
    return exported
  }
  if (ext !== '.vue') throw new Error('unsupported module: ' + file)

  const source = fs.readFileSync(file, 'utf8')
  const parsed = sfc.parse(source, { filename: file })
  if (parsed.errors.length) throw new Error('SFC parse error in ' + file + ': ' + JSON.stringify(parsed.errors))
  const descriptor = parsed.descriptor
  const id = 'v' + Buffer.from(file).toString('hex').slice(-8)

  // 样式：用 sass 真编译一次，SCSS 语法/变量拼写错误会在这里暴露
  for (const style of descriptor.styles) {
    const label = 'sass 编译 ' + path.basename(file) + (style.scoped ? ' (scoped)' : ' (global)')
    try {
      sass.compileString(style.content, { syntax: style.lang === 'scss' || !style.lang ? 'scss' : 'css' })
      collector?.(label, true)
    } catch (err) {
      collector?.(label, false, String(err.message))
    }
  }

  // <script setup> 里同样可能出现 import.meta.env.*
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block) block.content = shimImportMeta(block.content)
  }

  const compiled = sfc.compileScript(descriptor, {
    id,
    inlineTemplate: true,
    templateOptions: { compilerOptions: { hoistStatic: false } }
  })
  const out = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, isolatedModules: true },
    fileName: file
  }).outputText

  const module = { exports: {} }
  cache.set(file, module.exports)
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', out)
  fn(module.exports, localRequireFor(file), module, file, path.dirname(file))
  const exported = module.exports.default !== undefined ? module.exports.default : module.exports
  cache.set(file, exported)
  return exported
}

/** 造一张符合 Photo 类型的测试照片 */
export function makePhoto(patch = {}) {
  return {
    id: 'P0001',
    src: '/photos/preview/P0001.webp',
    thumb: '/photos/thumb/P0001.webp',
    blur: '/photos/blur/P0001.webp',
    width: 2048,
    height: 1365,
    ratio: 1.5,
    time: '2026-09-16T08:23:00',
    color: '#8a7a6d',
    order: 1,
    featured: false,
    moment: false,
    scene: null,
    people: [],
    tags: [],
    description: null,
    focus: null,
    ...patch
  }
}

/** 造 N 张连续测试照片 */
export function makePhotos(count, patch = {}) {
  return Array.from({ length: count }, (_, i) =>
    makePhoto({
      id: 'P' + String(i + 1).padStart(4, '0'),
      src: '/photos/preview/P' + String(i + 1).padStart(4, '0') + '.webp',
      thumb: '/photos/thumb/P' + String(i + 1).padStart(4, '0') + '.webp',
      blur: '/photos/blur/P' + String(i + 1).padStart(4, '0') + '.webp',
      ratio: [1.5, 0.6667, 1, 1.3333][i % 4],
      order: i + 1,
      ...patch
    })
  )
}

/**
 * 渲染一个 .vue 组件并返回 HTML 字符串。
 * props: 传给组件的 props；slot: 插槽内容（HTML 字符串数组）；global: 全局插件（如 RouterLink 垫片）
 */
export async function render(file, props = {}, options = {}) {
  const component = typeof file === 'string' ? load(file) : file
  const slots = {}
  if (options.slot !== undefined) {
    slots.default = () => vue.h('div', { innerHTML: Array.isArray(options.slot) ? options.slot.join('') : options.slot })
  }
  if (options.slots) {
    for (const [name, html] of Object.entries(options.slots)) {
      slots[name] = () => vue.h('div', { innerHTML: html })
    }
  }
  const app = vue.createSSRApp({ render: () => vue.h(component, props, slots) })
  app.component('RouterLink', vueRouterStub.RouterLink)
  app.component('RouterView', vueRouterStub.RouterView)
  app.config.globalProperties.$route = CURRENT
  if (options.setup) options.setup(app)
  return await renderToString(app)
}

/** 由 runner 注入，用于把组件内部（如 sass 编译）的检查也计入 */
export function setCollector(fn) {
  collector = fn
}
