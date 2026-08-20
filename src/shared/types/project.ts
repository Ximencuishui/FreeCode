/** 项目管理域类型（API 文档 4.3） */

export type ProjectStatus = 'draft' | 'developing' | 'ready' | 'exported';

export type ProjectTemplate = 'blank' | 'blog' | 'ecommerce' | 'tool';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
}

export interface ProjectListResult {
  projects: ProjectSummary[];
}

export interface ProjectCreateParams {
  name: string;
  description?: string;
  template?: ProjectTemplate;
  /** 用户选择的保存位置（父目录）。省略时使用默认位置（本程序数据目录下的 Project 目录） */
  location?: string;
}

export interface ProjectCreateResult {
  success: boolean;
  projectId?: string;
  projectPath?: string;
  error?: string;
}

/** 选择项目保存位置（系统文件夹选择器）结果 */
export interface ProjectSelectLocationResult {
  success: boolean;
  /** 用户取消选择 */
  canceled: boolean;
  /** 用户选中的文件夹绝对路径（canceled 时为 undefined） */
  path?: string;
  error?: string;
}

export interface ProjectDeleteParams {
  projectId: string;
  confirm: boolean;
}

export interface ProjectDeleteResult {
  success: boolean;
  error?: string;
}

export interface ProjectRequirements {
  goal: string;
  targetUsers: string;
  coreFeatures: string[];
  visualStyle: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  requirements: ProjectRequirements;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  chatHistory: unknown[];
  codePath: string;
}

export interface ProjectGetParams {
  projectId: string;
}

export interface ProjectGetResult {
  success: boolean;
  project?: ProjectDetail;
  error?: string;
}

/** 需求卡片摘要（渲染进程展示用） */
export interface RequirementSummary {
  goal: string;
  targetUsers: string;
  coreFeatures: string[];
  visualStyle?: string;
  confirmed: boolean;
}

export interface ProjectConfirmParams {
  projectId: string;
}

export interface ProjectConfirmResult {
  success: boolean;
  error?: string;
}
