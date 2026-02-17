import type { PatchworkViewElement, SlotInfo, OnSlotChange } from "./types.js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";

interface ToolOption { id: string; name: string; }

function getAllTools(): ToolOption[] {
  try {
    const tools = getRegistry("patchwork:tool").all()
      .map((t: any) => ({ id: t.id as string, name: (t.name || t.id) as string }));
    if (tools.length > 0) return tools.sort((a, b) => a.name.localeCompare(b.name));
  } catch {}

  const seen = new Set<string>();
  const tools: ToolOption[] = [];
  for (const el of Array.from(document.querySelectorAll("patchwork-view"))) {
    const id = el.getAttribute("tool-id");
    if (id && !seen.has(id)) { seen.add(id); tools.push({ id, name: id }); }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

export function createArrayEditor(slotInfo: SlotInfo, onChange: OnSlotChange): HTMLElement | null {
  if (slotInfo.kind !== "array") return null;
  const ids = slotInfo.currentValue as string[];

  const container = document.createElement("div");
  container.style.cssText = "margin-top: 3px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 3px;";

  const summary = document.createElement("div");
  summary.style.cssText = "color: #8ba4ff; font-size: 9px; cursor: pointer; display: flex; align-items: center; gap: 4px;";

  const arrow = document.createElement("span");
  arrow.textContent = "\u25b6";
  arrow.style.cssText = "font-size: 7px; transition: transform 0.15s;";
  summary.appendChild(arrow);

  const label = document.createElement("span");
  label.textContent = `${ids.length} in array`;
  summary.appendChild(label);
  container.appendChild(summary);

  const detail = document.createElement("div");
  detail.style.cssText = "display: none; margin-top: 4px;";

  const list = document.createElement("div");
  list.style.cssText = "display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px;";
  for (const id of ids) {
    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: rgba(50,50,70,0.5); padding: 1px 6px; border-radius: 3px; font-size: 9px; color: #aab;";
    const name = document.createElement("span");
    name.textContent = id;
    name.style.cssText = "overflow: hidden; text-overflow: ellipsis;";
    row.appendChild(name);
    const btn = document.createElement("button");
    btn.textContent = "\u00d7";
    btn.style.cssText = "background: none; border: none; color: #f88; cursor: pointer; font-size: 11px; padding: 0 2px; line-height: 1; flex-shrink: 0;";
    btn.addEventListener("click", (e) => { e.stopPropagation(); onChange(slotInfo.fieldName, ids.filter((v) => v !== id)); });
    row.appendChild(btn);
    list.appendChild(row);
  }
  detail.appendChild(list);

  const addRow = document.createElement("div");
  addRow.style.cssText = "display: flex; gap: 3px;";
  const select = document.createElement("select");
  select.style.cssText = "background: rgba(40,40,60,0.9); color: #ccc; border: 1px solid rgba(120,140,255,0.2); border-radius: 3px; font: 9px/1.4 'SF Mono', monospace; padding: 1px 3px; flex: 1;";
  for (const t of getAllTools()) {
    const opt = document.createElement("option");
    opt.value = t.id; opt.textContent = t.name;
    select.appendChild(opt);
  }
  const addBtn = document.createElement("button");
  addBtn.textContent = "+";
  addBtn.style.cssText = "background: rgba(60,80,140,0.5); color: #aac; border: 1px solid rgba(120,140,255,0.3); border-radius: 3px; cursor: pointer; font-size: 10px; padding: 0 5px; line-height: 1.6;";
  addBtn.addEventListener("click", (e) => { e.stopPropagation(); const v = select.value; if (v && !ids.includes(v)) onChange(slotInfo.fieldName, [...ids, v]); });
  addRow.appendChild(select);
  addRow.appendChild(addBtn);
  detail.appendChild(addRow);
  container.appendChild(detail);

  let open = false;
  summary.addEventListener("click", (e) => { e.stopPropagation(); open = !open; detail.style.display = open ? "block" : "none"; arrow.style.transform = open ? "rotate(90deg)" : ""; });

  return container;
}

export function createSlotChangeHandler(toolElement: PatchworkViewElement, accountDocUrl: string | null): OnSlotChange {
  return async (fieldName, newValue) => {
    if (!accountDocUrl) return;
    try {
      const handle = await toolElement.repo.find(accountDocUrl as any);
      handle.change((doc: any) => { doc[fieldName] = newValue; });
    } catch (err) {
      console.error("[breadboard] slot change failed:", err);
    }
  };
}
