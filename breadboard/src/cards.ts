import type { DiscoveredView, SlotInfo, OnSlotChange } from "./types.js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { getHeads } from "@automerge/automerge";

const CARD_STYLE = `
  position: absolute; background: rgba(18, 18, 30, 0.94); color: #ccc;
  font: 11px/1.5 "SF Mono", "JetBrains Mono", "Fira Code", monospace;
  padding: 6px 10px; border-radius: 6px; z-index: 10000; pointer-events: auto;
  border: 1px solid rgba(120, 140, 255, 0.25); max-width: 260px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.3); cursor: grab; user-select: none;
  transition: border-color 0.15s;
`;

const INPUT_STYLE = `
  background: rgba(40, 40, 60, 0.9); color: #ccc;
  border: 1px solid rgba(120, 140, 255, 0.15); border-radius: 3px;
  font: 10px/1.4 "SF Mono", monospace; padding: 2px 4px; width: 100%;
  outline: none; box-sizing: border-box;
`;

// Hover highlighting: cards sharing the same doc-url light up together
const docUrlCards = new Map<string, Set<HTMLElement>>();

export function clearDocUrlRegistry(): void { docUrlCards.clear(); }

function highlightDocUrl(url: string, on: boolean): void {
  for (const card of docUrlCards.get(url) ?? []) {
    card.style.borderColor = on ? "rgba(122, 154, 106, 0.7)" : "rgba(120, 140, 255, 0.25)";
  }
}

function editableField(
  label: string, value: string, color: string,
  onCommit: (v: string) => void,
  onHover?: { in: () => void; out: () => void }
): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "margin-bottom: 3px;";

  const lbl = document.createElement("div");
  lbl.style.cssText = "color: #666; font-size: 9px; margin-bottom: 1px;";
  lbl.textContent = label;
  row.appendChild(lbl);

  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.style.cssText = INPUT_STYLE;
  input.style.color = color;
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") input.blur(); });
  input.addEventListener("blur", () => { if (input.value !== value) onCommit(input.value); });
  if (onHover) {
    input.addEventListener("mouseenter", onHover.in);
    input.addEventListener("mouseleave", onHover.out);
    input.addEventListener("focus", onHover.in);
    input.addEventListener("blur", onHover.out);
  }

  row.appendChild(input);
  return row;
}

function readonlyField(label: string, value: string, color: string): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "margin-bottom: 3px;";

  const lbl = document.createElement("div");
  lbl.style.cssText = "color: #666; font-size: 9px; margin-bottom: 1px;";
  lbl.textContent = label;
  row.appendChild(lbl);

  const display = document.createElement("div");
  display.style.cssText = `
    background: rgba(40, 40, 60, 0.5); color: ${color};
    border: 1px solid rgba(120, 140, 255, 0.1); border-radius: 3px;
    font: 10px/1.4 "SF Mono", monospace; padding: 2px 4px;
    word-break: break-all; opacity: 0.8;
  `;
  display.textContent = value || "(none)";
  row.appendChild(display);

  return row;
}

// Resolve the actual tool being used, considering fallback behavior
async function resolveRunningTool(view: DiscoveredView): Promise<{ id: string; url: string } | null> {
  try {
    const toolRegistry = getRegistry("patchwork:tool");
    const hasExplicitToolId = view.toolId && view.toolId.trim() !== "";
    
    // If explicit tool-id is provided, use that
    if (hasExplicitToolId) {
      const plugin = toolRegistry.get(view.toolId!);
      if (plugin?.importUrl) {
        return { id: view.toolId!, url: plugin.importUrl };
      }
    }
    
    // Otherwise, try to determine the fallback tool based on document datatype
    if (view.docUrl && view.element.repo) {
      try {
        const handle = await view.element.repo.find(view.docUrl as any);
        const doc = handle.doc() as any;
        const datatype = doc?.datatype as string | undefined;
        
        if (datatype) {
          // Find a tool that supports this datatype
          const allTools = toolRegistry.all();
          for (const tool of allTools) {
            const supported = (tool as any).supportedDatatypes;
            if (supported === "*" || (Array.isArray(supported) && supported.includes(datatype))) {
              if ((tool as any).importUrl) {
                return { id: tool.id as string, url: (tool as any).importUrl };
              }
            }
          }
        }
      } catch (err) {
        // Document not available yet
        console.log("[breadboard] Could not load doc for fallback tool resolution:", err);
      }
    }
  } catch (err) {
    // Registry not available
    console.log("[breadboard] Registry not available:", err);
  }
  return null;
}

