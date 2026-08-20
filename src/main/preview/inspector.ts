import type { ElementInfo, ElementSelectResult } from '../../shared/types/preview';

/**
 * 元素友好化描述（WP-15/16）：把 DOM 元素技术信息翻译为用户能理解的自然语言。
 * 依据 PRD 2.2.2「悬停识别」示例格式。
 */

const TAG_NAMES: Record<string, string> = {
  h1: '主标题',
  h2: '副标题',
  h3: '小标题',
  button: '按钮',
  input: '输入框',
  textarea: '文本框',
  select: '下拉选择',
  img: '图片',
  a: '链接',
  nav: '导航栏',
  header: '页头',
  footer: '页脚',
  form: '表单',
  ul: '列表',
  li: '列表项',
  table: '表格',
  label: '标签',
};

/** 生成元素友好名称 */
export function friendlyElementName(element: ElementInfo): string {
  const tagName = TAG_NAMES[element.tag] ?? '元素';
  if (element.id) return `${tagName}（${element.id}）`;
  return tagName;
}

/** 生成元素描述（含当前样式摘要） */
export function describeElement(element: ElementInfo): ElementSelectResult['elementInfo'] {
  const name = friendlyElementName(element);
  const styleParts: string[] = [];
  if (element.styles.color) styleParts.push(`颜色 ${element.styles.color}`);
  if (element.styles.fontSize) styleParts.push(`字号 ${element.styles.fontSize}`);
  if (element.styles.fontWeight && element.styles.fontWeight !== '400') {
    styleParts.push(`字重 ${element.styles.fontWeight}`);
  }
  if (element.styles.backgroundColor && element.styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    styleParts.push(`背景 ${element.styles.backgroundColor}`);
  }
  const styleText = styleParts.length > 0 ? `，${styleParts.join('，')}` : '';

  const contentText = element.content ? `，内容"${element.content.slice(0, 30)}"` : '';

  return {
    name,
    description: `您正在查看${name}${contentText}${styleText}。`,
    suggestedActions: [
      { label: '修改颜色', action: 'change-color' },
      { label: '调整大小', action: 'change-size' },
      { label: '编辑文字', action: 'edit-text' },
    ],
  };
}
