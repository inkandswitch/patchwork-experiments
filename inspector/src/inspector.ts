import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { getHeads } from "@automerge/automerge";
import { getRegistry } from "@inkandswitch/patchwork-plugins";

interface ViewElement extends HTMLElement {
  repo: Repo;
}

function findViewAt(x: number, y: number): ViewElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    let n: Element | null = el;
    while (n) {
      if (n.tagName?.toLowerCase() === "patchwork-view") return n as ViewElement;
      n = n.parentElement;
    }
  }
  return null;
}

function ago(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

async function heads(repo: Repo, url: string): Promise<string | null> {
  try {
    const doc = (await repo.find(url as any)).doc();
    if (!doc) return null;
    const h = getHeads(doc);
    const short = h.map((s) => s.substring(0, 8)).join(", ");
    return h.length > 1 ? `${short}  (${h.length} heads)` : short;
  } catch {
    return null;
  }
}

async function resolveToolUrl(
  repo: Repo,
  toolId: string | null,
  docUrl: string | null
): Promise<{ id: string; url: string; fallback: boolean } | null> {
  try {
    const registry = getRegistry("patchwork:tool");

    if (toolId) {
      const url = (registry.get(toolId) as any)?.importUrl;
      if (url) return { id: toolId, url, fallback: false };
    }

    if (docUrl) {
      const datatype = ((await repo.find(docUrl as any)).doc() as any)?.datatype;
      if (datatype) {
        for (const t of registry.all()) {
          const sup = (t as any).supportedDatatypes;
          const match = Array.isArray(sup) ? sup.includes(datatype) : sup === datatype;
          if (match && (t as any).importUrl)
            return { id: t.id as string, url: (t as any).importUrl, fallback: true };
        }
      }
    }
  } catch {}
  return null;
}

function row(label: string, value: string, color: string): string {
  const v = value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<div style="margin-bottom:4px">
    <div style="color:#666;font-size:9px">${label}</div>
    <div style="color:${color};word-break:break-all">${v || '<span style="opacity:.4">(none)</span>'}</div>
  </div>`;
}

const HR = `<div style="border-top:1px solid rgba(255,255,255,.06);margin:6px 0"></div>`;

async function buildContent(view: ViewElement): Promise<string> {
  const { repo } = view;
  const toolId = view.getAttribute("tool-id")?.trim() || null;
  const docUrl = view.getAttribute("doc-url") || null;
  let html = "";

  const tool = await resolveToolUrl(repo, toolId, docUrl);
  html += row("tool-id", tool ? (tool.fallback ? `(fallback) ${tool.id}` : tool.id) : toolId ?? "", "#8ba4ff");
  if (tool) {
    html += row("tool-url", tool.url, "#aa88ff");
    const h = await heads(repo, tool.url);
    if (h) html += row("tool-heads", h, "#9988cc");
  }

  html += HR;
  html += row("doc-url", docUrl ?? "", "#7a9a6a");

  if (docUrl && repo) {
    const h = await heads(repo, docUrl);
    if (h) html += row("doc-heads", h, "#7aa0a0");

    try {
      const lc = (await repo.find(docUrl as any) as any).lastLocalChange;
      if (typeof lc === "number") html += row("last-sync", ago(Date.now() - lc), "#7aa0a0");
    } catch {}
  }

  return html;
}

const POPUP_CSS = `
  position:fixed; z-index:99999; pointer-events:none;
  background:rgba(18,18,30,.96); color:#ccc;
  font:11px/1.6 "SF Mono","JetBrains Mono","Fira Code",monospace;
  padding:10px 14px; border-radius:8px; min-width:260px; max-width:380px;
  border:1px solid rgba(120,140,255,.3);
  box-shadow:0 4px 24px rgba(0,0,0,.45);
`;

function renderInspector(_handle: DocHandle<unknown>, element: ViewElement): () => void {
  const btn = document.createElement("button");
  btn.textContent = "\u{1F50D}";
  btn.title = "Inspect View (Cmd+Shift+I)";
  btn.style.cssText = `
    background:none; border:1px solid transparent; border-radius:4px;
    cursor:pointer; font-size:14px; padding:2px 6px; color:inherit;
    opacity:.6; transition:opacity .15s,border-color .15s; line-height:1;
  `;

  let active = false;
  let popup: HTMLElement | null = null;
  let currentView: ViewElement | null = null;
  let gen = 0;

  const setActive = (on: boolean) => {
    btn.style.opacity = on ? "1" : ".6";
    btn.style.borderColor = on ? "rgba(120,140,255,.6)" : "transparent";
  };

  const position = (x: number, y: number) => {
    if (!popup) return;
    const pad = 16;
    const w = popup.offsetWidth || 280;
    const h = popup.offsetHeight || 100;
    let l = x + pad, t = y + pad;
    if (l + w > innerWidth - pad) l = x - w - pad;
    if (t + h > innerHeight - pad) t = y - h - pad;
    popup.style.left = `${Math.max(pad, l)}px`;
    popup.style.top = `${Math.max(pad, t)}px`;
  };

  const deactivate = () => {
    active = false;
    currentView = null;
    gen++;
    popup?.remove();
    popup = null;
    setActive(false);
    document.removeEventListener("mousemove", onMove);
  };

  const inspect = async (view: ViewElement, x: number, y: number) => {
    currentView = view;
    if (!popup) {
      popup = document.createElement("div");
      popup.style.cssText = POPUP_CSS;
      document.body.appendChild(popup);
    }
    position(x, y);

    const id = ++gen;
    popup.innerHTML = `<div style="color:#666;font-size:9px">loading\u2026</div>`;
    const html = await buildContent(view);
    if (gen !== id) return;
    popup.innerHTML = html;
    position(x, y);
  };

  const onMove = (e: MouseEvent) => {
    if (!active) return;
    if (popup) popup.style.display = "none";
    const view = findViewAt(e.clientX, e.clientY);
    if (popup) popup.style.display = "";

    if (view && view !== currentView) inspect(view, e.clientX, e.clientY);
    else position(e.clientX, e.clientY);
  };

  const toggle = () => {
    if (active) deactivate();
    else { active = true; setActive(true); document.addEventListener("mousemove", onMove); }
  };

  btn.addEventListener("click", toggle);
  btn.addEventListener("mouseenter", () => { if (!active) setActive(true); });
  btn.addEventListener("mouseleave", () => { if (!active) setActive(false); });
  element.appendChild(btn);

  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "i") { e.preventDefault(); toggle(); }
    if (e.key === "Escape" && active) deactivate();
  };
  document.addEventListener("keydown", onKey);

  return () => { document.removeEventListener("keydown", onKey); deactivate(); btn.remove(); };
}

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
    async load() { return renderInspector; },
  },
];
