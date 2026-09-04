# 贡献指南

欢迎为 FreeCoder 贡献！无论是 Bug 报告、功能建议、文档改进还是代码提交，我们都非常感谢。

## 开发环境

| 工具 | 版本要求 |
|------|---------|
| Node.js | 20+（推荐 22 LTS） |
| pnpm | 9+ |
| git | 任意现代版本 |

```bash
# 安装依赖
pnpm install

# 启动开发模式（Vite + Electron）
pnpm dev

# 常用命令
pnpm typecheck    # 类型检查
pnpm lint         # 代码规范（ESLint）
pnpm test:unit    # 单元测试（Jest）
pnpm test:e2e     # 端到端测试（Playwright + Electron，需先 pnpm build）
pnpm build        # 生产构建
pnpm package      # 打包安装包
```

## 提交规范

- 提交信息使用 Conventional Commits 风格：`feat:` / `fix:` / `test:` / `docs:` / `chore:` / `refactor:`
- 提交前 `pnpm lint` 与 `pnpm typecheck` 必须通过
- 单元测试 `pnpm test:unit` 必须通过（提交前可加 `--runInBand` 加速）
- git pre-commit 钩子会自动执行 lint-staged

## 代码结构

```
src/
├── main/          # Electron 主进程（窗口、IPC、存储、DSH 集成、预览、导出）
├── renderer/      # React 渲染进程（对话 UI、预览、导出面板）
├── preload/       # contextBridge 安全桥接
└── shared/        # 主/渲染进程共享类型与常量
tests/             # 单元测试（jest）与冒烟测试
e2e/               # 端到端测试（Playwright）
docs/              # 设计文档与调研
resources/         # 打包资源（图标、webview inspector 等）
```

## 贡献流程

1. Fork 仓库并创建特性分支
2. 提交改动（遵循提交规范）
3. 运行完整测试：`pnpm typecheck && pnpm lint && pnpm test:unit`
4. 发起 Pull Request，描述改动与验证结果

## 发布打包前置（仓库维护者）

FreeCoder 承诺安装包自带 DeepSeek Harness（dsh）运行时——终端用户不会接触到"安装 dsh 命令"这类开发者操作。但是，**dsh 全家桶存在未在 package.json 声明却被 require 的依赖**（如 `dsh-app-boot → cordis-plugin-group`），纯 `pnpm install @deepseek-ai/dsh` 拉不到完整运行时，必须从一个**已验证可工作的完整 dsh 安装目录**复制。

`scripts/bundle-dsh.mjs` 的 dsh 源候选链（按优先级，第一个命中者胜出）：

1. `DSH_PACKAGE_ROOT` 环境变量（CI 上指向预设的 dsh 安装目录）
2. `<项目根>/node_modules`（本地 pnpm install 拉到的 dsh，需要 hoisted 配置）
3. `G:\DSH` 兜底（开发者本地 dsh checkout，向后兼容）
4. 都找不到 → `pnpm bundle:dsh` 列出全部候选 + 三种解决方式后退出 1，**保证安装包不会漏 dsh**

### 本地打包（仓库管理员）

```bash
# 1. 在能访问 dsh checkout 的开发者机器上准备 bundle 源
mkdir -p /d/DSH
cd /d/DSH
npm install @deepseek-ai/dsh   # 完整装齐（含未 declared deps 的传递依赖）
# 或者从已验证可工作的环境 cp -r /path/to/known-good-dsh/node_modules/* /d/DSH/node_modules/

# 2. 回到 FreeCoder 仓库根
cd /path/to/FreeCoder

# 3. 跑 `pnpm package`（v3.2.2 P0-x 起 build/package 流水线已强制包含 `bundle:dsh`）
pnpm package
# 会自动调用 pnpm bundle:dsh，从 G:\DSH 或 DSH_PACKAGE_ROOT 复制 333MB+ dsh 运行时到 resources/dsh/
# 然后 electron-builder 打 .exe，验证产物包含 resources/dsh/

# 4. 验证：release/win-unpacked/resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js 必须存在
ls release/win-unpacked/resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
```

### CI 打包（GitHub Actions）

CI 在 `.github/workflows/ci.yml` 的 `release-windows` job。**DSH 运行时由仓库管理员维护的 `DSH_BUNDLE_ARCHIVE_B64` secret 提供**。生成步骤：

```bash
# 在本地有一份完整可工作的 dsh 安装目录（比如 D:\DSH）后：
# 1. 打包成 zip（注意：zip 根目录应是 D:\DSH\，所以从 D:\ 出发 cd 到 D:\ 然后
#    `Compress-Archive -Path D:\DSH, D:\nodejs -DestinationPath dsh-bundle.zip`，
#    让 zip 解压后能产出 D:\DSH\node_modules\@deepseek-ai\dsh\ 和 D:\nodejs\node.exe）

# 2. base64 编码（GitHub secrets 字段限制 64KB，DSH 全家桶 333MB 编码后接近 450MB，
#    超长无法用 secret 传——见下文 LFS / Action Artifacts 替代方案）
[Convert]::ToBase64String([IO.File]::ReadAllBytes('dsh-bundle.zip'))
```

**`DSH_BUNDLE_ARCHIVE_B64` 实际限制**：GitHub Actions secret 字段 64KB 上限不够装 333MB dsh bundle。可行替代方案：

- **方案 A（推荐）**：把 dsh bundle zip 放到 **GitHub Packages / S3 / 内网制品库**，CI 上在 step 里 `curl -L -H "Authorization: Bearer ${{ secrets.DSH_BUNDLE_TOKEN }}" -o dsh.zip <url>` 下载，再解压。所需 secret 仅是 Bearer token（KB 级）。修改 `.github/workflows/ci.yml` 的 `Restore DSH 运行时` step。
- **方案 B**：使用 `actions/cache@v4`（[GitHub Actions cache](https://docs.github.com/en/actions/using-caches) 单 key 限制 10GB，足够），把 dsh bundle 提前用本地 `actions/cache/save` 上传，CI 上 `actions/cache/restore` 拉取。最大支持 10GB，不需要下载也不需要额外 secret。
- **方案 C（小团队）**：本地打完安装包后人工上传到 GitHub Release，跳过 CI 自动发布。`.github/workflows/ci.yml` 现版本的 `release-windows` job 可以删掉，把 release 流程移到本地 `pnpm package` + 手动 upload。

CI 流水线已实现**方案 A 的骨架**（base64 + secret 路径）。从 0.1.06 发布起，建议切换到 **方案 B (GitHub Actions cache)** 或 **方案 A + 制品库**，避开 secret 体积限制。

### 重打历史 release 验证

如果怀疑某个旧版本漏了 dsh，验证步骤：

```bash
# 解压安装包后看 resources/ 目录结构
./FreeCoder-Setup-0.1.0.exe /S /D=C:\probe   # NSIS 静默安装（仅 Windows）
# 或用 7z：
7z x release/FreeCoder-Setup-X.Y.Z.exe -orealease-extracted/ -y
# 找 resources/dsh/ 目录：
ls release-extracted/resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
# 不存在 → 该版本产品承诺与技术现实不一致，请重发。
```

## 设计文档

详细设计见 `docs/` 目录与仓库根目录的设计文档（产品需求、技术架构、API 接口、数据库、前端设计、测试计划、开发计划）。
