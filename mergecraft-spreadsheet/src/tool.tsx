import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { each, mount } from "bireactive/jsx-runtime";
import { connectStore } from "bireactive/automerge";

type Cube = [number, number, number];
type Doc = { title?: string; cubes?: Cube[] };
type SelectedView = { url: string; toolId: string | null } | null;

const AXES = ["x", "y", "z"] as const;

// Scoped, theme-derived styling. All host `--editor-*` / `--studio-*` vars are
// mapped to `--mc-sheet-*` tokens inside the `@layer package` derivation block so
// themes re-evaluate on `[theme]` change; the style rules reference only tokens.
const STYLE = `
@layer package {
  :root,
  :host,
  [theme] {
    --mc-sheet-fill: var(--editor-fill, white);
    --mc-sheet-line: var(--editor-line, black);
    --mc-sheet-muted: var(--editor-line-offset-50, #777);
    --mc-sheet-border: var(--editor-fill-offset-20, #ddd);
    --mc-sheet-head-fill: var(--editor-fill-offset-10, #f4f4f4);
    --mc-sheet-hover: color-mix(in oklch, var(--editor-fill), var(--editor-line) 6%);
    --mc-sheet-accent: var(--studio-primary, #2563eb);
    --mc-sheet-accent-line: var(--studio-primary-line, white);
    --mc-sheet-danger: var(--studio-danger, #dc2626);
    --mc-sheet-family: var(--editor-family-sans, system-ui, sans-serif);
    --mc-sheet-family-code: var(--editor-family-code, ui-monospace, monospace);
  }
}

.mergecraft-sheet {
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  color: var(--mc-sheet-line);
  background: var(--mc-sheet-fill);
  font-family: var(--mc-sheet-family);
  font-size: 13px;
  line-height: 1.4;
}

.mergecraft-sheet .toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--studio-space-sm, 0.5rem);
  padding: var(--studio-space-sm, 0.5rem) var(--studio-space, 0.75rem);
  border-bottom: 1px solid var(--mc-sheet-border);
  flex: 0 0 auto;
}

.mergecraft-sheet .title {
  font-weight: 600;
  font-size: 14px;
}

.mergecraft-sheet .count {
  color: var(--mc-sheet-muted);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.mergecraft-sheet .scroll {
  flex: 1 1 auto;
  overflow: auto;
}

.mergecraft-sheet table {
  border-collapse: collapse;
  width: 100%;
  font-variant-numeric: tabular-nums;
}

.mergecraft-sheet thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--mc-sheet-head-fill);
  border-bottom: 1px solid var(--mc-sheet-border);
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mc-sheet-muted);
  padding: var(--studio-space-xs, 0.375rem) var(--studio-space-sm, 0.5rem);
}

.mergecraft-sheet thead th.num,
.mergecraft-sheet tbody td.num {
  text-align: right;
  font-family: var(--mc-sheet-family-code);
}

.mergecraft-sheet tbody td {
  border-bottom: 1px solid var(--mc-sheet-border);
  padding: 0;
}

.mergecraft-sheet tbody tr:hover {
  background: var(--mc-sheet-hover);
}

.mergecraft-sheet tbody td.idx {
  padding: 0 var(--studio-space-sm, 0.5rem);
  color: var(--mc-sheet-muted);
  font-family: var(--mc-sheet-family-code);
  text-align: right;
  width: 1%;
  white-space: nowrap;
}

.mergecraft-sheet input.coord {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-family: var(--mc-sheet-family-code);
  text-align: right;
  padding: var(--studio-space-xs, 0.375rem) var(--studio-space-sm, 0.5rem);
  -moz-appearance: textfield;
}

.mergecraft-sheet input.coord::-webkit-outer-spin-button,
.mergecraft-sheet input.coord::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.mergecraft-sheet input.coord:focus {
  outline: 2px solid var(--mc-sheet-accent);
  outline-offset: -2px;
  border-radius: var(--studio-radius-sm, 4px);
}

.mergecraft-sheet td.actions {
  width: 1%;
  white-space: nowrap;
  text-align: center;
}

.mergecraft-sheet button.del {
  border: 0;
  background: transparent;
  color: var(--mc-sheet-muted);
  cursor: pointer;
  font: inherit;
  line-height: 1;
  padding: var(--studio-space-xs, 0.375rem) var(--studio-space-sm, 0.5rem);
  border-radius: var(--studio-radius-sm, 4px);
}

.mergecraft-sheet button.del:hover {
  color: var(--mc-sheet-danger);
  background: color-mix(in oklch, var(--mc-sheet-danger), transparent 88%);
}

.mergecraft-sheet button.add {
  border: 1px solid var(--mc-sheet-accent);
  background: var(--mc-sheet-accent);
  color: var(--mc-sheet-accent-line);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  padding: var(--studio-space-xs, 0.375rem) var(--studio-space, 0.75rem);
  border-radius: var(--studio-radius-sm, 4px);
}

.mergecraft-sheet button.add:hover {
  filter: brightness(0.95);
}

.mergecraft-sheet .empty {
  color: var(--mc-sheet-muted);
  padding: var(--studio-space, 0.75rem);
}

.mergecraft-sheet .footer {
  flex: 0 0 auto;
  padding: var(--studio-space-sm, 0.5rem) var(--studio-space, 0.75rem);
  border-top: 1px solid var(--mc-sheet-border);
}
`;

