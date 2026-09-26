/**
 * Memory Vortex（/experience）的契约级断言 · Phase 3 原型。
 *
 * Node 里没有 WebGL，所以这里**只断能证明的东西**：
 *   - 螺旋几何（12 个点的高度/半径递增、中心镂空、公式与任务书一致）；
 *   - 选片（featured 优先、不足 12 张从 all 按 order 补足、不重复、不复制对象）；
 *   - 降级判定（prefers-reduced-motion / WebGL 不可用 → 2D 兜底）；
 *   - 模块可加载、SSR 不白屏、兜底仍然可点开现有查看器；
 *   - 释放路径与逐帧红线（源码级：逐帧区间里没有 new、没有 Vue 响应式）。
 *
 * 它**不能**替代真机走查：旋转好不好看、相纸像不像相纸、显存到底有没有回落，
 * 都需要在真浏览器里看（tasks 汇报里列了清单）。
 */
import fs from 'node:fs'
import path from 'node:path'

const EXPERIENCE_DIR = 'src/components/experience'
const COMPONENT_FILES = [
  EXPERIENCE_DIR + '/MemoryVortex.vue',
  EXPERIENCE_DIR + '/VortexScene.vue',
  EXPERIENCE_DIR + '/VortexPhoto.vue',
  EXPERIENCE_DIR + '/VortexCenter.vue',
  EXPERIENCE_DIR + '/VortexFallback.vue'
]
const VIEW_FILE = 'src/views/ExperienceView.vue'

