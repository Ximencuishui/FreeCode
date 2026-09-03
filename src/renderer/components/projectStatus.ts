/**
 * 项目状态字面量 → 中文展示文案映射。
 * 抽离到独立 .ts 文件以满足 react-refresh/only-export-components 规则：
 * 该规则要求 .tsx 文件只能 export 组件函数，常量字典 / 工具函数应放在 .ts 文件里。
 *
 * 维护要点：
 * - 新增 ProjectStatus 时必须同步补一行；
 * - 已迁移到独立文件后，调用方应从 `./projectStatus` import，
 *   而非再从 `ProjectSwitcher` 间接 import（保持职责单一）。
 */
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  draft: '需求中',
  planned: '规划中',
  developing: '开发中',
  ready: '已就绪',
  exported: '已导出',
};
