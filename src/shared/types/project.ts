/** 项目管理域类型（API 文档 4.3） */

export type ProjectStatus = 'draft' | 'planned' | 'developing' | 'ready' | 'exported';

export type ProjectTemplate = 'blank' | 'blog' | 'ecommerce' | 'tool';

/** 版本分段：单个版本（V1 为最小可用版本 MVP） */
export interface VersionPlanVersion {
  /** 版本标签，如 "V1" / "V2" */
  label: string;
  /** 版本说明（通俗一句话） */
  description: string;
  /** 该版本包含的功能（coreFeatures 的子集） */
  features: string[];
}

/** 版本分段计划：把需求功能按版本切分，先做 MVP */
export interface VersionPlan {
  versions: VersionPlanVersion[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** 最近打开时间（用于欢迎页"最近项目"排序） */
  lastOpenedAt: string;
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
  pages?: string[];
  layout?: string;
  styleFeeling?: string;
  device?: 'desktop' | 'mobile' | 'both';
  keyFlows?: string[];
  authentication?: 'none' | 'password' | 'wechat' | 'sms';
  usageScale?: 'solo' | 'team' | 'public';
  exportFeatures?: string[];
  uiLanguage?: 'zh-CN' | 'en-US' | 'both';
  platform?: 'web' | 'mini-program' | 'both';
}

export interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  requirements: ProjectRequirements;
  /** 版本分段计划（需求确认后、写代码前生成） */
  versionPlan?: VersionPlan | null;
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
  pages?: string[];
  layout?: string;
  styleFeeling?: string;
  device?: 'desktop' | 'mobile' | 'both';
  keyFlows?: string[];
  authentication?: 'none' | 'password' | 'wechat' | 'sms';
  usageScale?: 'solo' | 'team' | 'public';
  exportFeatures?: string[];
  uiLanguage?: 'zh-CN' | 'en-US' | 'both';
  platform?: 'web' | 'mini-program' | 'both';
  confirmed: boolean;
}

/** 用户可编辑的需求字段（确认前修改需求项） */
export type RequirementEditable = Omit<RequirementSummary, 'confirmed'>;

export interface UpdateRequirementsParams {
  projectId: string;
  requirements: Partial<RequirementEditable>;
}

export interface UpdateRequirementsResult {
  success: boolean;
  error?: string;
}

export interface ProjectResumeDevelopmentParams {
  projectId: string;
}

export interface ProjectResumeDevelopmentResult {
  success: boolean;
  message?: string;
}

export interface ProjectAutoTestParams {
  projectId: string;
}

export interface ProjectAutoTestResult {
  success: boolean;
  /** 测试报告文本（成功时） */
  report?: string;
  message?: string;
}

/** 将项目从登录模式切换到本地模式（仅适用于 authentication !== 'none' 的已有项目） */
export interface ProjectConvertToLocalModeParams {
  projectId: string;
}

export interface ProjectConvertToLocalModeResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ProjectConfirmParams {
  projectId: string;
  /** true 时跳过 AI 需求审查（用户主动要求直接确认） */
  skipReview?: boolean;
}

export interface ProjectConfirmResult {
  success: boolean;
  /** 需求审查发现矛盾，需要继续澄清（成功后为 undefined） */
  needsReview?: boolean;
  error?: string;
}

/** 确认版本分段计划（可携带用户调整后的计划），确认后启动开发 */
export interface ProjectConfirmPlanParams {
  projectId: string;
  /** 用户调整后的版本计划（省略则使用已生成的计划） */
  plan?: VersionPlan;
}

export interface ProjectConfirmPlanResult {
  success: boolean;
  error?: string;
}
