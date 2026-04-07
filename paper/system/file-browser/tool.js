
import fileBrowserSchema from './schema.js';



export default function mount(element) {
  const fs = element.filesystem;
  let currentPath = '';
  let pathHistory = [];
  let viewingFile = null;

  const root = document.createElement('div');
  root.style.cssText = 'width:100%;height:100%;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 4px 16px rgba(0,0,0,0.08);display:flex;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:13px;box-sizing:border-box;';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'padding:12px 16px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;display:flex;align-items:center;gap:10px;flex-shrink:0;';
  header.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span style="font-weight:600;font-size:14px">File Browser</span>';
  root.appendChild(header);

  // Path bar
  const pathBar = document.createElement('div');
  pathBar.style.cssText = 'padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:6px;flex-shrink:0;';

  const backBtn = document.createElement('button');
  backBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  backBtn.style.cssText = 'background:#f1f5f9;border:none;border-radius:6px;padding:4px 6px;cursor:pointer;display:flex;align-items:center;opacity:0.4;';
  backBtn.addEventListener('click', () => {
    if (viewingFile) {
      viewingFile = null;
      showFileList();
      updateBackBtn();
      return;
    }
    if (pathHistory.length > 0) {
      currentPath = pathHistory.pop();
      loadEntries();
    }
  });
  pathBar.appendChild(backBtn);

  const pathDisplay = document.createElement('div');
  pathDisplay.style.cssText = "background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:4px 10px;flex:1;color:#374151;font-size:12px;font-family:'SF Mono','Fira Code',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  pathDisplay.textContent = '/';
  pathBar.appendChild(pathDisplay);
  root.appendChild(pathBar);

  // Content area
  const contentArea = document.createElement('div');
  contentArea.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';
  root.appendChild(contentArea);

  // List area
  const listArea = document.createElement('div');
  listArea.style.cssText = 'flex:1;overflow-y:auto;padding:4px 0;';
  contentArea.appendChild(listArea);

  // File preview area (hidden by default)
  const previewArea = document.createElement('div');
  previewArea.style.cssText = 'flex:1;overflow:auto;display:none;flex-direction:column;';
  contentArea.appendChild(previewArea);

  // Footer
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:8px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:11px;color:#9ca3af;flex-shrink:0;';
  footer.textContent = '0 items';
  root.appendChild(footer);

  element.appendChild(root);

  function updateBackBtn() {
    const canGoBack = viewingFile || pathHistory.length > 0;
    backBtn.style.opacity = canGoBack ? '1' : '0.4';
    backBtn.style.background = canGoBack ? '#e2e8f0' : '#f1f5f9';
  }

  function showFileList() {
    listArea.style.display = 'block';
    previewArea.style.display = 'none';
    pathDisplay.textContent = '/' + currentPath;
    viewingFile = null;
  }

  async function openFile(filePath, fileName) {
    viewingFile = filePath;
    listArea.style.display = 'none';
    previewArea.style.display = 'flex';
    previewArea.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af">Loading file...</div>';

    pathDisplay.textContent = '/' + filePath;
    updateBackBtn();

    try {
      const content = await fs.readFile(filePath);
      const ext = getExtension(fileName);

      previewArea.innerHTML = '';

      // File info bar
      const infoBar = document.createElement('div');
      infoBar.style.cssText = 'padding:8px 16px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;display:flex;align-items:center;gap:8px;flex-shrink:0;';

      const sizeText = content.length < 1024
        ? content.length + ' bytes'
        : (content.length / 1024).toFixed(1) + ' KB';

      infoBar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><span style="font-size:12px;color:#16a34a;font-weight:500">' + fileName + '</span><span style="margin-left:auto;font-size:11px;color:#9ca3af">' + sizeText + '</span>';
      previewArea.appendChild(infoBar);

      // Content display
      const codeWrap = document.createElement('div');
      codeWrap.style.cssText = 'flex:1;overflow:auto;padding:0;';

      const pre = document.createElement('pre');
      pre.style.cssText = 'margin:0;padding:12px 16px;font-family:"SF Mono","Fira Code","Cascadia Code",monospace;font-size:12px;line-height:1.5;color:#1e293b;white-space:pre-wrap;word-break:break-all;tab-size:2;';

      const code = document.createElement('code');
      code.textContent = content;
      pre.appendChild(code);
      codeWrap.appendChild(pre);
      previewArea.appendChild(codeWrap);

      const lines = content.split('\n');
      footer.textContent = lines.length + ' lines · ' + sizeText;

    } catch (e) {
      previewArea.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444">Cannot read file: ' + e.message + '</div>';
      footer.textContent = 'Error';
    }
  }

  function makeRow(entry) {
    const isFolder = entry.type === 'folder';
    const icon = isFolder
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#f59e0b" stroke="#d97706" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

    const row = document.createElement('div');
    row.style.cssText = 'padding:7px 16px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;transition:background 0.15s;';

    row.addEventListener('mouseenter', () => row.style.background = '#f1f5f9');
    row.addEventListener('mouseleave', () => row.style.background = 'transparent');

    // Single click opens
    row.addEventListener('click', () => {
      if (isFolder) {
        pathHistory.push(currentPath);
        currentPath = currentPath ? currentPath + '/' + entry.name : entry.name;
        loadEntries();
      } else {
        const fullPath = currentPath ? currentPath + '/' + entry.name : entry.name;
        openFile(fullPath, entry.name);
      }
    });

    const iconSpan = document.createElement('span');
    iconSpan.innerHTML = icon;
    iconSpan.style.cssText = 'display:flex;align-items:center;flex-shrink:0;';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = entry.name;
    nameSpan.style.cssText = 'color:' + (isFolder ? '#1e40af' : '#374151') + ';font-weight:' + (isFolder ? '500' : '400') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';

    const typeSpan = document.createElement('span');
    typeSpan.textContent = isFolder ? 'folder' : getExtension(entry.name);
    typeSpan.style.cssText = 'margin-left:auto;font-size:11px;color:#9ca3af;flex-shrink:0;';

    row.appendChild(iconSpan);
    row.appendChild(nameSpan);
    row.appendChild(typeSpan);

    return row;
  }

  function getExtension(name) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(dot + 1) : 'file';
  }

  async function loadEntries() {
    showFileList();
    updateBackBtn();

    listArea.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af">Loading...</div>';

    try {
      const items = await fs.listEntries(currentPath);
      const sorted = [...items].sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'folder' ? -1 : 1;
      });

      listArea.innerHTML = '';

      if (sorted.length === 0) {
        listArea.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af">Empty folder</div>';
      } else {
        for (const entry of sorted) {
          listArea.appendChild(makeRow(entry));
        }
      }

      footer.textContent = sorted.length + ' items';
    } catch (e) {
      listArea.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444">Error: ' + e.message + '</div>';
      footer.textContent = 'Error';
    }
  }

  loadEntries();

  return () => {
    root.remove();
  };
}
