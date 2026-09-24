import type { Photo } from '@/types/photo'

/**
 * 查看器的响应式选档（Phase 2 · Ultra HD）。
 *
 * 规则：
 * - preview（2048）永远在候选里 —— 它是"快速进入查看器"的那一档；
 * - 只有 large 的**实测像素确实更大**时才把 3840 加进候选。
 *   小原图（例如 800×600）的 large 和 preview 一样大，写进 srcset 只会
 *   让浏览器按错误的信息选图，所以直接不加。
 *
 * 谁来选：浏览器。PhotoSwipe 会按"实际显示宽度"给 img 写 sizes
 * （见它的 updateSrcsetSizes），浏览器再乘以 DPR 去挑候选 —— 于是
 * 手机（窄屏）拿到 2048，高 DPI 大屏才会真正去取 3840。
 * 我们不需要自己猜设备，也不需要在打开时预加载几十张大图。
 */
export function buildViewerSrcset(photo: Photo): string {
  const candidates: string[] = []

  if (photo.src && photo.width > 0) {
    candidates.push(photo.src + ' ' + photo.width + 'w')
  }

  if (photo.large && photo.largeWidth && photo.largeWidth > photo.width) {
    candidates.push(photo.large + ' ' + photo.largeWidth + 'w')
  }

  // 只有一个候选等于没得选，交回 src 即可
  return candidates.length > 1 ? candidates.join(', ') : ''
}

/** 这张照片有没有可能被升级到 3840（供检查与调试用） */
export function canUpgradeToLarge(photo: Photo): boolean {
  return Boolean(photo.large && photo.largeWidth && photo.largeWidth > photo.width)
}
