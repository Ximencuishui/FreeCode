# FreeCoder

> 把想法变成可用的软件，像跟朋友聊天一样简单。

FreeCoder 是一个开源的 Electron 桌面应用，让非技术用户通过自然语言对话，从零生成可运行的软件。全部代码与数据保存在本地，用户自备 DeepSeek API Key，无任何云端依赖。

## 核心功能（0.1.x）

- **AI 助理（需求分析师）**：对话引导、需求挖掘、信号翻译、结构化输出（需求卡片）
- **即时预览（可视化反馈）**：内置浏览器、元素悬停识别、口语修改
- **自助导出（部署准备）**：导出源码、Docker 配置、中文部署指引

完整闭环：**对话 → 开发 → 预览 → 修改 → 导出**。

## 技术栈

Electron · React 18 · TypeScript · Zustand · Tailwind CSS · Vite · pnpm · DeepSeek Harness (DSH)

## 开发

```bash
pnpm install        # 安装依赖
pnpm dev            # 启动开发模式（Vite + Electron）
pnpm build          # 生产构建
pnpm typecheck      # 类型检查
pnpm lint           # 代码规范检查
pnpm package        # 打包（electron-builder）
```

### 打包版本号规则

每次 `pnpm package` 会自动执行 `scripts/bump-version.mjs`，把版本号尾数 +1：

- 尾数固定两位数（01、02 … 99），序列从 `0.1.01` 开始：`0.1.01 → 0.1.02 → … → 0.1.99 → 0.2.01`
- 版本号写入 `package.json` 的 `version` 字段，应用内显示（`app.getVersion()`）与安装包文件名（electron-builder 的 `${version}` 模板）保持一致
- 单独手动递增：`pnpm bump:version`

## 设计文档

- [产品需求文档 v3.0](./FreeCoder%20产品需求文档%20v3.0.md)
- [技术架构设计文档](./FreeCoder%20技术架构设计文档.md)
- [前端设计说明书](./FreeCoder%20前端设计说明书.md)
- [API 接口设计文档](./FreeCoder%20API%20接口设计文档.md)
- [数据库设计文档（本地存储方案）](./FreeCoder%20数据库设计文档（本地存储方案）.md)
- [测试计划与用例](./FreeCoder%20测试计划与用例.md)
- [开发计划](./FreeCoder%20开发计划.md)

## 协议

MIT License
