# Wedding Memory · 婚礼数字影集

> 用照片、时间和文字，把姐姐结婚这一天完整保存下来。

这不是一个"放婚礼照片的网站"，而是一本可以一直翻下去的私人影集。
技术只是承载方式，最后留下来的应该是：**人、照片、故事和记忆**。

---

## 现在是什么状态

| 项 | 状态 |
| --- | --- |
| 文档 | ✅ 已完成（本仓库 `docs/`） |
| 网站源码 | 🚧 开发中 |
| 照片管线 | 🚧 开发中 |
| 真实照片 | ⏳ 婚礼举办后导入（当前使用占位图跑通全链路） |

---

## 目录结构（目标）

~~~text
MarryPhoto/
├── docs/                     计划书、设计契约、协作规范
├── photos/
│   └── original/             原始照片（不进 Git，本地唯一备份点之一）
├── public/
│   └── photos/
│       ├── thumb/            缩略图 480px WebP（列表用）
│       ├── medium/           中图 1280px WebP（桌面端画册版面用）
│       ├── preview/          预览图 2048px WebP（全屏大图用）
│       └── blur/             20px 模糊占位图（渐显用）
├── scripts/
│   ├── process-images.mjs    原图 → thumb/medium/preview/blur + 元数据
│   └── new-photo-id.mjs      稳定 ID 分配（id ↔ 文件名映射）
├── src/
│   ├── components/           photo / layout / common
│   ├── views/                Home Featured Story Gallery People Moments Letter
│   ├── data/                 photos.json（生成）photos.overrides.json（手写）
│   ├── composables/          usePhotos / useGallery / usePhotoViewer
│   ├── router/
│   └── styles/               tokens + 基础样式
└── README.md
~~~

---

## 快速开始

~~~bash
npm install
npm run dev          # 本地预览 http://localhost:5173
npm run build        # 产出 dist/ 静态站点
npm run preview      # 预览构建结果
~~~

---

## 以后怎么加照片（最重要的一段）

**永远不要在网站上直接放手机/相机原图。** 一张 15MB 的 JPG，500 张就是 7.5GB。

流程只有三步：

### 0. 先清掉占位期的标注（只做一次）

目前仓库里的 300 张是**占位图**，`photos/index.json` 里记的是伪路径
`placeholder/P0001.svg`。真实照片第一次导入时，这些伪记录会被清理，
**P0001… 会按真实拍摄时间重新分配** —— 也就是说，占位期间写进
`photos.overrides.json` 的人物/精选/描述会指向"另一张照片"。

所以真实照片到位后，第一件事是：

~~~bash
# 清空占位期的人工标注（或者自己逐个核对后重写）
echo "{}" > src/data/photos.overrides.json
npm run photos        # 导入真实照片，重新分配 ID
npm run photos:check  # 看还有多少张没写描述
~~~

然后重新标一遍。这一步做错不会丢照片，只会让标注对错人。

### 1. 把原图丢进去

