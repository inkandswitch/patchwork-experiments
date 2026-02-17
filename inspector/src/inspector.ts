import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { getHeads } from "@automerge/automerge";
import { getRegistry } from "@inkandswitch/patchwork-plugins";

interface PatchworkViewElement extends HTMLElement {
  repo: Repo;
  docUrl?: string;
  toolId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findViewAt(x: number, y: number): PatchworkViewElement | null {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    let node: Element | null = el;
    while (node) {
      if (node.tagName?.toLowerCase() === "patchwork-view") {
        return node as PatchworkViewElement;
      }
      node = node.parentElement;
    }
  }
  return null;
}

function shortHash(h: string): string {
  return h.substring(0, 8);
}

function ago(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ago`;
}

async function resolveToolUrl(toolId: string | null | undefined): Promise<string | null> {
  const id = toolId?.trim();
  if (!id) return null;
  try {
    const plugin = getRegistry("patchwork:tool").get(id);
    return (plugin as any)?.importUrl ?? null;
  } catch {
    return null;
  }
}

async function resolveFallbackTool(
  repo: Repo,
  docUrl: string
): Promise<{ id: string; url: string } | null> {
  try {
    const handle = await repo.find(docUrl as any);
    const doc = handle.doc() as any;
    const datatype = doc?.datatype as string | undefined;
    if (!datatype) return null;

    const allTools = getRegistry("patchwork:tool").all();
    for (const tool of allTools) {
      const supported = (tool as any).supportedDatatypes;
      if (
        Array.isArray(supported)
          ? supported.includes(datatype)
          : supported === datatype
      ) {
        if ((tool as any).importUrl) {
          return { id: tool.id as string, url: (tool as any).importUrl };
        }
      }
    }
  } catch {}
  return null;
}

async function getHeadsInfo(
  repo: Repo,
  url: string
): Promise<{ hashes: string[]; formatted: string } | null> {
  try {
    const handle = await repo.find(url as any);
    const doc = handle.doc();
    if (!doc) return null;
    const heads = getHeads(doc);
    const formatted = heads.map(shortHash).join(", ");
    return {
      hashes: heads as string[],
      formatted: heads.length > 1 ? `${formatted}  (${heads.length} heads)` : formatted,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Popup UI
// ---------------------------------------------------------------------------

const POPUP_STYLE = `
  position: fixed; z-index: 99999; pointer-events: none;
  background: rgba(18, 18, 30, 0.96); color: #ccc;
  font: 11px/1.6 "SF Mono", "JetBrains Mono", "Fira Code", monospace;
  padding: 10px 14px; border-radius: 8px; min-width: 260px; max-width: 380px;
  border: 1px solid rgba(120, 140, 255, 0.3);
  box-shadow: 0 4px 24px rgba(0,0,0,0.45);
`;

function row(label: string, value: string, color: string): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `
    <div style="margin-bottom: 4px;">
      <div style="color:#666;font-size:9px;">${label}</div>
      <div style="color:${color};word-break:break-all;">${escaped || '<span style="opacity:0.4">(none)</span>'}</div>
    </div>`;
}

function separator(): string {
  return `<div style="border-top:1px solid rgba(255,255,255,0.06);margin:6px 0;"></div>`;
}

async function buildContent(view: PatchworkViewElement): Promise<string> {
  const repo = view.repo;
  const toolId = view.getAttribute("tool-id") || null;
  const docUrl = view.getAttribute("doc-url") || null;
  const hasExplicitTool = toolId && toolId.trim() !== "";
  let html = "";

  // --- Tool section ---
  html += row("tool-id", hasExplicitTool ? toolId! : "(fallback)", "#8ba4ff");

  let toolUrl: string | null = null;

  if (hasExplicitTool) {
    toolUrl = await resolveToolUrl(toolId);
  } else if (docUrl && repo) {
    const fallback = await resolveFallbackTool(repo, docUrl);
    if (fallback) {
      toolUrl = fallback.url;
      html += row("resolved-tool", fallback.id, "#8ba4ff");
    }
  }

  if (toolUrl) {
    html += row("tool-url", toolUrl, "#aa88ff");
    const toolHeads = await getHeadsInfo(repo, toolUrl);
    if (toolHeads) html += row("tool-heads", toolHeads.formatted, "#9988cc");
  }

  html += separator();

  // --- Doc section ---
  html += row("doc-url", docUrl ?? "", "#7a9a6a");

  if (docUrl && repo) {
    const docHeads = await getHeadsInfo(repo, docUrl);
    if (docHeads) html += row("doc-heads", docHeads.formatted, "#7aa0a0");

    try {
      const handle = await repo.find(docUrl as any);
      let lastChange: number | null = null;
      if (typeof (handle as any).lastLocalChange === "number") {
        lastChange = (handle as any).lastLocalChange;
      }
      if (lastChange) {
        html += row("last-sync", ago(Date.now() - lastChange), "#7aa0a0");
      }
    } catch {}
  }

  return html;
}

// ---------------------------------------------------------------------------
// Tool entry point
// ---------------------------------------------------------------------------

function renderInspector(
  _handle: DocHandle<unknown>,
  element: PatchworkViewElement
): () => void {
  const btn = document.createElement("button");
  btn.textContent = "\u{1F50D}";
  btn.title = "Inspect View (Cmd+Shift+I)";
  btn.style.cssText = `
    background: none; border: 1px solid transparent; border-radius: 4px;
    cursor: pointer; font-size: 14px; padding: 2px 6px; color: inherit;
    opacity: 0.6; transition: opacity 0.15s, border-color 0.15s; line-height: 1;
  `;

  let active = false;
  let popup: HTMLElement | null = null;
  let currentView: PatchworkViewElement | null = null;
  let buildId = 0; // to discard stale async builds

  function ensurePopup(): HTMLElement {
    if (!popup) {
      popup = document.createElement("div");
      popup.style.cssText = POPUP_STYLE;
      document.body.appendChild(popup);
    }
    return popup;
  }

  function positionPopup(x: number, y: number) {
    if (!popup) return;
    const pad = 16;
    const pw = popup.offsetWidth || 280;
    const ph = popup.offsetHeight || 100;
    let left = x + pad;
    let top = y + pad;
    if (left + pw > window.innerWidth - pad) left = x - pw - pad;
    if (top + ph > window.innerHeight - pad) top = y - ph - pad;
    popup.style.left = `${Math.max(pad, left)}px`;
    popup.style.top = `${Math.max(pad, top)}px`;
  }

  function deactivate() {
    active = false;
    currentView = null;
    buildId++;
    popup?.remove();
    popup = null;
    btn.style.opacity = "0.6";
    btn.style.borderColor = "transparent";
    document.removeEventListener("mousemove", onMouseMove);
  }

  function activate() {
    active = true;
    btn.style.opacity = "1";
    btn.style.borderColor = "rgba(120, 140, 255, 0.6)";
    document.addEventListener("mousemove", onMouseMove);
  }

  async function inspectView(view: PatchworkViewElement, x: number, y: number) {
    currentView = view;
    const p = ensurePopup();
    positionPopup(x, y);

    const id = ++buildId;
    p.innerHTML = `<div style="color:#666;font-size:9px;">loading\u2026</div>`;
    const html = await buildContent(view);
    if (buildId !== id) return; // stale
    p.innerHTML = html;
    positionPopup(x, y); // re-position after content changes size
  }

  function onMouseMove(e: MouseEvent) {
    if (!active) return;

    // Temporarily hide popup so elementsFromPoint sees through it
    if (popup) popup.style.display = "none";
    const view = findViewAt(e.clientX, e.clientY);
    if (popup) popup.style.display = "";

    if (!view) {
      // No view under cursor: keep last popup but reposition
      positionPopup(e.clientX, e.clientY);
      if (!currentView) {
        ensurePopup().innerHTML = `<div style="color:#666;font-size:10px;">move over a patchwork-view\u2026</div>`;
        positionPopup(e.clientX, e.clientY);
      }
      return;
    }

    if (view !== currentView) {
      inspectView(view, e.clientX, e.clientY);
    } else {
      positionPopup(e.clientX, e.clientY);
    }
  }

  function toggle() {
    if (active) deactivate();
    else activate();
  }

  btn.addEventListener("click", toggle);
  element.appendChild(btn);

  btn.addEventListener("mouseenter", () => { if (!active) btn.style.opacity = "1"; });
  btn.addEventListener("mouseleave", () => { if (!active) btn.style.opacity = "0.6"; });

  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "i") {
      e.preventDefault();
      toggle();
    }
    if (e.key === "Escape" && active) deactivate();
  };
  document.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("keydown", onKey);
    deactivate();
    btn.remove();
  };
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const plugins = [
  {
    type: "patchwork:tool" as const,
    id: "inspector",
    name: "Inspector",
    icon: "Search",
    supportedDatatypes: "*" as const,
    unlisted: true,
    forTitleBar: true,
    tags: ["titlebar-tool"],
    async load() {
      return renderInspector;
    },
  },
];
