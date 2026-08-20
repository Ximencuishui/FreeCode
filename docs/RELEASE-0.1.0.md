# FreeCoder 0.1.0 Release Notes

**发布日期**：2026-08-20
**协议**：MIT License

## 版本概述

FreeCoder 0.1.0 是首个可用的 MVP 版本：一个开源的桌面应用，让非技术用户通过自然语言对话，从零生成可运行的软件。**对话 → 开发 → 预览 → 修改 → 导出** 全闭环可用。

## 功能特性

- 💬 **AI 助理（需求分析师）**：对话引导需求挖掘（选项按钮即点即答）、需求卡片生成与确认、DSH 信号翻译为友好语言
- 🔍 **即时预览**：本地预览服务器（端口自动避让）、元素悬停识别与检查器、口语修改即时生效（热加载）
- 📦 **自助导出**：生成部署包（源码 + Dockerfile + docker-compose + 中文部署指引）
- 🔒 **隐私安全**：全本地运行、API Key 使用系统级加密（safeStorage）、无任何遥测

## 技术栈

Electron 43 · React 18 · TypeScript 5.9 · Zustand · Tailwind CSS · Vite 6 · DeepSeek Harness (DSH)

## 使用说明

1. 下载对应平台安装包并安装
2. 首次启动输入 DeepSeek API Key（本地加密存储）
3. 在对话中描述您的想法，AI 助理引导完成需求
4. 确认需求后自动开发，进入预览查看、口语修改
5. 满意后导出部署包，按指引部署上线

## 已知限制（0.1.x）

- 生成的应用为静态 Web 应用（HTML/CSS/JS + localStorage 数据），无后端数据库
- 多轮对话基于 headless 单次任务模式（历史拼入上下文），长对话 token 成本较高
- 界面语言仅中文

## 发布标准达成情况

| 标准 | 要求 | 结果 |
|------|------|------|
| 单元测试通过率 | ≥ 95% | ✅ 71/71（100%） |
| 集成/E2E 通过率 | 100% | ✅ 2/2 |
| P0/P1 缺陷 | 0 | ✅ 无已知 P0/P1 |
| 跨平台 | Win/macOS/Linux | Windows 已验证；macOS/Linux 配置就绪 |

## 致谢

感谢 DeepSeek 开源的 DeepSeek Harness（DSH）作为底层 Agent 引擎。
