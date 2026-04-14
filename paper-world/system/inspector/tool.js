const nameCache = new Map();

export default function mount(element) {
  const collapsed = new Set();
  let highlightedEl = null;
  let debounceTimer = null;
  const fs = element.filesystem;

  const root = document.createElement('div');
  root.style.cssText =
    'width:100%;height:100%;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 4px 16px rgba(0,0,0,0.08);display:flex;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:13px;box-sizing:border-box;';

  const header = document.createElement('div');
  header.style.cssText =
    'padding:10px 14px;background:linear-gradient(135deg,#0f172a 0%,#334155 100%);color:white;display:flex;align-items:center;gap:8px;flex-shrink:0;';
  header.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' +
    '<span style="font-weight:600;font-size:13px;letter-spacing:0.3px">Inspector</span>';
  root.appendChild(header);

  const treeContainer = document.createElement('div');
  treeContainer.style.cssText = 'flex:1;overflow-y:auto;padding:6px 0;';
  root.appendChild(treeContainer);

  const footer = document.createElement('div');
  footer.style.cssText =
    'padding:6px 14px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:11px;color:#9ca3af;flex-shrink:0;font-variant-numeric:tabular-nums;';
  footer.textContent = '0 views';
  root.appendChild(footer);

  element.appendChild(root);

  renderTree();

  document.addEventListener('mounted', scheduleRender);
  document.addEventListener('unmounted', scheduleRender);

  return () => {
    document.removeEventListener('mounted', scheduleRender);
    document.removeEventListener('unmounted', scheduleRender);
    clearHighlight();
    root.remove();
    if (debounceTimer) cancelAnimationFrame(debounceTimer);
  };

  function scheduleRender() {
    if (debounceTimer) cancelAnimationFrame(debounceTimer);
    debounceTimer = requestAnimationFrame(() => {
      debounceTimer = null;
      renderTree();
    });
  }

  async function renderTree() {
    const rootEl = findRootRefView(element);
    const tree = await buildNode(fs, rootEl);
    const total = countNodes(tree);

    treeContainer.innerHTML = '';
    renderNode(tree, treeContainer, 0);
    footer.textContent = total + ' view' + (total === 1 ? '' : 's');
  }

  function renderNode(node, container, depth) {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.el);

    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;gap:4px;padding:3px 10px 3px ' +
      (10 + depth * 16) +
      'px;cursor:pointer;user-select:none;white-space:nowrap;transition:background 0.1s;';

    row.addEventListener('mouseenter', () => {
      row.style.background = '#f1f5f9';
      highlightElement(node.el);
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = '';
      clearHighlight();
    });

    const arrow = document.createElement('span');
    arrow.style.cssText =
      'width:14px;height:14px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#94a3b8;flex-shrink:0;transition:transform 0.15s;';
    if (hasChildren) {
      arrow.textContent = '▶';
      if (!isCollapsed) arrow.style.transform = 'rotate(90deg)';
    }
    row.appendChild(arrow);

    const dot = document.createElement('span');
    dot.style.cssText =
      'width:6px;height:6px;border-radius:50%;flex-shrink:0;background:' +
      (hasChildren ? '#3b82f6' : '#94a3b8') +
      ';';
    row.appendChild(dot);

    const label = document.createElement('span');
    label.style.cssText =
      'color:#1e293b;font-size:12px;overflow:hidden;text-overflow:ellipsis;' +
      (hasChildren ? 'font-weight:500;' : '');
    label.textContent = node.name;
    row.appendChild(label);

    if (hasChildren) {
      const count = document.createElement('span');
      count.style.cssText = 'font-size:10px;color:#94a3b8;margin-left:4px;';
      count.textContent = '(' + node.children.length + ')';
      row.appendChild(count);
    }

    if (hasChildren) {
      row.addEventListener('click', () => {
        if (collapsed.has(node.el)) {
          collapsed.delete(node.el);
        } else {
          collapsed.add(node.el);
        }
        void renderTree();
      });
    }

    container.appendChild(row);

    if (hasChildren && !isCollapsed) {
      for (const child of node.children) {
        renderNode(child, container, depth + 1);
      }
    }
  }

  function highlightElement(el) {
    clearHighlight();
    highlightedEl = el;
    el.style.filter = 'drop-shadow(0 0 6px rgba(59,130,246,0.8)) drop-shadow(0 0 2px rgba(59,130,246,0.9))';
  }

  function clearHighlight() {
    if (highlightedEl) {
      highlightedEl.style.filter = '';
      highlightedEl = null;
    }
  }
}

function findRootRefView(el) {
  let current = el;
  while (current.parentElement?.closest('ref-view')) {
    current = current.parentElement.closest('ref-view');
  }
  return current;
}

async function buildNode(fs, el) {
  const viewUrl = el.getAttribute('view-url') || '';
  const directChildren = findDirectRefViewChildren(el);
  const [name, children] = await Promise.all([
    resolveViewName(fs, viewUrl),
    Promise.all(directChildren.map((child) => buildNode(fs, child))),
  ]);
  return { el, viewUrl, name, children };
}

function findDirectRefViewChildren(el) {
  const children = [];
  for (const child of el.children) {
    if (child.tagName === 'REF-VIEW') {
      children.push(child);
    } else {
      collectNestedRefViews(child, children);
    }
  }
  return children;
}

function collectNestedRefViews(el, result) {
  for (const child of el.children) {
    if (child.tagName === 'REF-VIEW') {
      result.push(child);
    } else {
      collectNestedRefViews(child, result);
    }
  }
}

async function resolveViewName(fs, viewUrl) {
  if (!viewUrl) return '(no view-url)';
  if (nameCache.has(viewUrl)) return nameCache.get(viewUrl);

  let name = fallbackName(viewUrl);
  if (viewUrl.endsWith('.json')) {
    try {
      const raw = await fs.readFile(viewUrl);
      const descriptor = JSON.parse(raw);
      if (descriptor.name) name = descriptor.name;
    } catch {
      // fall back to path-based name
    }
  }

  nameCache.set(viewUrl, name);
  return name;
}

function fallbackName(viewUrl) {
  const clean = viewUrl.replace(/^\.\//, '');
  const parts = clean.split('/');
  const last = parts[parts.length - 1];
  if (/^(tool|schema)\.(json|js)$/.test(last) && parts.length > 1) {
    return parts[parts.length - 2];
  }
  return last.replace(/\.[^.]+$/, '') || viewUrl;
}

function countNodes(node) {
  let total = 1;
  for (const child of node.children) {
    total += countNodes(child);
  }
  return total;
}
