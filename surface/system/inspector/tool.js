
import { render, html, createSignal, from, createEffect } from '../solid.js';
import { schema } from './schema.js';

export { schema };

// Solid's from() returns a signal that auto-updates when the subscribable changes.
// We need to handle dynamic ref switching by using createSignal to hold the
// current reactive data accessor, and update it when the inspected ref changes.

export default function mount(element) {
  const [active, setActive] = createSignal(false);
  const [toolName, setToolName] = createSignal('');
  const [toolPath, setToolPath] = createSignal('');
  const [toolSource, setToolSource] = createSignal('');
  const [hoveredName, setHoveredName] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [tab, setTab] = createSignal('source');
  const [hasInspected, setHasInspected] = createSignal(false);
  
  // We store a reactive signal accessor for the inspected ref's data.
  // Each time we inspect a new element, we create a new from(ref) signal.
  const [dataAccessor, setDataAccessor] = createSignal(null);
  // Track the raw ref URL so we can detect changes
  const [inspectedRefUrl, setInspectedRefUrl] = createSignal('');

  let cleanup = null;

  function getFrame() {
    let el = element;
    let frame = null;
    while (el) {
      if (el.tagName === 'REF-VIEW') {
        try {
          const val = el.ref.value();
          if (val && val.shapes) frame = el;
        } catch(e) {}
      }
      const parent = el.parentElement;
      if (!parent || parent === el) break;
      el = parent;
    }
    return frame;
  }

  function findElementAt(x, y) {
    const frame = getFrame();
    if (!frame) return null;
    
    const candidates = [
      ...frame.querySelectorAll('ref-view'),
      ...document.querySelectorAll('patchwork-view'),
    ];
    
    let best = null;
    let bestArea = Infinity;
    
    for (const rv of candidates) {
      if (rv === frame) continue;
      if (!rv.ref) continue;
      
      try {
        const val = rv.ref.value();
        if (!val) continue;
      } catch(e) { continue; }
      
      const rect = rv.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const area = rect.width * rect.height;
        if (area < bestArea) {
          bestArea = area;
          best = rv;
        }
      }
    }
    return best;
  }

  function extractToolName(el) {
    try {
      const val = el.ref.value();
      const tUrl = val.embedToolUrl || val.toolUrl || '';
      if (tUrl) {
        const parts = tUrl.split('/');
        const toolIdx = parts.indexOf('tool.js');
        if (toolIdx > 0) return parts[toolIdx - 1];
        return parts[parts.length - 1] || tUrl;
      }
      if (el.tagName === 'PATCHWORK-VIEW') {
        return 'patchwork-view';
      }
    } catch(e) {}
    return 'Unknown';
  }

  function extractToolPath(el) {
    try {
      const val = el.ref.value();
      return val.embedToolUrl || val.toolUrl || el.tagName.toLowerCase();
    } catch(e) {
      return el.tagName.toLowerCase();
    }
  }

  function getFilesystem() {
    if (element.filesystem) return element.filesystem;
    let el = element;
    while (el) {
      if (el.filesystem) return el.filesystem;
      const parent = el.parentElement || el.getRootNode()?.host;
      if (!parent || parent === el) break;
      el = parent;
    }
    return null;
  }

  function formatJSON(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch(e) {
      return String(obj);
    }
  }

  async function inspectElement(targetEl) {
    const name = extractToolName(targetEl);
    const path = extractToolPath(targetEl);
    setToolName(name);
    setToolPath(path);
    setHasInspected(true);
    setTab('data');

    // Create a new reactive signal from this ref
    // from() subscribes to the ref and returns a signal accessor
    const ref = targetEl.ref;
    if (ref) {
      const refUrl = ref.url || '';
      setInspectedRefUrl(refUrl);
      
      // Create reactive signal from the ref
      const reactiveSignal = from(ref);
      setDataAccessor(() => reactiveSignal);
    } else {
      setDataAccessor(null);
      setInspectedRefUrl('');
    }

    // Get source from filesystem
    try {
      setLoading(true);
      const fs = getFilesystem();
      if (fs && path && path.includes('/')) {
        // Try to resolve tool path relative to filesystem
        let toolRelPath = path;
        // If it's an absolute URL, try to extract the relative path
        try {
          const fsBase = fs.getUrlOfFile('');
          if (path.startsWith(fsBase)) {
            toolRelPath = path.slice(fsBase.length);
          } else if (path.startsWith('http')) {
            // Try extracting from URL
            const url = new URL(path);
            const pathParts = url.pathname.split('/');
            // Find the tool folder name + tool.js
            const toolJsIdx = pathParts.findIndex(p => p === 'tool.js');
            if (toolJsIdx > 0) {
              toolRelPath = pathParts[toolJsIdx - 1] + '/tool.js';
            }
          }
        } catch(e) {}
        
        const source = await fs.readFile(toolRelPath);
        setToolSource(source);
      } else {
        setToolSource('// No filesystem source for: ' + path);
      }
    } catch(e) {
      setToolSource('// Could not load source: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function enableInspection() {
    setActive(true);
    setHoveredName('');

    let highlightedEl = null;

    const onMove = (e) => {
      const targetEl = findElementAt(e.clientX, e.clientY);
      
      if (highlightedEl && highlightedEl !== targetEl) {
        highlightedEl.style.outline = '';
        highlightedEl.style.outlineOffset = '';
      }

      if (targetEl) {
        highlightedEl = targetEl;
        setHoveredName(extractToolName(targetEl));
        targetEl.style.outline = '2px solid #89b4fa';
        targetEl.style.outlineOffset = '2px';
      } else {
        highlightedEl = null;
        setHoveredName('');
      }
    };

    const onClick = async (e) => {
      const targetEl = findElementAt(e.clientX, e.clientY);
      if (targetEl) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await inspectElement(targetEl);
      }
      
      if (highlightedEl) {
        highlightedEl.style.outline = '';
        highlightedEl.style.outlineOffset = '';
        highlightedEl = null;
      }
      
      setActive(false);
      cleanupListeners();
    };

    const frame = getFrame();
    const target = frame || document;
    
    target.addEventListener('mousemove', onMove, true);
    target.addEventListener('click', onClick, true);

    function cleanupListeners() {
      target.removeEventListener('mousemove', onMove, true);
      target.removeEventListener('click', onClick, true);
    }

    cleanup = () => {
      cleanupListeners();
      if (highlightedEl) {
        highlightedEl.style.outline = '';
        highlightedEl.style.outlineOffset = '';
      }
    };
  }

  function disableInspection() {
    setActive(false);
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  }

  function toggleInspect(e) {
    e.stopPropagation();
    if (active()) {
      disableInspection();
    } else {
      enableInspection();
    }
  }

  const targetSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`;

  const tabStyle = (isActive) => ({
    padding: '6px 16px',
    border: 'none',
    background: isActive ? '#45475a' : 'transparent',
    color: isActive ? '#cdd6f4' : '#6c7086',
    cursor: 'pointer',
    'font-size': '12px',
    'font-family': "'SF Mono', 'Fira Code', monospace",
    'font-weight': isActive ? '600' : '400',
    'border-radius': '4px',
    transition: 'all 0.15s ease',
  });

  const preStyle = {
    margin: '0',
    padding: '12px',
    'white-space': 'pre-wrap',
    'word-break': 'break-all',
    'overflow-x': 'auto',
    'tab-size': '2',
    'line-height': '1.6',
    color: '#a6adc8',
    'font-size': '11.5px',
    'font-family': "'SF Mono', 'Fira Code', monospace",
  };

  return render(() => html`
    <div style=${{
      width: '100%',
      height: '100%',
      background: '#1e1e2e',
      color: '#cdd6f4',
      'font-family': "'SF Mono', 'Fira Code', monospace",
      'font-size': '12px',
      display: 'flex',
      'flex-direction': 'column',
      overflow: 'hidden',
      'border-radius': '8px',
      border: '1px solid #45475a',
    }}>
      <!-- Header -->
      <div style=${{
        display: 'flex',
        'align-items': 'center',
        gap: '10px',
        padding: '10px 12px',
        background: '#313244',
        'border-bottom': '1px solid #45475a',
        'flex-shrink': '0',
      }}>
        <button
          style=${() => ({
            width: '34px',
            height: '34px',
            border: '2px solid ' + (active() ? '#f38ba8' : '#585b70'),
            'border-radius': '8px',
            cursor: 'pointer',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            background: active() ? '#f38ba8' : 'transparent',
            color: active() ? '#1e1e2e' : '#a6adc8',
            transition: 'all 0.15s ease',
            'flex-shrink': '0',
            padding: '0',
          })}
          onClick=${toggleInspect}
          title="Toggle Inspector"
          innerHTML=${targetSvg}
        />
        <div style=${{
          display: 'flex',
          'flex-direction': 'column',
          gap: '2px',
          overflow: 'hidden',
          flex: '1',
        }}>
          <div style=${{
            'font-size': '14px',
            'font-weight': '700',
            color: '#cdd6f4',
            'white-space': 'nowrap',
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
          }}>
            ${() => {
              if (active() && hoveredName()) return '🎯 ' + hoveredName();
              if (active()) return '🎯 Select an element...';
              if (toolName()) return '📦 ' + toolName();
              return 'Inspector';
            }}
          </div>
          ${() => toolPath() ? html`
            <div style=${{
              'font-size': '11px',
              color: '#6c7086',
              'white-space': 'nowrap',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
            }}>${() => toolPath()}</div>
          ` : null}
          ${() => inspectedRefUrl() ? html`
            <div style=${{
              'font-size': '10px',
              color: '#585b70',
              'white-space': 'nowrap',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
            }}>${() => inspectedRefUrl()}</div>
          ` : null}
        </div>
      </div>

      <!-- Tabs -->
      ${() => hasInspected() ? html`
        <div style=${{
          display: 'flex',
          gap: '4px',
          padding: '6px 12px',
          background: '#313244',
          'border-bottom': '1px solid #45475a',
          'flex-shrink': '0',
        }}>
          <button
            style=${() => tabStyle(tab() === 'data')}
            onClick=${() => setTab('data')}
          >Data</button>
          <button
            style=${() => tabStyle(tab() === 'source')}
            onClick=${() => setTab('source')}
          >Source</button>
        </div>
      ` : null}

      <!-- Content -->
      <div style=${{
        flex: '1',
        overflow: 'auto',
        padding: '0',
        position: 'relative',
      }}>
        ${() => {
          if (loading() && tab() === 'source') return html`<div style=${{padding: '16px', color: '#6c7086'}}>Loading...</div>`;
          
          if (hasInspected()) {
            if (tab() === 'data') {
              // Get the reactive data accessor
              const accessor = dataAccessor();
              if (accessor) {
                // accessor is a Solid signal created by from(ref)
                // Calling it inside this reactive context will track changes
                return html`<pre style=${{
                  ...preStyle,
                  color: '#89b4fa',
                }}>${() => {
                  const val = accessor();
                  return val ? formatJSON(val) : '// No data';
                }}</pre>`;
              }
              return html`<pre style=${{
                ...preStyle,
                color: '#6c7086',
              }}>// No ref data available</pre>`;
            }
            if (tab() === 'source') {
              return html`<pre style=${preStyle}>${() => toolSource() || '// No source available'}</pre>`;
            }
          }
          
          if (active()) return html`<div style=${{
            padding: '24px 16px',
            color: '#6c7086',
            'text-align': 'center',
            'line-height': '1.6',
          }}>
            <div style=${{ 'font-size': '32px', 'margin-bottom': '8px' }}>🎯</div>
            Hover over any element on the canvas<br/>and click to inspect it.
          </div>`;
          
          return html`<div style=${{
            padding: '24px 16px',
            color: '#6c7086',
            'text-align': 'center',
            'line-height': '1.6',
          }}>
            <div style=${{ 'font-size': '32px', 'margin-bottom': '8px' }}>🔍</div>
            Click the target button to<br/>start inspecting elements.
          </div>`;
        }}
      </div>
    </div>
  `, element);
}
