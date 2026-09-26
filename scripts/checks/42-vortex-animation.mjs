/**
 * Phase 4 + Phase 5：Memory Vortex 完整动画（照片堆 → 抽离升空 → 螺旋 → 聚焦 / 回位）的契约断言。
 *
 * Node 里没有 WebGL，所以这里**只断言能在 Node 里证明的东西**：
 *   - 照片堆的随机由 id 派生、只在初始化时算一次（逐帧重算会让画面抖）；
 *   - 抽离插值：progress 0 → 起点、1 → 终点、中间单调，且写进调用方传进来的对象（每帧零分配）；
 *   - lifting 期间照片依然可以 hover / 点击（没有锁死交互的写法，注册表在动画期间不清空）；
 *   - 状态机单向推进、同一事件重复作用不会来回抖，而且真的在驱动逻辑（不是摆设）；
 *   - 帧循环红线（无 new / 无 .value / 无 await / 无对象字面量）与释放路径；
 *   - 铁律：贴图只用 medium、投影架构没被动过。
 *
 * 它**不能**替代真机走查：飞得好不好看、堆得像不像一堆照片、聚焦够不够轻，
 * 都只能在真浏览器里看（汇报里列了"只能真机确认"的清单）。
 */
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'src/components/experience'

/** 角度差是否等价（允许相差整数圈） */
function angleClose(a, b) {
  const twoPi = Math.PI * 2
  const delta = Math.abs(((a - b) % twoPi + twoPi) % twoPi)
  return Math.min(delta, twoPi - delta) < 1e-9
}

const round = (n) => Number(n.toFixed(4))