export default async function ({ check, render, load, makePhotos, ROOT }) {
  const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
  const V = load('src/composables/useVortex.ts')

  /* ───────────────────────── 1. 路由：独立页面 ───────────────────────── */

  const routes = load('src/router/index.ts').routes ?? []
  const experience = routes.find((route) => route.name === 'experience')
  check('/experience 是一条独立路由（不是 /gallery 的 query view）',
    experience !== undefined && experience.path === '/experience',
    experience ? experience.path + ' name=' + experience.name : '没找到 name=experience 的路由')
  check('路由标题是「影像馆」',
    experience?.meta?.title === '影像馆', String(experience?.meta?.title))
  check('/gallery 与 /experience 是两条并列记录（没有把影像馆塞进 Gallery 的 view 参数）',
    routes.filter((route) => route.path === '/gallery').length === 1 &&
      routes.some((route) => route.path === '/experience') &&
      !/experience/.test(JSON.stringify(routes.find((route) => route.path === '/gallery')?.meta ?? {})))
  check('ExperienceView 走路由级懒加载（three 不会被打进首屏入口）',
    typeof experience?.component === 'function' && String(experience.component).includes('ExperienceView'),
    String(experience?.component))

  /* ───────────────────────── 2. 螺旋几何（12 个点） ───────────────────────── */

  const desktop = V.VORTEX_PRESETS.desktop
  const mobile = V.VORTEX_PRESETS.mobile
  const points = V.buildSpiral(12, desktop)

  check('buildSpiral(12) 给出 12 个点', points.length === 12, points.length + ' 个')
  check('高度逐张递增（螺旋是往上盘的）',
    points.every((point, index) => index === 0 || point.y > points[index - 1].y),
    points.map((point) => point.y.toFixed(2)).join(' '))
  check('半径逐张不减（越往上越敞开，不是正圆柱）',
    points.every((point, index) => index === 0 || point.radius > points[index - 1].radius),
    points[0].radius.toFixed(2) + ' → ' + points[11].radius.toFixed(2))
  check('角度按 angleStep 递进',
    points.every((point, index) => Math.abs(point.angle - index * desktop.angleStep) < 1e-9))
  check('点真的落在圆周上（x² + z² = radius²，公式没写反）',
    points.every((point) => Math.abs(Math.hypot(point.x, point.z) - point.radius) < 1e-9))
  const startHeight = V.startHeightOf(12, desktop)
  check('与任务书公式一致：y = startHeight + index × verticalGap',
    points.every((point, index) =>
      Math.abs(point.y - (startHeight + index * desktop.verticalGap)) < 1e-9))
  check('整条螺旋在垂直方向居中（第一张与最后一张对称）',
    Math.abs(points[0].y + points[11].y) < 1e-9)

  /* ───────────────────────── 3. 中心必须镂空 ───────────────────────── */

  const inner = V.innerRadiusOf(12, desktop)
  check('内半径 > 0（中心是空的，不是一根轴）', inner > 0, '内半径 ' + inner.toFixed(3))
  check('没有任何一点穿过中心轴（x² + z² ≥ 内半径²）',
    points.every((point) => point.x * point.x + point.z * point.z >= inner * inner))
  check('镂空是"真镂空"而不是一条缝（内半径 ≥ 最内圈半径的 30%）',
    inner >= desktop.radius * 0.3, '内半径/最内圈 = ' + (inner / desktop.radius).toFixed(2))
  check('照片是切向摆放的：朝向 = π/2 − angle（最近点就是切点，距离恒等于半径）',
    points.every((point) => Math.abs(point.rotationY - (Math.PI / 2 - point.angle)) < 1e-9))
  const ring = V.centerRingRadii(12, desktop)
  check('中心的细环落在内半径之外（中心环自己也不进空腔）',
    ring.inner >= inner && ring.outer > ring.inner,
    '环 ' + ring.inner.toFixed(2) + '~' + ring.outer.toFixed(2) + ' / 内半径 ' + inner.toFixed(2))
  check('环的高度在螺旋最底部之下（它接住的是整条螺旋）',
    ring.y < points[0].y, 'ring.y=' + ring.y.toFixed(2) + ' first.y=' + points[0].y.toFixed(2))
  check('极端全景也不会把内半径拖成负数（照片宽度有上限）',
    V.photoWidthOf({ ratio: 6 }, desktop) === desktop.photoHeight * V.VORTEX_MAX_ASPECT &&
      V.photoWidthOf({ ratio: 0.2 }, desktop) > 0,
    V.photoWidthOf({ ratio: 6 }, desktop).toFixed(2))
  check('手机档同样是中心镂空的',
    V.innerRadiusOf(12, mobile) > 0 && V.buildSpiral(12, mobile)
      .every((point) => point.x * point.x + point.z * point.z >= V.innerRadiusOf(12, mobile) ** 2),
    '内半径 ' + V.innerRadiusOf(12, mobile).toFixed(3))

  /* ───────────────────────── 4. 照片来源与选片 ───────────────────────── */

  const all = makePhotos(30)
  const featuredMany = all.filter((_, index) => index % 2 === 0) // 15 张
  const featuredFew = all.slice(0, 10)
  const featuredTiny = all.slice(0, 3)

  const onlyFeatured = V.pickVortexPhotos(featuredMany, all, { min: 12, limit: 18 })
  check('featured 足够时只用 featured（不会掺进 all 里的其它照片）',
    onlyFeatured.length === 15 && onlyFeatured.every((photo) => featuredMany.includes(photo)),
    onlyFeatured.length + ' 张，全部来自 featured=' +
      onlyFeatured.every((photo) => featuredMany.includes(photo)))
  check('featured 足够时不补位（补位只发生在不足 12 张时）',
    onlyFeatured.every((photo) => photo.featured === false && featuredMany.includes(photo)))

  const filled = V.pickVortexPhotos(featuredFew, all, { min: 12, limit: 18 })
  check('featured 不足 12 张时，从 all 按 order 补到 12 张',
    filled.length === 12, filled.length + ' 张')
  check('补位从 all 里取（前 10 张就是那 10 张 featured，顺序不变）',
    featuredFew.every((photo, index) => filled[index] === photo),
    filled.slice(0, 3).map((photo) => photo.id).join(' '))
  check('补位没有重复（同一张照片不会在螺旋上出现两次）',
    new Set(filled.map((photo) => photo.id)).size === filled.length)
  check('结果按 order 升序（螺旋的顺序 = 拍摄顺序）',
    filled.every((photo, index) => index === 0 || photo.order > filled[index - 1].order),
    filled.map((photo) => photo.order).join(','))
  check('补进来的确实是 all 按 order 里最靠前的那些',
    filled.slice(10).map((photo) => photo.order).join(',') === '11,12',
    filled.slice(10).map((photo) => photo.id).join(' '))
  check('返回的是 Photo 对象本身（没有复制、没有重建）',
    filled[0] === featuredFew[0] && filled[10] === all[10])
  check('不会就地改动调用方的数组',
    featuredFew.length === 10 && all.length === 30 && all[0].id === 'P0001')

  const tiny = V.pickVortexPhotos(featuredTiny, all, { min: 12, limit: 18 })
  check('featured 只有 3 张时：3 张 featured + 9 张按 order 补足',
    tiny.length === 12 && tiny.slice(0, 3).every((photo, index) => photo === featuredTiny[index]) &&
      tiny.slice(3).map((photo) => photo.order).join(',') === '4,5,6,7,8,9,10,11,12',
    tiny.map((photo) => photo.id).join(' '))
  check('一张 featured 都没有时，仍然给出 12 张（从 all 补）',
    V.pickVortexPhotos([], all, { min: 12, limit: 18 }).length === 12)
  check('照片总数不足 12 张时：有多少给多少，不报错、不重复',
    V.pickVortexPhotos([], all.slice(0, 5), { min: 12, limit: 18 }).length === 5)
  check('上限生效：featured 有 30 张、limit=18 时也只取 18 张',
    V.pickVortexPhotos(all, all, { min: 12, limit: 18 }).length === 18)
  check('上限低于下限时以下限为准（宁可多给几张，也不给一个不成立的环）',
    V.pickVortexPhotos(all, all, { min: 12, limit: 8 }).length === 12)
  // featured 与补位混在一起时，整体仍然按 order 升序（螺旋顺着时间往上盘）
  const scattered = [all[8], all[2], all[4]] // order 9 / 3 / 5
  const interleaved = V.pickVortexPhotos(scattered, all, { min: 12, limit: 18 })
  check('featured 与补位混排时，最终结果整体按 order 升序',
    interleaved.length === 12 &&
      interleaved.every((photo, index) => index === 0 || photo.order > interleaved[index - 1].order),
    interleaved.map((photo) => photo.order).join(','))

  // 真实数据：usePhotos() 是唯一数据源，这里只消费它
  const source = load('src/composables/usePhotos.ts').usePhotos()
  const real = V.pickVortexPhotos(source.featured.value, source.all.value, { min: 12, limit: 18 })
  check('真实数据：选出来的照片都来自 usePhotos()（没有第二套照片 JSON）',
    real.length > 0 && real.every((photo) => source.all.value.includes(photo)),
    source.featured.value.length + ' 张 featured / ' + source.all.value.length + ' 张全部，选中 ' + real.length)
  check('真实数据：不超过上限、不重复、按 order 升序',
    real.length <= 18 && new Set(real.map((photo) => photo.id)).size === real.length &&
      real.every((photo, index) => index === 0 || photo.order > real[index - 1].order))

  /* ───────────────────────── 5. 降级判定 ───────────────────────── */

  check('prefers-reduced-motion → 走 2D 兜底（不做长时间旋转）',
    V.decideVortexMode({ photoCount: 18, webgl: true, reducedMotion: true }) === 'fallback')
  check('WebGL 不可用 → 走 2D 兜底（绝不白屏）',
    V.decideVortexMode({ photoCount: 18, webgl: false, reducedMotion: false }) === 'fallback')
  check('两者都正常 → 走 3D',
    V.decideVortexMode({ photoCount: 18, webgl: true, reducedMotion: false }) === 'scene')
  check('一张照片都没有 → empty（页面自己给空状态，不去建场景）',
    V.decideVortexMode({ photoCount: 0, webgl: true, reducedMotion: false }) === 'empty')
  check('没有 document 时 detectWebGL() 安全地返回 false（不抛错、不假装能画）',
    V.detectWebGL() === false)
  check('没有 matchMedia 结果时 prefersReducedMotion() 安全地返回 false',
    V.prefersReducedMotion() === false)

  // 覆盖 matchMedia，验证"系统打开减少动态效果"这条真实路径
  const originalMatchMedia = globalThis.window.matchMedia
  globalThis.matchMedia = globalThis.window.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {}
  })
  check('系统要求减少动态效果时 prefersReducedMotion() 为 true',
    V.prefersReducedMotion() === true)
  check('此时档位判定不再是 3D',
    V.decideVortexMode({
      photoCount: 18, webgl: true, reducedMotion: V.prefersReducedMotion()
    }) === 'fallback')
  const reducedHtml = await render(VIEW_FILE, {})
  check('减少动态效果时 /experience 渲染出来的是静态 2D 版面',
    reducedHtml.includes('vortex-fallback') && !reducedHtml.includes('vortex-scene'),
    reducedHtml.length + ' 字符')
  globalThis.matchMedia = globalThis.window.matchMedia = originalMatchMedia

  /* ───────────────────────── 6. 模块可加载 + SSR 不白屏 ───────────────────────── */

  for (const file of COMPONENT_FILES.concat([VIEW_FILE])) {
    let ok = true
    let detail = ''
    try {
      load(path.join(ROOT, file))
    } catch (error) {
      ok = false
      detail = String(error && error.message ? error.message : error)
    }
    check(path.basename(file) + ' 能被 Node 加载（import 无错）', ok, detail)
  }

  const html = await render(VIEW_FILE, {})
  check('/experience 在没有 WebGL 的环境里也能渲染出内容（不白屏）',
    typeof html === 'string' && html.length > 300, html.length + ' 字符')
  check('兜底版面是真按钮（键盘 / 触摸都能用）',
    (html.match(/<button/g) ?? []).length >= 12, (html.match(/<button/g) ?? []).length + ' 个按钮')
  check('兜底版面用的是 medium 档（不请求 preview / thumb）',
    /\/photos\/medium\//.test(html) && !/\/photos\/(preview|thumb|large)\//.test(html),
    (html.match(/src="[^"]*"/g) ?? []).slice(0, 2).join(' '))
  check('每张兜底照片都有可访问名（alt 永不为空）',
    !/alt=""/.test(html) && /alt="[^"]+"/.test(html))
  check('走不回去是不允许的：页面上有「全部照片」与「首页」两个入口',
    html.includes('href="/gallery"') && html.includes('href="/"'))
  check('页面标题是「影像馆 · 站名」',
    typeof globalThis.document.title === 'string' && globalThis.document.title.includes('影像馆'),
    String(globalThis.document.title))

  /* ───────────────────────── 7. 贴图档位（铁律：只用 medium） ───────────────────────── */

  const sources = {}
  for (const file of COMPONENT_FILES.concat([VIEW_FILE])) sources[file] = read(file)
  const experienceSource = Object.values(sources).join('\n')
  const vortPhotoSource = sources[EXPERIENCE_DIR + '/VortexPhoto.vue']
  const fallbackSource = sources[EXPERIENCE_DIR + '/VortexFallback.vue']
  const sceneSource = sources[EXPERIENCE_DIR + '/VortexScene.vue']
  const memorySource = sources[EXPERIENCE_DIR + '/MemoryVortex.vue']
  const centerSource = sources[EXPERIENCE_DIR + '/VortexCenter.vue']
  const viewSource = sources[VIEW_FILE]

  check('3D 贴图请求的是 photo.medium（长边 1280px）', /photo\.medium/.test(vortPhotoSource))
  check('2D 兜底也只用 medium（与 3D 同一档，不偷换）', /photo\.medium/.test(fallbackSource))
  check('体验页里没有任何一处直接取 preview / thumb / large / original',
    !/photo\.(src|thumb|preview|large|original)\b/.test(experienceSource),
    (experienceSource.match(/photo\.(src|thumb|preview|large|original)\b/g) ?? []).join(' '))
  check('没有两三千像素级的大贴图常量（显存里放不下十几张）',
    !/2048|3840|4096/.test(experienceSource))

  /* ───────────────────────── 8. 逐帧红线（源码级） ───────────────────────── */

  const regionStart = sceneSource.indexOf('// #region frame-loop')
  const regionEnd = sceneSource.indexOf('// #endregion frame-loop')
  const frameRegion = regionStart >= 0 && regionEnd > regionStart
    ? sceneSource.slice(regionStart, regionEnd)
    : ''
  check('VortexScene 里有明确标出的逐帧区间', frameRegion.length > 200, frameRegion.length + ' 字符')
  check('逐帧区间里没有任何 new（不会每帧制造 Vector / Matrix / Material 垃圾）',
    !/new\s/.test(frameRegion), (frameRegion.match(/new\s+\S+/g) ?? []).join(' '))
  check('逐帧区间里不读任何 Vue 响应式（没有 .value）',
    !/\.value/.test(frameRegion), (frameRegion.match(/\.\w*\.value/g) ?? []).join(' '))
  check('逐帧区间里没有 await（不把渲染循环变成异步等待）', !/await/.test(frameRegion))
  check('自动旋转是"持续"的：逐帧直接累加，hover 也不会停',
    /rotation\.y \+=/.test(frameRegion))
  check('自动旋转极慢：一圈 > 100 秒',
    2 * Math.PI / desktop.spin > 100 && 2 * Math.PI / mobile.spin > 100,
    '桌面 ' + (2 * Math.PI / desktop.spin).toFixed(0) + ' 秒/圈，手机 ' +
      (2 * Math.PI / mobile.spin).toFixed(0) + ' 秒/圈')
  check('hover 只是轻微放大（1.03~1.06）',
    desktop.hoverScale >= 1.03 && desktop.hoverScale <= 1.06 &&
      mobile.hoverScale >= 1.03 && mobile.hoverScale <= 1.06,
    '桌面 ' + desktop.hoverScale + ' / 手机 ' + mobile.hoverScale)
  check('相机没有自由飞行：源码里没有键盘监听',
    !/keydown|keyup|KeyW|KeyA|KeyS|KeyD/.test(sceneSource))
  /*
   * yaw 上限从 0.6 放到 π：用户反馈"转不到后面的照片"，所以水平方向现在允许拖满一圈。
   * 仍然必须是**钳制过**的（不能无限转），pitch 仍然很小（不给自由飞行）。
   */
  check('拖拽与滚轮都有边界（yaw / pitch / 距离都是钳制过的）',
    desktop.maxYaw > 0.6 && desktop.maxYaw <= Math.PI + 1e-6 &&
      desktop.maxPitch <= 0.3 && mobile.maxPitch === 0 &&
      desktop.minDistance < desktop.cameraDistance && desktop.cameraDistance < desktop.maxDistance,
    'yaw±' + desktop.maxYaw.toFixed(2) + ' pitch±' + desktop.maxPitch)
  check('水平方向能拖满一圈（够得着背面的照片）', desktop.maxYaw >= Math.PI - 1e-6)
  check('没有任何实时阴影（没有 shadowMap / castShadow / 灯光）',
    !/shadowMap|castShadow|receiveShadow|DirectionalLight|AmbientLight|PointLight/.test(experienceSource))

  /* ───────────────────────── 9. 释放路径（反复进出不能涨显存） ───────────────────────── */

  check('卸载时停掉 rAF', /cancelAnimationFrame\(rafId\)/.test(sceneSource))
  check('卸载时摘掉指针与滚轮监听', /removeEventListener\('wheel'/.test(sceneSource))
  check('卸载时断开 ResizeObserver', /observerRef\?\.disconnect\(\)/.test(sceneSource))
  check('卸载时释放共享的平面几何与相纸材质',
    /unitPlane\.value\?\.dispose\(\)/.test(sceneSource) &&
      /paperMaterial\.value\?\.dispose\(\)/.test(sceneSource))
  check('卸载时 dispose renderer 并主动丢弃 WebGL 上下文',
    /rendererRef\.dispose\(\)/.test(sceneSource) && /forceContextLoss\(\)/.test(sceneSource))
  check('每张照片各自释放自己的材质与贴图',
    /material\?\.dispose\(\)/.test(vortPhotoSource) && /texture\?\.dispose\(\)/.test(vortPhotoSource))
  check('贴图/组件已经卸载时才到达的图片也会被立刻释放',
    /loaded\.dispose\(\)/.test(vortPhotoSource))
  check('中心环释放自己的几何与材质',
    /geometry\?\.dispose\(\)/.test(centerSource) && /material\?\.dispose\(\)/.test(centerSource))
  check('共享资源只由场景释放（照片组件不碰共享几何 / 相纸材质）',
    !/unitPlane\.value\?\.dispose/.test(vortPhotoSource) &&
      !/paperMaterial\.value\?\.dispose/.test(vortPhotoSource))

  /* ───────────────────────── 10. 与全站唯一查看器的关系 ───────────────────────── */

  check('点击照片走的是全站唯一查看器：viewer.open(photos, index)',
    /viewer\.open\(photos\.value, index\)/.test(memorySource))
  check('没有第二套 Lightbox / 3D Viewer / PhotoSwipe 集成',
    !/photoswipe|PhotoSwipe|lightbox|Lightbox/.test(experienceSource))
  check('查看器打开时场景不被卸载：这一页里没有任何 isOpen 判断',
    !/isOpen/.test(memorySource + sceneSource + viewSource + fallbackSource + centerSource + vortPhotoSource))
  check('3D 初始化失败会降级而不是白屏（fail → fallback）',
    /@fail="onSceneFail"/.test(memorySource) && /sceneFailed/.test(memorySource))
  check('3D 场景是异步组件：只有真的进 3D 才下载 three',
    /defineAsyncComponent\(\(\) => import\('\.\/VortexScene\.vue'\)\)/.test(memorySource))
  check('three 只在场景里动态 import（降级路径连字节都不下载）',
    /await import\('three'\)/.test(sceneSource))
  check('没有任何组件在运行时有 import three（只允许 import type）',
    !/import\s+(?!type\b)[^;']*?from\s+'three'/.test(experienceSource))

  /* ───────────────────────── 11. 手机档与就绪判定 ───────────────────────── */

  check('手机档：照片更少、DPR 更低、关掉抗锯齿',
    mobile.count < desktop.count && mobile.maxDpr < desktop.maxDpr && mobile.antialias === false,
    'count ' + mobile.count + '/' + desktop.count + '，dpr ≤ ' + mobile.maxDpr)
  check('手机档：限制相机控制（没有上下拖拽）', mobile.allowPitch === false && mobile.maxPitch === 0)
  check('窄视口或粗指针 → 手机档；宽屏鼠标 → 桌面档',
    V.isMobileViewport({ width: 390, coarsePointer: false }) === true &&
      V.isMobileViewport({ width: 1440, coarsePointer: false }) === false &&
      V.isMobileViewport({ width: 1440, coarsePointer: true }) === true)
  check('loading 文案只在第一帧之后、贴图够了才撤（不做进度条）',
    V.isVortexReady({ frames: 0, loaded: 9, total: 18 }) === false &&
      V.isVortexReady({ frames: 1, loaded: V.VORTEX_READY_TEXTURES, total: 18 }) === true &&
      V.isVortexReady({ frames: 1, loaded: 3, total: 3 }) === true)
  check('贴图全部失败时 loading 文案也会撤（不会挂死在一句"正在打开这一天…"）',
    V.isVortexReady({ frames: 1, loaded: 0, settled: 18, total: 18 }) === true &&
      V.isVortexReady({ frames: 1, loaded: 0, settled: 4, total: 18 }) === false)
  check('相纸的"随手摆放"是稳定的（同一张照片每次进入都同一个倾斜）',
    V.hashSeed('P0001') === V.hashSeed('P0001') && V.hashSeed('P0001') !== V.hashSeed('P0002') &&
      Array.from({ length: 16 }, (_, index) => V.seedUnit(V.hashSeed('P0001'), index))
        .every((value) => value >= 0 && value < 1))
  check('可访问名永不为空（描述 → 时间+场景 → id 兜底）',
    V.vortexLabel({ id: 'PX', description: null, time: null, scene: null }) === '照片 PX' &&
      V.vortexLabel({ id: 'PX', description: '  敬茶  ', time: null, scene: null }) === '敬茶')
}
