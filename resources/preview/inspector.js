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

// 宿主通过 webview.send('preview-mode', mode) 切换模式
ipcRenderer.on('preview-mode', (_event, mode) => {
  enabled = mode !== 'normal';
  if (!enabled) clearHighlight();
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
    'transition:all 0.08s ease',
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
  highlight(target);
}, true);

document.addEventListener('mouseout', (e) => {
  if (!enabled) return;
  if (e.target === overlay || !overlay) return;
  clearHighlight();
}, true);

document.addEventListener('click', (e) => {
  if (!enabled) return;
  const target = e.target;
  if (!target) return;
  // 跳过检查器自身覆盖层
  if (target === overlay) return;
  e.preventDefault();
  e.stopPropagation();
  ipcRenderer.sendToHost('preview-element', collectElement(target));
}, true);

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  if (overlay) overlay.remove();
});