export default async function ({ check, load, makePhotos, ROOT }) {
  const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

  /* ───────────────────────── 0. 重播开场（用户点过一次"没反应"） ─────────────────────────
   * 两个根因都写死在这里，防止以后又被改回去：
   *   ① 提示语整行 pointer-events: none（为了不挡画布），把按钮的点击一起吞了；
   *   ② 重播时把时钟退回 -1（"还没开始"），而贴图早已加载完不会再触发 introArmed，
   *      于是要静默等满 introMaxWait(1.6s) 才开始 —— 用户只会以为按钮坏了。
   */
  const memorySrc = read(DIR + '/MemoryVortex.vue')
  const sceneSrc = read(DIR + '/VortexScene.vue')

  check('提示语整行是 pointer-events: none（不挡画布拖拽）',
    /vortex__hint[\s\S]{0,400}pointer-events:\s*none/.test(memorySrc))
  check('重播按钮把指针事件要回来了 —— 否则看上去在、点下去毫无反应',
    /vortex__replay[\s\S]{0,240}pointer-events:\s*auto/.test(memorySrc))
  check('重播是真的 button 且有可见文案',
    /<button[^>]*class="vortex__replay"[^>]*>[\s\S]{0,40}重播开场/.test(memorySrc))
  check('replayKey 真传给了 VortexScene',
    /:replay-key="replayKey"/.test(memorySrc) && /replayKey\?:\s*number/.test(sceneSrc))
  check('重播是立刻开始：时钟置 0，而不是退回"等待贴图"',
    /introClock = 0[\s\S]{0,240}idleTime = 0[\s\S]{0,240}phase = 'intro'/.test(sceneSrc) &&
    !/introClock = -1[\s\S]{0,140}idleTime = 0[\s\S]{0,140}phase = 'idle'/.test(sceneSrc))
  check('重播只重置时间轴，不重载相机与渲染器',
    !/replayKey[\s\S]{0,500}(camera\.position|renderer\.dispose|forceContextLoss)/.test(sceneSrc))
  const V = load('src/composables/useVortex.ts')
  const sceneSource = read(DIR + '/VortexScene.vue')
  const photoSource = read(DIR + '/VortexPhoto.vue')
  const memorySource = read(DIR + '/MemoryVortex.vue')

  const desktop = V.VORTEX_PRESETS.desktop
  const mobile = V.VORTEX_PRESETS.mobile
  const timing = desktop.timing

  /* ─────────────── 1. §32 Idle：照片堆的随机由 id 派生，只算一次 ─────────────── */

  const photos = makePhotos(18)
  const first = photos.map((photo) => V.stackPoseOf(photo.id, desktop.stack))
  const second = photos.map((photo) => V.stackPoseOf(photo.id, desktop.stack))
  check('照片堆的姿态由 id 派生：同一张照片两次算出来逐字节相同（不会逐帧抖）',
    JSON.stringify(first) === JSON.stringify(second))
  const keys = first.map((pose) => [pose.x, pose.y, pose.z, pose.rotationX, pose.rotationY, pose.rotationZ]
    .map(round).join(','))
  check('不同照片落在不同的姿态上（堆是一摞，不是一张）',
    new Set(keys).size === keys.length, new Set(keys).size + '/' + keys.length + ' 个不同姿态')
  check('同一个 id 换了堆的形状仍然稳定（形状只是参数，随机来自 id）',
    JSON.stringify(V.stackPoseOf('P0001', mobile.stack)) === JSON.stringify(V.stackPoseOf('P0001', mobile.stack)) &&
    JSON.stringify(V.stackPoseOf('P0001', mobile.stack)) !== JSON.stringify(V.stackPoseOf('P0002', mobile.stack)))

  const inSpread = (poses, shape) => poses.every((pose) =>
    Math.abs(pose.x) <= shape.spreadX + 1e-9 &&
    Math.abs(pose.y - shape.centerY) <= shape.spreadY + 1e-9 &&
    Math.abs(pose.z) <= shape.spreadZ + 1e-9 &&
    Math.abs(pose.rotationX) <= shape.tilt + 1e-9 &&
    Math.abs(pose.rotationY) <= shape.tilt + 1e-9 &&
    Math.abs(pose.rotationZ) <= shape.tilt + 1e-9)
  const mobileStack = photos.map((photo) => V.stackPoseOf(photo.id, mobile.stack))
  check('堆的随机严格落在预设的散布范围内（改手感只需要改 preset.stack）',
    inSpread(first, desktop.stack) && inSpread(mobileStack, mobile.stack))

  // 画面中下部：相机看向 lookAtHeight，可见半高 = tan(fov / 2) × 距离
  const halfHeight = (preset) => Math.tan((preset.fov * Math.PI) / 180 / 2) * preset.cameraDistance
  for (const [name, preset] of [['桌面', desktop], ['手机', mobile]]) {
    const center = preset.stack.centerY
    const lowest = Math.min(...first.map((pose) => pose.y)) - preset.photoHeight / 2
    check(name + '档：照片堆在画面中下部（中心低于视线，且整摞都还在画面里）',
      center < preset.lookAtHeight - 0.2 && lowest > preset.lookAtHeight - halfHeight(preset),
      '堆中心 y=' + round(center) + '，最低一摞下沿 y=' + round(lowest) +
        '，画面上边界 y=' + round(preset.lookAtHeight - halfHeight(preset)))
  }

  /* ─────────────── 2. §34 Lifting：插值函数 ─────────────── */

  const from = { x: -1, y: -2, z: 0.5, rotationX: 0.1, rotationY: 0.2, rotationZ: -0.3 }
  const to = { x: 3, y: 4, z: -2, rotationX: -0.4, rotationY: 1.5, rotationZ: 0.8 }
  const out = { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0 }
  const returned = V.lerpPose(out, from, to, 0)
  check('progress 0 → 精确落在起始姿态（照片还在堆里，一个数都不差）',
    returned === out && out.x === from.x && out.y === from.y && out.z === from.z &&
    out.rotationX === from.rotationX && out.rotationY === from.rotationY && out.rotationZ === from.rotationZ)
  V.lerpPose(out, from, to, 1)
  check('progress 1 → 精确落在目标姿态（角度允许差整数圈）',
    out.x === to.x && out.y === to.y && out.z === to.z &&
    out.rotationX === to.rotationX && out.rotationZ === to.rotationZ &&
    angleClose(out.rotationY, to.rotationY),
    'rotationY ' + round(out.rotationY) + ' vs ' + round(to.rotationY))
  check('插值写进调用方传进来的 out，不新建对象（每帧零分配的前提）',
    returned === out && V.lerpPose(out, from, to, 0.5) === out &&
    from.x === -1 && to.x === 3 && from.rotationZ === -0.3)

  const KEYS = ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotationZ']
  /** 一个分量在 t ∈ [0,1] 上要么单调不减、要么单调不增 —— 中间不能来回拐 */
  const monotone = (key) => {
    const series = []
    for (let step = 0; step <= 20; step += 1) {
      V.lerpPose(out, from, to, step / 20)
      series.push(out[key])
    }
    const rising = series.every((value, i) => i === 0 || value >= series[i - 1] - 1e-12)
    const falling = series.every((value, i) => i === 0 || value <= series[i - 1] + 1e-12)
    return rising || falling
  }
  check('中间过程每个分量都单调（照片不会先飞过头再倒回来）',
    KEYS.every(monotone), KEYS.filter((key) => !monotone(key)).join(',') || '全部单调')
  check('t 超出 [0, 1] 会被钳住（掉帧 / 时间跳变也不会把照片甩出去）',
    V.lerpPose(out, from, to, 2).x === to.x && V.lerpPose(out, from, to, -1).x === from.x)
  check('rotationY 走最短路径（不会为了到位在空中多转一整圈）',
    Math.abs(V.shortestAngleDelta(0.2, -6.9)) <= Math.PI + 1e-9 &&
    angleClose(0.2 + V.shortestAngleDelta(0.2, -6.9), -6.9),
    'Δ=' + round(V.shortestAngleDelta(0.2, -6.9)))

  /* ─────────────── 3. §33/§34 时间轴：渐显与逐张错开 ─────────────── */

  check('渐显（intro）从 0 开始、到点为止、中间单调',
    V.revealAt(0, timing) === 0 && V.revealAt(timing.intro, timing) === 1 &&
    V.revealAt(timing.intro * 2, timing) === 1 &&
    Array.from({ length: 11 }, (_, i) => V.revealAt((timing.intro * i) / 10, timing))
      .every((value, i, list) => i === 0 || value >= list[i - 1]))
  check('整段 intro + 逐张升空足够短（不让用户等一堆动画放完）',
    V.liftEndAt(desktop.count, desktop.timing) < 3 && V.liftEndAt(mobile.count, mobile.timing) < 3,
    '桌面 ' + round(V.liftEndAt(desktop.count, desktop.timing)) + ' 秒 / 手机 ' +
      round(V.liftEndAt(mobile.count, mobile.timing)) + ' 秒')

  const total = V.liftEndAt(18, timing)
  check('单张抽离的进度：时间段之前是 0、之后是 1、中间严格介于两者之间',
    V.liftProgressAt(0, 0, timing) === 0 &&
    V.liftProgressAt(timing.intro - 0.01, 0, timing) === 0 &&
    V.liftProgressAt(total + 1, 17, timing) === 1 &&
    V.liftProgressAt(timing.intro + timing.lift * 0.5, 0, timing) > 0 &&
    V.liftProgressAt(timing.intro + timing.lift * 0.5, 0, timing) < 1)
  const liftMonotone = (index) => {
    let previous = -Infinity
    for (let step = 0; step <= 40; step += 1) {
      const value = V.liftProgressAt((total + 0.5) * (step / 40), index, timing)
      if (value < previous - 1e-12) return false
      previous = value
    }
    return true
  }
  check('每张照片的抽离进度对时间单调不减（掉帧也不会走两次）',
    Array.from({ length: 18 }, (_, index) => liftMonotone(index)).every(Boolean))
  const midFlight = timing.intro + timing.stagger * 3 + timing.lift * 0.5
  check('逐张错开出场：前面的已经在飞，后面的还在堆里（不是 18 张一起弹起来）',
    V.liftProgressAt(midFlight, 0, timing) > V.liftProgressAt(midFlight, 8, timing) &&
    V.liftProgressAt(midFlight, 8, timing) > 0 &&
    V.liftProgressAt(midFlight, 17, timing) === 0,
    '第 1 张 ' + round(V.liftProgressAt(midFlight, 0, timing)) +
      ' / 第 9 张 ' + round(V.liftProgressAt(midFlight, 8, timing)) + ' / 第 18 张 0')

  /* ─────────────── 4. §31 状态机：单向、不抖、且真的在驱动逻辑 ─────────────── */

  const order = { idle: 0, intro: 1, lifting: 2, orbiting: 3 }
  let lastRank = -1
  let phaseMonotone = true
  let onlyAutomatic = true
  for (let step = 0; step <= 200; step += 1) {
    const phase = V.phaseAt((total + 1) * (step / 200), 18, timing)
    if (phase !== 'intro' && phase !== 'lifting' && phase !== 'orbiting') onlyAutomatic = false
    const rank = order[phase]
    if (rank === undefined || rank < lastRank) phaseMonotone = false
    lastRank = rank
  }
  check('自动相位（idle → intro → lifting → orbiting）单向推进，不会来回抖', phaseMonotone)
  check('时钟永远不会给出 focusing / returning：这两个状态只能由交互触发', onlyAutomatic)
  check('时钟一开始就是 intro（idle 只是"还没开始"的那个初值）',
    V.phaseAt(0, 18, timing) === 'intro' && V.phaseAt(-1, 18, timing) === 'intro')

  const EVENTS = ['select', 'hold-elapsed', 'returned']
  const edges = []
  let idempotent = true
  for (const phase of V.VORTEX_PHASES) {
    for (const event of EVENTS) {
      const next = V.nextPhaseOnEvent(phase, event)
      if (!V.VORTEX_PHASES.includes(next)) idempotent = false
      if (next !== phase) edges.push(phase + '→' + next)
      if (V.nextPhaseOnEvent(next, event) !== next) idempotent = false
    }
  }
  check('同一个事件重复作用不会来回抖（再点一次还在 focusing，再等一次还在 returning）',
    idempotent, edges.join(' '))
  /*
   * 反向边只允许由 select（用户主动点击）造成：returning 期间再点一张照片，
   * 应该重新聚焦到新照片上，而不是被"正在回位"卡住。
   * 计时器推动的两条边（hold-elapsed / returned）必须是严格单向的 —— 那才是"自己抖"。
   */
  const reverseEdges = edges.filter((edge) => {
    const [a, b] = edge.split('→')
    return edges.includes(b + '→' + a)
  })
  const timerEdges = []
  for (const phase of V.VORTEX_PHASES) {
    for (const event of ['hold-elapsed', 'returned']) {
      const next = V.nextPhaseOnEvent(phase, event)
      if (next !== phase) timerEdges.push(phase + '→' + next)
    }
  }
  check('计时器推动的迁移严格单向（hold-elapsed / returned 不会把状态拨回去）',
    timerEdges.length === 2 && !timerEdges.some((edge) => {
      const [a, b] = edge.split('→')
      return timerEdges.includes(b + '→' + a)
    }), timerEdges.join(' '))
  const reversePairs = [...new Set(reverseEdges.map((edge) => edge.split('→').sort().join(' ↔ ')))]
  check('唯一的反向边来自用户的重新点击（returning ↔ focusing），不是状态机自己抖',
    reversePairs.length === 1 && reversePairs[0] === 'focusing ↔ returning' &&
    V.nextPhaseOnEvent('returning', 'select') === 'focusing' &&
    V.nextPhaseOnEvent('focusing', 'select') === 'focusing',
    reversePairs.join(' | ') || '没有反向边')
  check('一条完整的交互链：orbiting →(点击) focusing →(保持结束) returning →(回位) orbiting',
    V.nextPhaseOnEvent('orbiting', 'select') === 'focusing' &&
    V.nextPhaseOnEvent('focusing', 'hold-elapsed') === 'returning' &&
    V.nextPhaseOnEvent('returning', 'returned') === 'orbiting')
  check('§35：lifting / intro / orbiting 期间点击都算数（只有一张都没显现的 idle 除外）',
    V.nextPhaseOnEvent('lifting', 'select') === 'focusing' &&
    V.nextPhaseOnEvent('intro', 'select') === 'focusing' &&
    V.nextPhaseOnEvent('orbiting', 'select') === 'focusing' &&
    V.nextPhaseOnEvent('idle', 'select') === 'idle')
  check('回位之后就是 orbiting（§39：关掉查看器时场景已经回到持续旋转）',
    V.nextPhaseOnEvent('returning', 'returned') === 'orbiting' &&
    V.nextPhaseOnEvent('returning', 'select') === 'focusing')

  /* ─────────────── 5. §35 Lifting 期间依然可交互（源码级） ─────────────── */

  // 注释里正当地解释"为什么不锁交互"，所以断言前先把注释去掉
  const sceneCode = sceneSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\/[^\n]*/g, '')
  check('3D 那一层根本没有 pointer-events（不存在"动画期间锁死交互"的写法）',
    !/pointer-events/.test(sceneCode))
  const clears = [...sceneSource.matchAll(/hitList\.length\s*=\s*0/g)]
  check('已经在场的照片一直在 hitList 里：注册表只在卸载时清空一次，动画期间不动它',
    clears.length === 1 && clears[0].index > sceneSource.indexOf('onUnmounted('),
    clears.length + ' 处清空')
  check('注册表只有两处入口：registerPhoto 收下、unregisterPhoto 只摘掉自己那一张',
    /hitList\.includes\(object\)\) hitList\.push\(object\)/.test(sceneSource) &&
    /const hit = hitList\.indexOf\(object\)/.test(sceneSource))
  const pickBody = sceneSource.slice(sceneSource.indexOf('function pick()'), sceneSource.indexOf('function onPointerDown'))
  check('命中判定不看动画状态：只要照片在画面里，hover 就能命中（升空中也照样能 hover）',
    pickBody.length > 100 && !/phase/.test(pickBody))
  check('点击路径由状态机决定，代码里没有写死"动画没完就不许点"',
    /if \(hoverIndex >= 0 && beginFocus\(hoverIndex\)\) emit\('select', hoverIndex\)/.test(sceneSource))
  // 逐条 CSS 规则看：pointer-events: none 只允许出现在装饰层与文字层上
  const styleBlock = memorySource.slice(memorySource.indexOf('<style scoped>'))
  const lockRules = [...styleBlock.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => /pointer-events\s*:\s*none/.test(match[2]))
    .map((match) => match[1].trim())
  check('页面级容器没有锁死交互（pointer-events: none 只在装饰层与文字层上）',
    lockRules.length > 0 && lockRules.every((selector) => /vortex__(air|center|hint|list)\b/.test(selector)),
    lockRules.join(' | '))

  /* ─────────────── 6. §36/§37/§38：旋转不停、hover 与聚焦都克制 ─────────────── */

  check('§36：自转仍然是极慢的 0.04 弧度/秒（Phase 3 用户已认可，一个数都没改）',
    desktop.spin === 0.04 && mobile.spin === 0.032)
  check('§37：hover 只是轻微放大（1.03~1.06）+ 轻微外推，没有大幅弹跳 / 发光 / 翻面',
    desktop.hoverScale >= 1.03 && desktop.hoverScale <= 1.06 &&
    mobile.hoverScale >= 1.03 && mobile.hoverScale <= 1.06 &&
    !/text-shadow|emissive|rotateY\(|Math\.PI \* 2/.test(sceneSource))
  check('§38：聚焦同样克制 —— 轻微放大 + 轻微靠近 + 轻微变暗',
    desktop.focusScale >= 1.03 && desktop.focusScale <= 1.12 &&
    desktop.focusDim >= 0.5 && desktop.focusDim <= 0.9 &&
    desktop.focusPush > 0 && desktop.focusPush < desktop.photoHeight,
    'scale ' + desktop.focusScale + ' / dim ' + desktop.focusDim + ' / push ' + desktop.focusPush)
  check('§38：其它照片只是"减速"而不是停转（倍率 ∈ (0, 1)）',
    desktop.focusSpin > 0 && desktop.focusSpin < 1 &&
    /spinGroup\.rotation\.y \+= preset\.spin \* spinFactor \* dt/.test(sceneSource))
  check('§38：查看器在聚焦过渡之后才打开（延迟取自 preset.focusLead，脚本里没有魔法数字）',
    /preset\.focusLead \* 1000/.test(memorySource) && desktop.focusLead > 0 && desktop.focusLead <= 0.5)

  /* ─────────────── 7. 帧循环红线（§51） ─────────────── */

  const regionStart = sceneSource.indexOf('// #region frame-loop')
  const regionEnd = sceneSource.indexOf('// #endregion frame-loop')
  const region = regionStart >= 0 && regionEnd > regionStart ? sceneSource.slice(regionStart, regionEnd) : ''
  check('逐帧区间依然明确标出、且内容完整', region.length > 2000, region.length + ' 字符')
  check('逐帧区间没有 new（不制造 Vector / Matrix / Material 垃圾）',
    !/\bnew\s/.test(region), (region.match(/new\s+\S+/g) ?? []).join(' '))
  check('逐帧区间没有对象字面量赋值（= { ... } 也是每帧一次分配）',
    !/=\s*\{/.test(region))
  check('逐帧区间不读任何 Vue 响应式（没有 .value）',
    !/\.value/.test(region), (region.match(/\.\w*\.value/g) ?? []).join(' '))
  check('逐帧区间没有 await', !/await/.test(region))
  check('插值的落点是初始化时就建好的对象（lerpPose 的第一个实参是变量）',
    /lerpPose\(point, stack, home, liftProgressAt\(introClock, index, timing\)\)/.test(region))
  check('姿态写回 three 对象：position / rotation 都是就地赋值（不重建对象）',
    /object\.position\.x = point\.x \+ base\.nx \* push/.test(region) &&
    /object\.rotation\.set\(point\.rotationX, point\.rotationY, point\.rotationZ\)/.test(region))
  check('状态机真的在驱动逐帧逻辑（不是摆设）',
    ['phaseAt(', 'nextPhaseOnEvent(', 'liftProgressAt(', 'revealAt(', 'lerpPose('].every((fn) => region.includes(fn)))
  check('每张照片的 stack / home / pose 三个姿态只在建场景时建一次', 
    /const stack = stackPoseOf\(photo\.id, preset\.stack\)/.test(photoSource) &&
    /const pose: VortexPose = \{ \.\.\.home \}/.test(photoSource) &&
    /group\.userData\.pose = pose/.test(photoSource))

  /* ─────────────── 8. 铁律：投影架构没被动过 ─────────────── */

  check('投影仍然投到 z = SHADOW_PLANE_Z 的幕上，四边对齐相机、不做旋转',
    /const reach = \(SHADOW_PLANE_Z - worldZ\) \/ SHADOW_LIGHT_Z/.test(region) &&
    !/shadowMesh\.rotation/.test(photoSource))
  check('影子仍然挂在场景的影子容器上（不是照片的子节点，否则会被照片自己挡掉）',
    /shadowParent\.add\(shadowMesh\)/.test(photoSource) && !/group\.add\(shadowMesh\)/.test(photoSource))
  check('影子容器仍然挂在 yawGroup 上（不跟着自转）',
    /yawGroup\.add\(shadowGroup\)/.test(sceneSource))
  check('影子跟着照片**此刻**的位置走：从堆里飞出来的时候影子一起飞',
    /const worldX = point\.x \* spinCos \+ point\.z \* spinSin/.test(region) &&
    /const point = object\.userData\.pose/.test(region))

  /* ─────────────── 9. 释放路径（反复进出不能涨显存） ─────────────── */

  const resources = [...new Set([...sceneSource.matchAll(/new THREE\.(\w+)/g), ...photoSource.matchAll(/new THREE\.(\w+)/g)]
    .map((match) => match[1]).filter((name) => /(Geometry|Material|Texture)$/.test(name)))].sort()
  check('本轮没有引入任何新的 GPU 资源类型（几何 / 材质 / 贴图还是那三种）',
    resources.join(',') === 'CanvasTexture,MeshBasicMaterial,PlaneGeometry', resources.join(','))
  check('逐帧改的相纸材质仍然在卸载时释放',
    /paperMaterial\.value\?\.dispose\(\)/.test(sceneSource) && /paperRef = null/.test(sceneSource))
  check('照片自己的材质仍然在卸载时释放，并且先摘掉帧循环的引用',
    /material\?\.dispose\(\)/.test(photoSource) && /group\.userData\.photoMaterial = null/.test(photoSource))
  check('新增的时间轴 / 聚焦状态在卸载时归零，不留悬空引用',
    /introClock = -1/.test(sceneSource) && /focusIndex = -1/.test(sceneSource) && /introArmed = false/.test(sceneSource) &&
    /shadowMaterialRef\?\.dispose\(\)/.test(sceneSource) && /rendererRef\.forceContextLoss\(\)/.test(sceneSource))
  check('照片卸载时仍然把影子从幕上摘掉、把贴图释放掉',
    /shadowMesh\.parent\?\.remove\(shadowMesh\)/.test(photoSource) &&
    /texture\?\.dispose\(\)/.test(photoSource) && /loaded\.dispose\(\)/.test(photoSource))

  /* ─────────────── 10. 铁律：只用 medium、走全站唯一查看器 ─────────────── */

  check('3D 贴图仍然只用 medium（长边 1280px）',
    /photo\.medium/.test(photoSource) &&
    !/photo\.(src|thumb|preview|large|original)\b/.test(sceneSource + photoSource + memorySource))
  check('点击 3D 照片仍然走全站唯一查看器（viewer.open(photos, index)）',
    /viewer\.open\(photos\.value, index\)/.test(memorySource))
  check('延迟打开在页面卸载时被清掉（不会在卸载之后把查看器打开）',
    /onBeforeUnmount\(\(\) => \{\s*if \(openTimer\) clearTimeout\(openTimer\)/.test(memorySource))
  check('键盘 / 兜底入口仍然立即打开（三维过渡只属于 3D 点击那一条路）',
    /function openFrom3D\(index: number\): void/.test(memorySource) &&
    /@select="openFrom3D"/.test(memorySource) &&
    /@select="open"/.test(memorySource))
}