~~~text
photos/original/2026-wedding/*.jpg
~~~

支持 JPG / PNG / HEIC / TIFF。文件名随便，脚本会自己处理顺序。

### 2. 跑一条命令

~~~bash
npm run photos        # = node scripts/process-images.mjs
~~~

脚本会自动完成：

1. 读取 EXIF 拍摄时间（没有就退回文件修改时间）；
2. 按拍摄时间排序，分配稳定 ID（P0001、P0002……，**已分配的 ID 不会变**）；
3. 自动旋转；
4. 生成 `public/photos/thumb/`（480px WebP，质量 72）；
5. 生成 `public/photos/medium/`（长边 1280px WebP，质量 78 —— 桌面端中等尺寸展示用）；
6. 生成 `public/photos/preview/`（长边 2048px WebP，质量 82）；
7. 生成 `public/photos/blur/`（20px 模糊占位）；
8. 重新生成 `src/data/photos.json`（四个档位的路径都在里面）。

### 3. 在 overrides 里写人话

脚本只负责"技术信息"（尺寸、时间、路径）。
**人物、标签、精选、描述** 这些"人话"，写在：

~~~text
src/data/photos.overrides.json
~~~

~~~json
{
  "P0001": {
    "featured": true,
    "people": ["sister", "mother"],
    "tags": ["candid", "family"],
    "description": "妈妈帮姐姐整理衣服"
  }
}
~~~

这样即使以后重跑一百次脚本，你手写的标注也**永远不会被覆盖**。

跑 `npm run photos:check` 会告诉你：哪些照片还没写描述、哪些 overrides 指向了不存在的 ID。

---

## 部署

### 两套部署（同一份 dist/，不需要改代码）

| 平台 | 地址 | 可见性 |
| --- | --- | --- |
| **Cloudflare Workers**（主） | <https://marryphoto.3069508080.workers.dev> | ✅ **密码保护已生效**（见下） |
| GitHub Pages（A 方案，备份） | <https://tingyu220.github.io/MarryPhoto/> | ⚠️ 公开 |

### 密码保护（当前生效中）

站点前面挂了一个 Worker（`worker/index.js`），所有请求先过鉴权再交给静态资源。

~~~bash
# 换密码（存在 Worker 的加密变量里，不会进代码、不会进仓库）
'新密码' | npx wrangler secret put SITE_PASSWORD
~~~

两个必须知道的坑：

1. `wrangler.jsonc` 里的 **`run_worker_first: true` 不能删** —— 默认情况下静态资源命中就直接返回、
   **根本不进 Worker**，密码校验会被完全绕过（实测过：不带密码也是 200）。
2. 本机访问 `api.cloudflare.com` 需要走代理，否则 `wrangler` 报 `fetch failed`。

想升级成"按邮箱授权 + 可撤销"（Cloudflare Access）时，删掉 `worker/index.js` 与 `main` 字段即可，
两件事不冲突。

Cloudflare 的部署命令：

~~~bash
npm run deploy:cf          # = npm run build && wrangler deploy
~~~

注意：本机访问 `api.cloudflare.com` 需要走代理，否则会报 `fetch failed`：

~~~powershell
$env:HTTPS_PROXY='http://127.0.0.1:7897'   # Clash Verge 的本地端口
npm run deploy:cf
~~~

同一个 `dist/` 两边都能用，因为只有 GitHub Pages 需要子路径 base（`/MarryPhoto/`），
Cloudflare 上站点在根路径 `/`，而 `vite.config.ts` 的 base 默认就是 `/`。

---

### GitHub Pages 的配置细节

推送到 `main` 就会自动构建并发布（`.github/workflows/deploy-pages.yml`）。
流水线里跑了 `typecheck` 与 `render-check`，**检查不过就不会发布**。

三个必须保留的配置（改动会导致白屏或 404）：

| 配置 | 作用 |
| --- | --- |
| `vite.config.ts` 的 `base`（由 `VITE_BASE_PATH` 注入 `/MarryPhoto/`） | 项目站点的资源在子路径下，不设就全 404 |
| `createWebHistory(import.meta.env.BASE_URL)` | 路由 base 必须与上面的 base 一致 |
| `scripts/postbuild.mjs` 产出 `.nojekyll` 与 `404.html` | 前者防止 Jekyll 吞掉下划线开头的产物；后者让 `/gallery` 这类深链接刷新后仍能打开 |

### ⚠️ 关于隐私

**这个仓库是 PUBLIC，页面地址也是公开的** —— 任何拿到链接的人都能看到全部照片。
`noindex` 只挡搜索引擎，挡不住人。把仓库改成 private 也**不能**让站点变私密
（GitHub 免费版只能从公开仓库发布 Pages）。

如果照片需要真正限制访问，改用 **Cloudflare Pages + Cloudflare Access**（需要邮箱验证）。
本项目的产物是纯静态的，换平台不需要改任何代码，只要重新构建即可。

> GitHub Pages 的图片资源是公开的，前端做一个"输入密码"的页面**不是安全措施**。
> 家庭照片请走 Cloudflare Access。

站点已默认关闭搜索引擎收录（`noindex,nofollow` + `robots.txt`）。

---

## 文档索引

| 文档 | 作用 |
| --- | --- |
| `docs/01-开发计划书.md` | 范围、页面规格、数据模型、图片管线、里程碑、验收标准 |
| `docs/02-UI设计契约.md` | 颜色/字体/间距/动效 tokens 与视觉禁忌 |
| `docs/03-并行开发协作规范.md` | 多代理并行开发的任务卡、文件所有权、完成定义 |

---

## 一句话原则

~~~text
照片 > 留白 > 文字 > UI
~~~
