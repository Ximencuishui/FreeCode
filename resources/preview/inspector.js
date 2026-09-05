/**
 * 预览元素检查器（webview preload，WP-15）。
 * 在预览应用中运行：
 * - mouseover：显示浅蓝色高亮边框
 * - click：收集元素信息并通过 sendToHost 上报宿主
 * 通过 <webview preload="..."> 注入，使用 ipcRenderer.sendToHost 与宿主通信。
 */
const { ipcRenderer } = require('electron');

let overlay = null;
/** 元素选择模式：默认关闭（正常交互测试）；宿主可切换为 select（悬停高亮+点击识别） */
let enabled = false;
/** 当前高亮的元素。mouseover 仅在 target 变化时刷新 overlay，
 *  避免鼠标在子元素间快速移动时 overlay 反复淡出/淡入造成的闪烁 */
let lastTarget = null;

// 宿主通过 webview.send('preview-mode', mode) 切换模式
ipcRenderer.on('preview-mode', (_event, mode) => {
  enabled = mode !== 'normal';
  if (!enabled) {
    lastTarget = null;
    clearHighlight();
  }
});

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:2147483646',
    'border:2px solid #4A90D9',
    'background:rgba(74,144,217,0.15)',
    'border-radius:4px',
    'display:none',
    // 修复 P1-7：去掉 transition:all 0.08s。
    // 原逻辑在 mouseout 立即清 overlay，鼠标移动到子元素时反复淡出/淡入，
    // 在大元素上会让肉眼误以为"预览窗口闪烁"。
    // 现在 mouseover 仅在 target 变化时刷新，position 是离散赋值，transition 反而是噪音。
    'transition:none',
  ].join(';');
  document.documentElement.appendChild(overlay);
  return overlay;
}

function highlight(el) {
  const ov = ensureOverlay();
  const r = el.getBoundingClientRect();
  ov.style.left = `${r.left + window.scrollX}px`;
  ov.style.top = `${r.top + window.scrollY}px`;
  ov.style.width = `${r.width}px`;
  ov.style.height = `${r.height}px`;
  ov.style.display = 'block';
}

function clearHighlight() {
  if (overlay) overlay.style.display = 'none';
}

function buildSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
  let selector = el.tagName.toLowerCase();
  if (typeof el.className === 'string' && el.className.trim()) {
    const cls = el.className.trim().split(/\s+/).slice(0, 2).map((c) => CSS.escape(c));
    selector += `.${cls.join('.')}`;
  }
  return selector;
}

function collectElement(el) {
  const rect = el.getBoundingClientRect();
  const styles = window.getComputedStyle(el);
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    className: typeof el.className === 'string' ? el.className : undefined,
    content: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    selector: buildSelector(el),
    styles: {
      color: styles.color,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      backgroundColor: styles.backgroundColor,
      margin: styles.margin,
      padding: styles.padding,
      borderRadius: styles.borderRadius,
    },
    position: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

document.addEventListener('mouseover', (e) => {
  if (!enabled) return;
  const target = e.target;
  if (!target || target === document.body || target === document.documentElement) return;
  // 修复 P1-7：只在 target 变化时刷新 overlay。
  // 鼠标在子元素间快速移动时，原逻辑每次都调用 highlight(target)，
  // 配合 80ms transition 让 overlay 反复淡出/淡入，看起来像闪烁。
  if (target === lastTarget) return;
  lastTarget = target;
  highlight(target);
}, true);

// 修复 P1-7：删除原来的 mouseout 监听。
// 原逻辑每次鼠标离开元素都 clearHighlight()，配合 mouseover 重显，
// 是「鼠标移动 → overlay 闪烁」的根因。
// 现在只在「鼠标离开整个页面」或「窗口失焦」时清空：
window.addEventListener('mouseleave', () => {
  lastTarget = null;
  clearHighlight();
});
window.addEventListener('blur', () => {
  lastTarget = null;
  clearHighlight();
});

document.addEventListener('click', (e) => {
  if (!enabled) return;
  const target = e.target;
  if (!target || target === overlay || target === document.body || target === document.documentElement) return;
  if (!(target instanceof Element)) return;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  e.preventDefault();
  e.stopPropagation();
  ipcRenderer.sendToHost('preview-element', collectElement(target));
}, true);

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  if (overlay) overlay.remove();
});
