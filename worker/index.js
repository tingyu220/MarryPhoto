/**
 * 密码保护（B2 方案）
 *
 * 为什么先用它，而不是 Cloudflare Access：
 * Access 属于 Zero Trust，要先在控制台激活一次（还要选团队名），
 * 而这一步只能由账号所有者在浏览器里完成。这个脚本用 Workers 自带的写权限就能部署，
 * 一分钟让站点不再公开。以后想换成 Access 的邮箱验证，删掉这个文件即可 —— 两件事互不冲突。
 *
 * 密码存在 Worker 的加密变量里（wrangler secret put SITE_PASSWORD），
 * **绝不写进代码或 wrangler.jsonc** —— 这个仓库是公开的。
 *
 * 安全性说明：这是 Basic Auth，属于"家人级别"的门锁 ——
 * 能挡住陌生人、搜索引擎和随手转发链接的人；挡不住下定决心的人。
 * 如果真的需要按人授权 + 可撤销，请上 Cloudflare Access。
 */
const REALM = 'Wedding Album'

function unauthorized() {
  return new Response('需要密码才能查看这个影集', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="' + REALM + '", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      // 禁止缓存 401，避免浏览器把失败结果缓存住
      'Cache-Control': 'no-store'
    }
  })
}

export default {
  async fetch(request, env) {
    const expected = env.SITE_PASSWORD
    // 没配密码就直接放行（本地调试用）；线上必须配
    if (!expected) return env.ASSETS.fetch(request)

    const header = request.headers.get('Authorization') || ''
    if (!header.startsWith('Basic ')) return unauthorized()

    let decoded = ''
    try {
      decoded = atob(header.slice(6))
    } catch {
      return unauthorized()
    }
    const index = decoded.indexOf(':')
    if (index < 0) return unauthorized()
    const password = decoded.slice(index + 1)

    if (password !== expected) return unauthorized()
    return env.ASSETS.fetch(request)
  }
}
