# FreeCoder 宣传页（website/）

FreeCoder 官网宣传说明页：纯静态 HTML/CSS/JS，无构建步骤、无运行时依赖，
可一键部署到 **Vercel** 或任何静态托管（GitHub Pages、Netlify、Cloudflare Pages 等）。

## 本地预览

```bash
# 任选其一
npx serve website
python -m http.server 4173 --directory website
```

然后访问 http://localhost:4173 。

## 部署到 Vercel

### 方式一：Vercel Dashboard（推荐）

1. 在 [vercel.com](https://vercel.com) 导入本仓库（`Ximencuishui/FreeCode`）
2. 项目设置中 **Root Directory** 填 `website`
3. Framework Preset 选择 **Other**（无需构建）
4. 直接 Deploy，完成

> 由于仓库是 monorepo（Electron 应用 + 宣传页），必须把根目录指向 `website/`，
> 否则 Vercel 会尝试构建整个 Electron 项目并失败。

> 仓库根目录已放置防呆 `vercel.json`：若 Root Directory 配置错误（指向仓库根或 `dist/`），
> 部署会直接失败并提示正确配置，而不是上线一个崩溃的应用页面。

### 方式二：Vercel CLI

```bash
cd website
vercel            # 预览部署
vercel --prod     # 生产部署
```

### 方式三：Git 自动部署（可选）

在仓库根目录 `.github/workflows/` 添加 Vercel 官方部署工作流，
或使用 [vercel-action](https://github.com/amondnet/vercel-action)，
设置 `vercelProjectId` 与 `vercelOrgId` 即可在推送时自动上线。

## 常见错误

**页面打开报 `Cannot read properties of undefined (reading 'chat')`**
→ 这是把 Electron 应用渲染进程的构建产物（`dist/` 或仓库根目录）部署到了 Vercel。
`window.electron` 只会在 Electron 运行时由 preload 注入，浏览器里不存在。
解决：把 Vercel 项目 Root Directory 改为 `website/` 后重新部署（仓库根目录的防呆
`vercel.json` 也会在配置错误时直接报错提示）。

**`/favicon.ico` 404**
→ 宣传页使用内联 SVG 图标（`<link rel="icon" href="data:image/svg+xml,...">`），
不需要 favicon.ico 文件，该 404 可忽略。

## 自定义域名

部署后在 Vercel 项目 Settings → Domains 添加域名即可。

## ⚠️ 部署后必做：替换占位域名

当前页面使用占位域名 `https://freecoder.vercel.app/`（假设 Vercel 项目名为 `freecoder`），
**部署后请将以下文件中的占位域名替换为你的真实域名**（共 5 处）：

| 文件 | 内容 |
|------|------|
| `index.html` | `canonical`、`og:url`、`og:image`、`twitter:image` |
| `sitemap.xml` | `<loc>` 与 XML 注释外全部 |
| `robots.txt` | `Sitemap:` 行 |
| `llms.txt` | 全部链接 |

> 若未替换，搜索引擎会把流量指向占位域名，造成收录错乱。

## SEO / GEO 已内置

- **SEO**：title/description/canonical、Open Graph、Twitter Card、`robots.txt`、`sitemap.xml`、语义化 HTML（单 h1、层级 h2、`<details>` FAQ、无障碍跳转链接）
- **GEO（生成式引擎优化，面向 ChatGPT / Perplexity / DeepSeek 等 AI 搜索）**：
  - 可见 FAQ 版块 + `FAQPage` 结构化数据（JSON-LD）
  - `SoftwareApplication` / `WebSite` 结构化数据（名称、版本、许可证、价格、平台）
  - `llms.txt`（面向 LLM 的标准文本摘要，页脚与 `<head>` 均有链接）
  - 页面首屏即给出清晰定义（是什么 / 开源 / 本地优先 / 平台 / 许可证）
- 验证工具：Google Search Console、[Rich Results Test](https://search.google.com/test/rich-results)、[schema.org Validator](https://validator.schema.org/)

## 修改指引

| 内容 | 位置 |
|------|------|
| 文案 | `index.html`（各 section） |
| 配色 / 布局 | `styles.css`（`:root` 变量） |
| 下载链接 | `index.html` 中 `github.com/Ximencuishui/FreeCode/releases` |
| 安装指南 | `index.html` 中 `#guide` 区块（`guide-grid` / `req-card`） |
| FAQ（页面与 JSON-LD 需同步改） | `index.html` 中 `#faq` 区块 + `<script type="application/ld+json">` 的 FAQPage |
| 聊天演示动画 | `main.js` 中 `demo` 数组 |
| OG 分享图 | `og-image.png`（1200×630，替换后保持同名即可） |