/** Build the spreadsheet for one ready handle, into `host`. Returns a disposer
 *  that tears down the store bridge, the mount effects and the DOM — so the
 *  whole thing can be rebuilt cleanly when we rebind to a different doc. When
 *  mounted as a context tool the handle is `null` until a doc is selected. */
function startSession(handle: DocHandle<Doc> | null, host: HTMLElement): () => void {
  const root = document.createElement("div");
  const style = document.createElement("style");
  style.textContent = STYLE;
  host.append(style, root);
  const removeRoot = () => {
    root.remove();
    style.remove();
  };

  let doc: Doc | undefined;
  try {
    doc = handle ? handle.doc() : undefined;
  } catch {
    doc = undefined;
  }

  if (!doc || !Array.isArray(doc.cubes)) {
    const disposeUI = mount(
      () => (
        <div class="mergecraft-sheet">
          <div class="empty">
            {handle
              ? "This document isn't a Mergecraft world (no cubes array)."
              : "Select a Mergecraft world to see its blocks."}
          </div>
        </div>
      ),
      root,
    );
    return () => {
      disposeUI();
      removeRoot();
    };
  }

  // Deep store over the doc. `cubes` is a writable cell of the whole array;
  // writing `cubes.value = next` commits via positional reconcile, so editing a
  // single coordinate becomes a single scalar splice (`cubes[i][axis] = n`)
  // rather than replacing the row — rows stay put and inputs keep focus.
  const bridge = connectStore<Doc>(handle!);
  const cubes = bridge.store.cubes;
  const read = (): Cube[] => (cubes.peek() ?? []) as Cube[];

  const setCoord = (i: number, axis: number, raw: string): boolean => {
    const n = Math.round(Number(raw));
    const cur = read();
    if (!Number.isFinite(n) || !cur[i] || cur[i][axis] === n) return false;
    const next = cur.map((c, k) =>
      k === i ? (c.map((v, a) => (a === axis ? n : v)) as Cube) : c,
    );
    cubes.value = next;
    return true;
  };

  const addRow = (): void => {
    const cur = read();
    const last = cur[cur.length - 1];
    const seed: Cube = last ? [last[0] + 1, last[1], last[2]] : [0, 0, 0];
    cubes.value = [...cur, seed];
  };

  const deleteRow = (i: number): void => {
    const cur = read();
    if (!cur[i]) return;
    cubes.value = cur.filter((_, k) => k !== i);
  };

  const swallow = (e: Event): void => e.stopPropagation();

  const renderRow = (_item: Cube, index: number): Node => (
    <tr>
      <td class="idx">{String(index + 1)}</td>
      {AXES.map((_, axis) => (
        <td class="num">
          <input
            class="coord"
            type="number"
            step="1"
            inputmode="numeric"
            value={() => {
              const c = (cubes.value ?? [])[index];
              return c ? String(c[axis]) : "";
            }}
            onChange={(e: Event) => {
              const el = e.target as HTMLInputElement;
              if (!setCoord(index, axis, el.value)) {
                const c = read()[index];
                if (c) el.value = String(c[axis]);
              }
            }}
          />
        </td>
      ))}
      <td class="actions">
        <button
          class="del"
          title="Remove block"
          onClick={() => deleteRow(index)}
        >
          ✕
        </button>
      </td>
    </tr>
  );

  const disposeUI = mount(
    () => (
      <div
        class="mergecraft-sheet"
        onPointerdown={swallow}
        onWheel={swallow}
        onContextmenu={swallow}
      >
        <div class="toolbar">
          <div class="title">{() => doc?.title || "Mergecraft World"}</div>
          <div class="count">
            {() => `${(cubes.value ?? []).length} blocks`}
          </div>
        </div>

        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th class="idx">#</th>
                <th class="num">X</th>
                <th class="num">Y</th>
                <th class="num">Z</th>
                <th class="actions"></th>
              </tr>
            </thead>
            <tbody
              ref={(el: Node) =>
                each(el as Element, cubes as never, (_c, i) => String(i), renderRow)
              }
            />
          </table>
        </div>

        <div class="footer">
          <button class="add" onClick={addRow}>
            + Add block
          </button>
        </div>
      </div>
    ),
    root,
  );

  return () => {
    disposeUI();
    bridge.dispose();
    removeRoot();
  };
}

// `ToolRender` hands us a `DocHandle<unknown>` (the plugin boundary is untyped);
// narrow once, here, to our doc shape.
export const SpreadsheetTool: ToolRender = (handle, element) => {
  const host = document.createElement("div");
  host.style.cssText = "height:100%;box-sizing:border-box;color:inherit;";
  element.appendChild(host);

  let session: (() => void) | null = null;
  let boundUrl: string | undefined;

  const bindTo = (h: DocHandle<Doc> | null): void => {
    boundUrl = h?.url;
    session?.();
    session = startSession(h, host);
  };

  bindTo((handle as DocHandle<Doc>) ?? null);

  // Follow the user's focus: track whichever Mergecraft doc is in front instead
  // of being pinned to the handle we mounted with. No-ops if nothing answers.
  const repo = element.repo;
  const unsubscribe = subscribe<SelectedView>(
    element,
    { type: "patchwork:selected-view" },
    (view) => {
      const url = view?.url as AutomergeUrl | undefined;
      if (!url || url === boundUrl || !repo) return;
      repo
        .find<Doc>(url)
        .then(bindTo)
        .catch((e) => console.error("[block-sheet] find failed:", e));
    },
  );

  return () => {
    unsubscribe();
    session?.();
    session = null;
    host.remove();
  };
};
