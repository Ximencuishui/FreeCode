/** 应用域类型（API 文档 4.7） */

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  dshVersion?: string;
  /** DeepSeek Harness（dsh）运行时是否可用（打包前/开发环境据此提示） */
  dshAvailable?: boolean;
  /** dsh 运行时状态说明（供状态栏/弹窗展示） */
  dshHint?: string;
}
