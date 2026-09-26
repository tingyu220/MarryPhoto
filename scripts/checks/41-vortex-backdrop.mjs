/**
 * 影像馆的"空间底"（缓慢漂移的暖色光晕 + 暗角呼吸）的契约断言。
 *
 * 两个约束必须同时成立，缺一个都会毁掉这一页：
 *   1. 动效必须克制 —— 只有 opacity / transform，周期在几十秒量级；
 *   2. 动效必须便宜 —— 不能进 WebGL 帧循环，不能招来网络请求或新依赖。
 *
 * 实际观感（漂移幅度够不够、暗角呼吸是否可见）只能真机走查。
 */
import fs from 'node:fs'

export default async function ({ check, load, ROOT }) {
  const read = (rel) => fs.readFileSync(ROOT + '/' + rel, 'utf8')
  const memory = read('src/components/experience/MemoryVortex.vue')
  const scene = read('src/components/experience/VortexScene.vue')
  /** 样式扫描必须去掉注释：注释里会正当地提到 filter/hex（解释"为什么不用"） */
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  const memoryCode = stripComments(memory)

  // ---- 结构 ----
  check('空间底存在且对辅助技术隐藏（纯装饰）',
    /class="vortex__air"\s+aria-hidden="true"/.test(memory))
  check('空间底有两团光晕 + 一层暗角',
    (memory.match(/vortex__glow--warm/g) || []).length >= 1 &&
    (memory.match(/vortex__glow--wine/g) || []).length >= 1 &&
    memory.includes('vortex__vignette'))
  check('空间底在 3D 画布之前（层级在下，画布要能透出它）',
    memory.indexOf('vortex__air') < memory.indexOf('<VortexScene'))

  // ---- 克制：只动 opacity / transform ----
  check('三条动画都在（漂移 ×2 + 呼吸 ×1）',
    ['vortex-drift-a', 'vortex-drift-b', 'vortex-breathe'].every((k) => memory.includes('@keyframes ' + k)))

  const keyframes = [...memory.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)].map((m) => m[1])
  check('关键帧只改 transform / opacity（合成器动画，不触发布局与重绘）',
    keyframes.length >= 3 && keyframes.every((body) => {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
      return props.every((p) => p === 'transform' || p === 'opacity')
    }),
    keyframes.map((b) => [...b.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]).join('+')).join(' | '))

  // 周期下限只要守住"看得到在动、又不像闪烁"即可：20s 是这条线。
  // （初版做成了 48~92s，结果用户反馈"看不出来在动" —— 太慢等于没有。）
  const durations = [...memory.matchAll(/(\d+)s\s+var\(--e-out\)/g)].map((m) => Number(m[1]))
  check('动画周期都在 20s 以上（看得到在动，但不像闪烁）',
    durations.length >= 3 && durations.every((d) => d >= 20), durations.join('s / ') + 's')

  check('没有使用 blur 滤镜做发光（避免大面积模糊的 GPU 开销）',
    !/filter:\s*blur/.test(memoryCode))
  check('没有硬编码 hex（颜色的"色"来自 token）', !/#[0-9a-fA-F]{3,8}\b/.test(memoryCode))
  check('光晕颜色确实是 tokens 里的暖棕与深酒红',
    memory.includes('rgba(138, 106, 79,') && memory.includes('rgba(110, 43, 43,'))

  // ---- 便宜：不动 WebGL、不请求资源 ----
  check('画布是透明的，空间底才透得出来', /alpha:\s*true/.test(scene))
  // 注意 tokenColor(...) 自带括号，不能写 [^)]*
  check('清屏 alpha 为 0（不是 1）', /setClearColor\(.*,\s*0\)\s*$/m.test(scene))
  check('空间底没有引入任何图片 / 字体 / 网络请求',
    !/url\(|@import|<img/.test(memory.slice(memory.indexOf('vortex__air'), memory.indexOf('</style>'))))

  // ---- 帧循环红线不受影响 ----
  const region = scene.slice(scene.indexOf('#region frame-loop'), scene.indexOf('#endregion frame-loop'))
  check('空间底没有往 3D 帧循环里塞任何新东西（仍无 new / 无 .value）',
    region.length > 0 && !/\bnew\s|\.[a-zA-Z]+\.value|await\s/.test(region))
  check('空间底没有引用 uniform 或着色器（3D 侧没有为此加渲染负担）',
    !/uniforms|ShaderMaterial/.test(scene))

  // ---- 中心：不再有那道细环，改成一行安静的字 ----
  check('中心那道细环已经不再挂载（用户反馈"圈不太好"）',
    !/<VortexCenter/.test(scene) && !/import VortexCenter/.test(scene))
  check('中心改成了 DOM 文字层（不把文字做成 3D 对象）',
    /class="vortex__center"/.test(memory) && /aria-hidden="true"[\s\S]{0,80}vortex__center|vortex__center[\s\S]{0,80}aria-hidden/.test(memory))
  check('中心文字的内容来自 site.json，不是写死的',
    /site\.heroTitle/.test(memory) && /site\.couple/.test(memory) && /site\.dateDisplay/.test(memory))
  check('中心文字不抢戏：低透明度、不发光、不描边',
    /vortex__center[\s\S]{0,400}opacity:\s*0\.[0-6]/.test(memoryCode) &&
    !/text-shadow/.test(memoryCode))

  // ---- 中央柔光：投影能被看见的前提 ----
  check('螺旋背后有一池中央柔光（纯黑背景上投影是看不见的，必须先有光）',
    /vortex__glow--pool/.test(memory) && /vortex__glow--pool[\s\S]{0,300}radial-gradient/.test(memoryCode))

  // ---- B 视差：拖拽时背景反向轻移 ----
  check('帧循环里把空间偏移写成 CSS 变量（视差由 CSS 消费，不经过 Vue）',
    region.includes('--vortex-px') && region.includes('--vortex-py'))
  check('视差只在变化超过半像素时才写 DOM（静止时零写入）',
    /> 0\.5|0\.5 </.test(region))
  check('CSS 层消费了这两个变量', /var\(--vortex-px/.test(memory) && /var\(--vortex-py/.test(memory))
  check('视差层有放大，位移时不会露边', /scale\(1\.0[6-9]\)|scale\(1\.[1-9]/.test(memoryCode))

  // ---- C 柔光投影 ----
  check('每张照片下方有一层柔光投影网格', /shadowMesh/.test(read('src/components/experience/VortexPhoto.vue')))
  check('投影材质是全场景共享的一份（子组件只借不释放）',
    /shadowMaterial/.test(scene) && /ctx\.shadowMaterial\.value/.test(read('src/components/experience/VortexPhoto.vue')))
  const photo = read('src/components/experience/VortexPhoto.vue')
  check('投影贴图是 canvas 现画的（零网络请求、零依赖）', /CanvasTexture/.test(scene))
  check('投影形状是相纸的圆角矩形，不是圆（圆会变成照片背后的一圈光晕）',
    /arcTo/.test(scene) && !/createRadialGradient/.test(scene))
  check('柔边不依赖 ctx.filter（iOS 16 以下的微信浏览器不支持）',
    !/ctx2d\.filter|context\.filter/.test(scene))
  check('投影贴图的核心是实心的（整块渐变的边缘等于看不见 —— 第一版就是这么失败的）',
    /roundRect\(pad, 0\.6/.test(scene) && /const pad = 12/.test(scene))

  // ---- 投影的几何：投到照片后方的「幕」上，而不是贴在照片背后 ----
  check('投影挂在场景的影子容器上，不是照片的子节点',
    /shadowParent\.add\(shadowMesh\)/.test(photo) && !/group\.add\(shadowMesh\)/.test(photo))
  check('投影不做旋转：四边对齐相机，任何自转角下都有完整投影面积',
    /不做旋转/.test(photo) && !/shadowMesh\.rotation\./.test(photo))
  check('影子容器挂在 yawGroup 上（不跟着自转，位置完全由逐帧投影决定）',
    /shadowGroup\.renderOrder = -1/.test(scene) && /yawGroup\.add\(shadowGroup\)/.test(scene))
  const planeZ = Number((/const SHADOW_PLANE_Z = (-?[\d.]+)/.exec(scene) || [])[1])
  check('幕（SHADOW_PLANE_Z）在所有照片更后面 —— 影子不会被照片挡掉的保证',
    Number.isFinite(planeZ) && planeZ <= -4, 'SHADOW_PLANE_Z=' + planeZ)
  check('逐帧按光方向把照片投到幕上（reach = 距离 / 光 z 分量）',
    /const reach = \(SHADOW_PLANE_Z - worldZ\) \/ SHADOW_LIGHT_Z/.test(region) &&
    /shadow\.position\.set\(worldX \+ SHADOW_LIGHT_X \* reach/.test(region))
  check('先按自转角把照片转到世界朝向，再投影（否则影子会跟着照片一起转）',
    /const worldX = point\.x \* spinCos \+ point\.z \* spinSin/.test(region))
  check('投影在卸载时释放（材质 + 贴图）', /shadowMaterialRef\?\.dispose\(\)/.test(scene) && /shadowTextureRef\?\.dispose\(\)/.test(scene))
  check('照片卸载时把影子从幕上摘掉', /shadowMesh\.parent\?\.remove\(shadowMesh\)/.test(photo))

  // ---- reduced motion 由全局规则兜住 ----
  const baseStyle = read('src/styles/base.scss')
  check('prefers-reduced-motion 下动画时长被全局归零（空间底静止）',
    /prefers-reduced-motion[\s\S]*animation-duration:\s*0\.01ms\s*!important/.test(baseStyle))
}