// Get document heads for any automerge URL
async function getDocumentHeads(repo: any, docUrl: string): Promise<string | null> {
  if (!docUrl || !repo) return null;
  
  try {
    const handle = await repo.find(docUrl as any);
    const doc = handle.doc();
    if (!doc) return null;
    
    const heads = getHeads(doc);
    // Format as comma-separated truncated hashes
    // Show count if multiple heads (indicates conflict/branching)
    const formatted = heads.map(h => h.substring(0, 8)).join(", ");
    return heads.length > 1 ? `${formatted} (${heads.length})` : formatted;
  } catch {
    return null;
  }
}

export function createViewCard(
  view: DiscoveredView,
  slotInfo: SlotInfo | null,
  onConfigChange: OnSlotChange | null,
  arrayEditor: HTMLElement | null
): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText = CARD_STYLE;

  if (view.docUrl) {
    let set = docUrlCards.get(view.docUrl);
    if (!set) { set = new Set(); docUrlCards.set(view.docUrl, set); }
    set.add(card);
  }

  if (slotInfo) {
    const el = document.createElement("div");
    el.style.cssText = "color: #666; font-size: 9px; margin-bottom: 2px;";
    el.textContent = slotInfo.fieldName + (slotInfo.kind === "array" ? " []" : "");
    card.appendChild(el);
  }

  card.appendChild(editableField("tool-id", view.toolId ?? "", "#8ba4ff", (val) => {
    val ? view.element.setAttribute("tool-id", val) : view.element.removeAttribute("tool-id");
    if (slotInfo?.kind === "single" && onConfigChange) onConfigChange(slotInfo.fieldName, val);
  }));

  // Placeholder for running tool URL (will be populated asynchronously)
  const runningToolPlaceholder = document.createElement("div");
  card.appendChild(runningToolPlaceholder);

  // Placeholder for tool heads (will be populated asynchronously)
  const toolHeadsPlaceholder = document.createElement("div");
  card.appendChild(toolHeadsPlaceholder);

  const docUrl = view.docUrl ?? "";
  card.appendChild(editableField("doc-url", docUrl, "#7a9a6a", (val) => {
    val ? view.element.setAttribute("doc-url", val) : view.element.removeAttribute("doc-url");
  }, docUrl ? { in: () => highlightDocUrl(docUrl, true), out: () => highlightDocUrl(docUrl, false) } : undefined));

  // Placeholder for document heads (will be populated asynchronously)
  const docHeadsPlaceholder = document.createElement("div");
  card.appendChild(docHeadsPlaceholder);

  if (arrayEditor) card.appendChild(arrayEditor);

  // Asynchronously populate running tool, tool heads, and doc heads
  (async () => {
    const runningTool = await resolveRunningTool(view);
    if (runningTool) {
      // Show as "tool-url" if explicit tool-id, "running-tool" if fallback
      const hasExplicitToolId = view.toolId && view.toolId.trim() !== "";
      const toolLabel = hasExplicitToolId ? "tool-url" : "running-tool";
      runningToolPlaceholder.replaceWith(readonlyField(toolLabel, runningTool.url, "#aa88ff"));
      
      // Also fetch and show heads for the tool URL
      const toolHeads = await getDocumentHeads(view.element.repo, runningTool.url);
      if (toolHeads) {
        const headsLabel = hasExplicitToolId ? "tool-heads" : "running-tool-heads";
        toolHeadsPlaceholder.replaceWith(readonlyField(headsLabel, toolHeads, "#9988cc"));
      }
    } else {
      console.log("[breadboard] No running tool resolved for view:", { toolId: view.toolId, docUrl: view.docUrl });
    }
    
    if (docUrl) {
      const docHeads = await getDocumentHeads(view.element.repo, docUrl);
      if (docHeads) {
        docHeadsPlaceholder.replaceWith(readonlyField("doc-heads", docHeads, "#7aa0a0"));
      }
    }
  })();

  makeDraggable(card);
  return card;
}

function makeDraggable(card: HTMLElement): void {
  let sx = 0, sy = 0, sl = 0, st = 0;
  card.addEventListener("mousedown", (e: MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "SELECT" || tag === "BUTTON" || tag === "OPTION" || tag === "INPUT") return;
    e.preventDefault(); e.stopPropagation();
    sx = e.clientX; sy = e.clientY; sl = card.offsetLeft; st = card.offsetTop;
    card.style.cursor = "grabbing";
    const move = (ev: MouseEvent) => {
      card.style.left = `${sl + ev.clientX - sx}px`;
      card.style.top = `${st + ev.clientY - sy}px`;
      card.dispatchEvent(new CustomEvent("breadboard:moved"));
    };
    const up = () => { card.style.cursor = "grab"; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
}
