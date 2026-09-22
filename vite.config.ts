import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/*
 * base：本地与自定义域名用 '/'；部署到 GitHub Pages 项目站点时要设成 '/<仓库名>/'。
 * 由部署脚本 / GitHub Actions 通过环境变量 VITE_BASE_PATH 传入，不在代码里写死仓库名。
 * 配套：src/router 用 createWebHistory(import.meta.env.BASE_URL)，两边必须一致。
 */
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // 注意：5173 被本机上另一个无关项目占用，这里固定用 5180
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    watch: {
      /*
       * 重要：编辑工具保存文件时会先在目标目录里建一个
       * ".<文件名>.<pid>.<uuid>.tmpdir/xxx.tmp" 再原子替换。
       * Windows 上 chokidar 去 watch 这个瞬时目录会抛 EBUSY，
       * 并让整个 dev server 直接退出（实测发生过）。
       * 这里把这些临时目录、以及不需要热更新的目录一起排除。
       */
      ignored: [
        /[\\/]\.[^\\/]*\.tmpdir[\\/]/,
        /[\\/]\.git[\\/]/,
        /[\\/]\.npm-cache[\\/]/,
        /[\\/]dist[\\/]/,
        /[\\/]photos[\\/]original[\\/]/,
        /[\\/]\.selftest[\\/]/
      ]
    }
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 600
  }
})
