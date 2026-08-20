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
}

export interface ProjectCreateResult {
  success: boolean;
  projectId?: string;
  projectPath?: string;
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
