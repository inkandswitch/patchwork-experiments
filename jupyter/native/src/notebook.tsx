import type * as nbformat from "@jupyterlab/nbformat"
import type { RenderMimeRegistry } from "@jupyterlab/rendermime"
import { type Accessor, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { readString, toPlain } from "../../shared/json"
import { findCellIndex } from "../../shared/notebook-doc"
import type { CellDoc } from "../../shared/schema"
import { atBoundary, CellEditor, type EditorLanguage } from "./cell-editor"
import type { CompareState } from "./compare/compare"
import type { EditorMarks } from "./compare/editor-marks"
import type { DeletedCell } from "./compare/notebook-diff"
import { type CellType, type NotebookStore, plainCell } from "./doc"
import type { Executor } from "./execution"
import type { KernelClient, KernelStatus } from "./kernel/types"
import { icons } from "./icons"
import { acceptDrops, ImportsPanel, withDropped } from "./imports-panel"
import { importsOf } from "../../shared/imports"
import type { DatatypeLookup, FindDoc } from "../../shared/run"
import { outputBundle, renderBundle } from "./outputs"

export type NotebookProps = {
  store: NotebookStore
  rendermime: RenderMimeRegistry
  compare: CompareState
  /** Missing when the notebook can't run anything, such as a point in history. */
  kernel?: KernelClient
  executor?: Executor
  /** Linked documents: how to open them, the notebook's own URL, and how to show one. */
  links?: { find: FindDoc; datatype: DatatypeLookup; url: string; open(url: string, title?: string): void }
}

type Mode = "command" | "edit"

/**
 * The notebook: a list of cells with Jupyter's command and edit modes. In
 * command mode the notebook has focus and single keys act on the selected
 * cell; in edit mode the cell's editor has focus.
 */
export function Notebook(props: NotebookProps) {
  const { store, rendermime, compare, kernel, executor } = props
  let root!: HTMLDivElement
  const editors = new Map<string, CellEditor>()
  const [active, setActive] = createSignal<string | null>(null)
  const [mode, setMode] = createSignal<Mode>("command")
  const [editingMarkdown, setEditingMarkdown] = createSignal<ReadonlySet<string>>(new Set())
  const [status, setStatus] = createSignal<KernelStatus>(kernel?.status ?? "dead")
  const [clipboard, setClipboard] = createSignal<nbformat.ICell[]>([])
  let pendingDelete = false

  if (kernel) onCleanup(kernel.onStatus(setStatus))

  const [dragging, setDragging] = createSignal(false)
  onMount(() => {
    if (!props.links) return
    onCleanup(
      acceptDrops(root, {
        enabled: () => !readOnly(),
        onDragging: setDragging,
        onDrop: items => store.setPatchworkMetadata({ imports: withDropped(importsOf(store.current()), items, props.links!.url) }),
      }),
    )
  })

  const cellIds = createMemo(() => (store.doc()?.cells ?? []).map(cell => readString(cell.id)), [], {
    equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
  })
  // Combined shows two versions in one, and a merge's result isn't anyone's
  // to edit: both are only read.
  const readOnly = () => store.readOnly() || compare.mode() === "inline" || compare.merging()
  const canRun = () => !!executor && !readOnly()
  // Side by side, the notebook draws the other version beside this one.
  const side = () => compare.mode() === "side-by-side"

  // Keep a cell selected while there are cells, near the one that went away.
  let lastIndex = 0
  createEffect(() => {
    const ids = cellIds()
    const current = active()
    if (ids.length && (!current || !ids.includes(current))) setActive(ids[Math.min(lastIndex, ids.length - 1)])
  })
  createEffect(() => {
    const index = cellIds().indexOf(active() ?? "")
    if (index >= 0) lastIndex = index
  })

  /** Whether the comparison marks the cell, or shows cells next to it. */
  const marked = (id: string, last: boolean) => {
    const ghosts = compare.ghosts()
    return (
      !!compare.own()?.cells.has(id) ||
      !!compare.versions()?.cells.has(id) ||
      ghosts.has(id) ||
      (last && ghosts.has(null))
    )
  }

  // Runs of unfolded cells, by their first cell, opened by clicking their row.
  const [unfolded, setUnfolded] = createSignal<ReadonlySet<string>>(new Set())
  createEffect(on([compare.collapsed, compare.mode], () => setUnfolded(new Set<string>())))

  /** Folding what's unchanged away: each run of unmarked cells becomes one row. */
  const folding = createMemo(() => {
    const folded = new Map<string, number>() // hidden cells; the first of each run holds the run's length
    if (!compare.collapsed() || !compare.mode()) return folded
    const ids = cellIds()
    let runStart = -1
    ids.forEach((id, index) => {
      if (marked(id, index === ids.length - 1)) {
        runStart = -1
        return
      }
      if (runStart < 0) runStart = index
      if (unfolded().has(ids[runStart])) return
      folded.set(id, 0)
      folded.set(ids[runStart], (folded.get(ids[runStart]) ?? 0) + 1)
    })
    return folded
  })

  const select = (id: string | null, focusMode: Mode = mode()) => {
    if (!id) return
    setActive(id)
    setMode(focusMode)
    if (focusMode === "edit") {
      if (cellType(id) === "markdown") setEditingMarkdown(set => new Set(set).add(id))
      queueMicrotask(() => editors.get(id)?.focus())
    } else {
      queueMicrotask(() => root.focus({ preventScroll: true }))
    }
    queueMicrotask(() => root.querySelector(`[data-cell-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }))
  }

  const activeType = () => {
    const id = active()
    return (id && readString(store.cell(id)?.cell_type)) || "code"
  }
  const cellType = (id: string): string => readString(store.cell(id)?.cell_type)
  const neighbour = (id: string, delta: number): string | null => {
    const ids = cellIds()
    const index = ids.indexOf(id)
    return index < 0 ? null : (ids[index + delta] ?? null)
  }

  const insert = (where: "above" | "below" | "end", type: CellType = "code"): string | null => {
    if (readOnly()) return null
    const ids = cellIds()
    const index = where === "end" ? ids.length : ids.indexOf(active() ?? "") + (where === "below" ? 1 : 0)
    return store.insertCell(Math.max(0, index), type)
  }

  /** Renders a markdown cell or runs a code cell. */
  const runCell = (id: string) => {
    if (cellType(id) === "markdown") {
      setEditingMarkdown(set => {
        const next = new Set(set)
        next.delete(id)
        return next
      })
    } else if (cellType(id) === "code" && canRun()) {
      executor!.run([id])
    }
  }

  const run = (then: "stay" | "next" | "insert") => {
    const id = active()
    if (!id) return
    runCell(id)
    if (then === "stay") return select(id, cellType(id) === "markdown" ? "command" : mode())
    if (then === "insert") return select(insert("below"), "edit")
    const next = neighbour(id, 1)
    if (next) select(next, "command")
    else select(insert("end"), "edit")
  }

  const runAll = () => {
    for (const id of cellIds()) if (cellType(id) === "markdown") runCell(id)
    if (canRun()) executor!.run(cellIds().filter(id => cellType(id) === "code"))
  }

  const restart = async () => {
    executor?.cancel()
    await kernel?.restart()
  }

  /** Copies the selected cell, and with `cut` deletes it, as Jupyter's x and c. */
  const copyCell = (cut = false) => {
    const id = active()
    const cell = id && store.cell(id, store.current())
    if (!id || !cell) return
    setClipboard([plainCell(cell)])
    if (cut && !readOnly()) {
      const next = neighbour(id, 1) ?? neighbour(id, -1)
      store.deleteCells([id])
      if (next) select(next, "command")
    }
  }

  /** Pastes the copied cells below the selected one, as Jupyter's v. */
  const pasteCells = () => {
    const cells = clipboard()
    if (!cells.length || readOnly()) return
    const index = cellIds().indexOf(active() ?? "") + 1
    const [first] = store.insertCells(index > 0 ? index : cellIds().length, cells)
    select(first, "command")
  }

  const restartAndRunAll = async () => {
    await restart()
    runAll()
  }

  const toCommandMode = () => {
    const id = active()
    if (id && cellType(id) === "markdown" && readString(store.cell(id)?.source)) runCell(id)
    select(id, "command")
  }

  const onCommandKey = (event: KeyboardEvent) => {
    if (event.target !== root || mode() !== "command") return
    const id = active()
    const key = event.key
    const handled = () => event.preventDefault()
    if (key === "Enter" && event.shiftKey) return handled(), run("next")
    if (key === "Enter" && (event.ctrlKey || event.metaKey)) return handled(), run("stay")
    if (key === "Enter" && event.altKey) return handled(), run("insert")
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (key === "Enter" && id) return handled(), select(id, "edit")
    if ((key === "ArrowUp" || key === "k") && id) return handled(), select(neighbour(id, -1) ?? id, "command")
    if ((key === "ArrowDown" || key === "j") && id) return handled(), select(neighbour(id, 1) ?? id, "command")
    if (readOnly() || !id) return
    if (key === "a") return handled(), select(insert("above"), "command")
    if (key === "b") return handled(), select(insert("below"), "command")
    if (key === "m") return handled(), store.setCellType(id, "markdown")
    if (key === "y") return handled(), store.setCellType(id, "code")
    if (key === "r") return handled(), store.setCellType(id, "raw")
    if (key === "c" || key === "x") return handled(), copyCell(key === "x")
    if (key === "v") return handled(), pasteCells()
    if (key === "d") {
      handled()
      if (!pendingDelete) {
        pendingDelete = true
        setTimeout(() => (pendingDelete = false), 800)
        return
      }
      pendingDelete = false
      const next = neighbour(id, 1) ?? neighbour(id, -1)
      store.deleteCells([id])
      if (next) select(next, "command")
    }
  }

  return (
    <div class="pwnb" classList={{ "pwnb-read-only": readOnly(), "pwnb-merging": compare.merging() }} tabIndex={0} ref={root} onKeyDown={onCommandKey}>
      <div class="pwnb-toolbar">
        <Show when={!readOnly()}>
          <ToolButton icon={icons.add} title="Insert a cell below (B)" onClick={() => select(insert("below"), "command")} />
          <span class="pwnb-toolbar-gap" />
          <ToolButton icon={icons.cut} title="Cut this cell (X)" disabled={!active()} onClick={() => copyCell(true)} />
          <ToolButton icon={icons.copy} title="Copy this cell (C)" disabled={!active()} onClick={() => copyCell()} />
          <ToolButton icon={icons.paste} title="Paste cells from the clipboard (V)" disabled={!clipboard().length} onClick={pasteCells} />
          <span class="pwnb-toolbar-gap" />
          <ToolButton icon={icons.run} title="Run this cell and advance (Shift-Enter)" disabled={!active()} onClick={() => run("next")} />
          <ToolButton icon={icons.restart} title="Restart the kernel" disabled={!kernel} onClick={() => void restart()} />
          <ToolButton icon={icons.runAll} title="Restart the kernel and run all cells" disabled={!canRun()} onClick={() => void restartAndRunAll()} />
          <span class="pwnb-toolbar-gap" />
          <select
            class="pwnb-cell-type"
            title="Cell type"
            disabled={!active()}
            onChange={event => {
              const id = active()
              if (!id) return
              store.setCellType(id, event.currentTarget.value as CellType)
              select(id, "command")
            }}
          >
            <option value="code" selected={activeType() === "code"}>Code</option>
            <option value="markdown" selected={activeType() === "markdown"}>Markdown</option>
            <option value="raw" selected={activeType() === "raw"}>Raw</option>
          </select>
        </Show>
        <span class="pwnb-toolbar-spacer" />
        <Show when={compare.mode() === "inline" && compare.names()}>
          {names => (
            <span class="pwnb-legend">
              <span class="pwnb-legend-ours">{compare.merging() ? "After the merge" : names().ours}</span>
              <span class="pwnb-legend-theirs">{compare.merging() ? "Before" : names().theirs}</span>
            </span>
          )}
        </Show>
        <Show when={readOnly()} fallback={<KernelStatusBadge status={status} hasKernel={!!kernel} />}>
          <span class="pwnb-status">Read-only</span>
        </Show>
        <Show when={side() && compare.names()}>
          {names => (
            <div class="pwnb-side-headings">
              <span class="pwnb-legend-ours">{compare.merging() ? "After the merge" : names().ours}</span>
              <span class="pwnb-legend-theirs">{compare.merging() ? "Before" : names().theirs}</span>
            </div>
          )}
        </Show>
      </div>
      <Show when={props.links}>
        {links => (
          <ImportsPanel
            store={store}
            find={links().find}
            url={links().url}
            open={links().open}
            readOnly={readOnly}
            dragging={dragging}
            running={() => !!executor && (executor.running() !== null || executor.queued().size > 0)}
            datatype={links().datatype}
            canRun={canRun}
            rerun={() => executor?.run(cellIds().filter(id => cellType(id) === "code"))}
          />
        )}
      </Show>
      <div class="pwnb-cells" classList={{ "pwnb-side": side() }}>
        <For each={cellIds()}>
          {(id, index) => (
            <>
              <Show
                when={side()}
                fallback={<GhostCells cells={compare.ghosts().get(id)} theirs={!!compare.versions()} rendermime={rendermime} />}
              >
                <TheirRows cells={compare.ghosts().get(id)} compare={compare} rendermime={rendermime} />
              </Show>
              <Show when={(folding().get(id) ?? 0) > 0}>
                <button type="button" class="pwnb-folded" onClick={() => setUnfolded(set => new Set(set).add(id))}>
                  {foldedLabel(folding().get(id)!)}
                </button>
              </Show>
              <div class="pwnb-row" hidden={folding().has(id)}>
              <Cell
                id={id}
                store={store}
                rendermime={rendermime}
                hidden={folding().has(id)}
                active={active() === id}
                mode={mode()}
                editingMarkdown={editingMarkdown().has(id)}
                running={executor?.running() === id}
                queued={!!executor?.queued().has(id)}
                compare={compare}
                readOnly={readOnly()}
                editors={editors}
                kernel={kernel}
                status={status}
                onSelect={select}
                onRun={run}
                onEscape={toCommandMode}
                onBoundary={direction => {
                  const next = neighbour(id, direction === "up" ? -1 : 1)
                  if (!next) return false
                  select(next, "edit")
                  queueMicrotask(() => editors.get(next)?.focus(direction === "up" ? "end" : "start"))
                  return true
                }}
              />
              <Show when={side()}>
                <TheirCell id={id} ours={() => readString(store.cell(id)?.source)} compare={compare} rendermime={rendermime} />
              </Show>
              </div>
              <Show when={index() === cellIds().length - 1}>
                <Show
                  when={side()}
                  fallback={<GhostCells cells={compare.ghosts().get(null)} theirs={!!compare.versions()} rendermime={rendermime} />}
                >
                  <TheirRows cells={compare.ghosts().get(null)} compare={compare} rendermime={rendermime} />
                </Show>
              </Show>
            </>
          )}
        </For>
        <Show when={cellIds().length === 0 && !readOnly()}>
          <button type="button" class="pwnb-empty" onClick={() => select(insert("end"), "edit")}>
            Add a cell
          </button>
        </Show>
      </div>
    </div>
  )
}

/**
 * A toolbar button with one of JupyterLab's toolbar icons. It doesn't take
 * focus, so the notebook stays in the mode it was in.
 */
function ToolButton(props: { icon: string; title: string; disabled?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      class="pwnb-tool"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      innerHTML={props.icon}
      onMouseDown={event => event.preventDefault()}
      onClick={() => props.onClick()}
    />
  )
}

function foldedLabel(count: number): string {
  return count === 1 ? "1 unchanged cell" : `${count} unchanged cells`
}

function KernelStatusBadge(props: { status: Accessor<KernelStatus>; hasKernel: boolean }) {
  const label = () => {
    if (!props.hasKernel) return "No kernel"
    const status = props.status()
    return status === "starting" ? "Python · starting…" : status === "dead" ? "Python · stopped" : `Python · ${status}`
  }
  return (
    <span class="pwnb-status" data-status={props.hasKernel ? props.status() : "dead"}>
      <span class="pwnb-status-dot" />
      {label()}
    </span>
  )
}

/**
 * Cells this version doesn't have, where they'd be: the ones this draft
 * removed, struck through, or (`theirs`, combined) the other version's, in
 * its colour, outputs and all.
 */
function GhostCells(props: { cells: DeletedCell[] | undefined; theirs: boolean; rendermime: RenderMimeRegistry }) {
  return (
    <For each={props.cells ?? []}>
      {cell => (
        <div
          class="pwnb-ghost"
          classList={{ "pwnb-ghost-removed": !props.theirs, "pwnb-ghost-theirs": props.theirs }}
          data-cell-type={cell.cellType}
          data-ghost-id={cell.id}
        >
          <div class="pwnb-prompt">{props.theirs ? "" : "−"}</div>
          <div class="pwnb-body">
            <pre classList={{ "pwnb-ghost-empty": !cell.source }}>{cell.source || "empty cell"}</pre>
            <Show when={props.theirs && cell.cellType === "code" && cell.outputs.length > 0}>
              <div class="pwnb-outputs">
                <For each={cell.outputs}>{output => <Output rendermime={props.rendermime} output={output} />}</For>
              </div>
            </Show>
          </div>
        </div>
      )}
    </For>
  )
}

/**
 * Side by side: the other version's cells this one doesn't have, each on a
 * row of its own with nothing on this side.
 */
function TheirRows(props: { cells: DeletedCell[] | undefined; compare: CompareState; rendermime: RenderMimeRegistry }) {
  return (
    <For each={props.cells ?? []}>
      {cell => (
        <div class="pwnb-row">
          <div class="pwnb-row-gap" />
          <TheirCell id={cell.id} ours={() => null} compare={props.compare} rendermime={props.rendermime} />
        </div>
      )}
    </For>
  )
}

/**
 * Side by side: the other version of the cell `id`, read-only, beside this
 * version's (`ours`, null when this version doesn't have it). Lines that
 * differ are amber; a cell only it has is green where its draft added it and
 * red where this draft took it out.
 */
function TheirCell(props: { id: string; ours: () => string | null; compare: CompareState; rendermime: RenderMimeRegistry }) {
  const cell = createMemo((): CellDoc | undefined => {
    const doc = props.compare.theirs()
    const index = doc ? findCellIndex(doc, props.id) : -1
    return index < 0 ? undefined : doc!.cells![index]
  })
  return (
    <Show when={cell()} fallback={<div class="pwnb-row-gap" />}>
      {current => {
        let editorHost!: HTMLDivElement
        const type = createMemo(() => readString(current().cell_type) || "code")
        const source = createMemo(() => readString(current().source))
        const outputs = createMemo(() => (current().outputs ?? []) as unknown[])
        const versus = createMemo(() => props.compare.versions()?.cells.get(props.id))
        const mark = () => {
          if (props.ours() === null) return props.compare.parted().has(props.id) ? "removed" : "added"
          return versus()?.type === "differs" ? "differs" : null
        }
        const marks = createMemo<EditorMarks>(() => {
          const ours = props.ours()
          return ours !== null && ours !== source() ? { kind: "versus", source: ours } : null
        })
        const outputsDiffer = () => {
          const other = versus()
          return other?.type === "differs" && other.outputs !== null
        }
        const showRendered = () => type() === "markdown" && source() !== "" && !marks()
        onMount(() => {
          const editor = new CellEditor({
            parent: editorHost,
            source: source(),
            language: language(type()),
            readOnly: true,
            onEdit: () => {},
            keys: [],
          })
          createEffect(on(source, text => editor.setSource(text), { defer: true }))
          createEffect(on(type, cellType => editor.setLanguage(language(cellType)), { defer: true }))
          createEffect(() => editor.setMarks(marks()))
          onCleanup(() => editor.destroy())
        })
        return (
          <div
            class="pwnb-cell pwnb-their-cell"
            data-their-cell-id={props.id}
            data-cell-type={type()}
            classList={{
              "pwnb-side-added": mark() === "added",
              "pwnb-side-removed": mark() === "removed",
              "pwnb-side-differs": mark() === "differs",
              "pwnb-side-outputs": outputsDiffer(),
            }}
          >
            <div class="pwnb-prompt">{type() === "code" ? `[${current().execution_count ?? " "}]:` : ""}</div>
            <div class="pwnb-body">
              <Show when={showRendered()}>
                <Rendered rendermime={props.rendermime} bundle={{ "text/markdown": source() }} class="pwnb-markdown" />
              </Show>
              <div class="pwnb-editor" ref={editorHost} hidden={showRendered()} />
              <Show when={type() === "code" && outputs().length > 0}>
                <div class="pwnb-outputs">
                  <For each={outputs()}>{output => <Output rendermime={props.rendermime} output={output} />}</For>
                </div>
              </Show>
            </div>
          </div>
        )
      }}
    </Show>
  )
}

type CellProps = {
  id: string
  store: NotebookStore
  rendermime: RenderMimeRegistry
  hidden: boolean
  active: boolean
  mode: Mode
  editingMarkdown: boolean
  running: boolean
  queued: boolean
  compare: CompareState
  /** Whether the cell can't be edited, also while the comparison shows it read-only. */
  readOnly: boolean
  editors: Map<string, CellEditor>
  kernel?: KernelClient
  status: Accessor<KernelStatus>
  onSelect(id: string, mode?: Mode): void
  onRun(then: "stay" | "next" | "insert"): void
  onEscape(): void
  onBoundary(direction: "up" | "down"): boolean
}

function Cell(props: CellProps) {
  const { store, id } = props
  let editorHost!: HTMLDivElement
  const cell = createMemo(() => store.cell(id))
  const type = createMemo(() => readString(cell()?.cell_type) || "code")
  const source = createMemo(() => readString(cell()?.source))
  const outputs = createMemo(() => (cell()?.outputs ?? []) as unknown[])
  /** What this draft changed in the cell (stacked, side by side). */
  const change = createMemo(() => props.compare.own()?.cells.get(id))
  /** How the cell differs from the other version (combined). */
  const versus = createMemo(() => props.compare.versions()?.cells.get(id))
  const combined = () => props.compare.mode() === "inline"
  const side = () => props.compare.mode() === "side-by-side"
  const marks = createMemo<EditorMarks>(() => {
    const own = change()
    if (own?.type === "changed" && own.source.length) return { kind: "own", changes: own.source }
    const other = versus()
    if (other?.type === "differs" && other.source !== null) {
      return { kind: side() ? "versus" : "theirs", source: other.source }
    }
    return null
  })
  // Combined, the other version's outputs and cell type show in this cell;
  // side by side, in its own beside it.
  const theirOutputs = () => {
    const other = versus()
    return combined() && other?.type === "differs" ? other.outputs : null
  }
  const theirType = () => {
    const other = versus()
    return combined() && other?.type === "differs" ? other.cellType : null
  }
  /** Side by side: how this cell differs from the one beside it. */
  const sideMark = () => {
    if (!side()) return null
    const other = versus()
    if (other?.type === "ours") return props.compare.parted().has(id) ? "removed" : "added"
    return other?.type === "differs" ? "differs" : null
  }
  // A markdown cell whose source is marked shows the source, marks and all.
  const showRendered = () => type() === "markdown" && !props.editingMarkdown && source() !== "" && !marks()

  const prompt = () => {
    if (type() !== "code") return ""
    if (props.running || props.queued) return "[*]:"
    const count = cell()?.execution_count
    return `[${count ?? " "}]:`
  }

  onMount(() => {
    const editor = new CellEditor({
      parent: editorHost,
      source: source(),
      language: language(type()),
      readOnly: props.readOnly,
      onEdit: edits => store.editSource(id, edits),
      onFocus: () => {
        if (!props.active || props.mode !== "edit") props.onSelect(id, "edit")
      },
      keys: [
        { key: "Shift-Enter", run: () => (props.onRun("next"), true) },
        { key: "Mod-Enter", run: () => (props.onRun("stay"), true) },
        { key: "Alt-Enter", run: () => (props.onRun("insert"), true) },
        { key: "Escape", run: () => (props.onEscape(), true) },
        { key: "ArrowUp", run: view => atBoundary(view, "up") && props.onBoundary("up") },
        { key: "ArrowDown", run: view => atBoundary(view, "down") && props.onBoundary("down") },
      ],
      complete: async (code, cursor) => {
        const kernel = props.kernel
        if (!kernel || type() !== "code" || props.status() === "starting" || props.status() === "dead") return null
        const reply = await kernel.complete(code, cursor)
        if (reply.status !== "ok") return null
        return { from: reply.cursor_start, to: reply.cursor_end, options: reply.matches }
      },
    })
    props.editors.set(id, editor)
    createEffect(on(source, text => editor.setSource(text), { defer: true }))
    createEffect(on(() => props.readOnly, readOnly => editor.setReadOnly(readOnly), { defer: true }))
    createEffect(on(type, cellType => editor.setLanguage(language(cellType)), { defer: true }))
    createEffect(() => editor.setMarks(marks()))
    onCleanup(() => {
      if (props.editors.get(id) === editor) props.editors.delete(id)
      editor.destroy()
    })
  })

  return (
    <div
      class="pwnb-cell"
      data-cell-id={id}
      data-cell-type={type()}
      hidden={props.hidden}
      classList={{
        "pwnb-active": props.active,
        "pwnb-editing": props.active && props.mode === "edit",
        "pwnb-diff-added": change()?.type === "added",
        "pwnb-diff-changed": change()?.type === "changed" && (change() as { input: boolean }).input,
        "pwnb-diff-outputs": change()?.type === "changed" && (change() as { outputs: boolean }).outputs,
        "pwnb-ours": combined() && versus()?.type === "ours",
        "pwnb-differs": combined() && versus()?.type === "differs",
        "pwnb-side-added": sideMark() === "added",
        "pwnb-side-removed": sideMark() === "removed",
        "pwnb-side-differs": sideMark() === "differs",
        "pwnb-side-outputs": side() && versus()?.type === "differs" && (versus() as { outputs: unknown }).outputs !== null,
      }}
      onMouseDown={event => {
        if (!(event.target as Element).closest(".cm-editor")) props.onSelect(id, "command")
      }}
      onDblClick={() => {
        if (type() === "markdown" && !props.readOnly) props.onSelect(id, "edit")
      }}
    >
      <div class="pwnb-prompt">{prompt()}</div>
      <div class="pwnb-body">
        <Show when={showRendered()}>
          <Rendered rendermime={props.rendermime} bundle={{ "text/markdown": source() }} class="pwnb-markdown" />
        </Show>
        <div class="pwnb-editor" ref={editorHost} hidden={showRendered()} />
        <Show when={theirType()}>
          {other => <div class="pwnb-theirs-type">{other()} cell in the other version</div>}
        </Show>
        <Show when={type() === "code" && outputs().length > 0}>
          <div class="pwnb-outputs" classList={{ "pwnb-ours-outputs": !!theirOutputs() }}>
            <For each={outputs()}>{output => <Output rendermime={props.rendermime} output={output} />}</For>
          </div>
        </Show>
        <Show when={theirOutputs()}>
          {other => (
            <div class="pwnb-outputs pwnb-theirs-outputs">
              <Show when={other().length === 0}>
                <div class="pwnb-theirs-empty">no output in the other version</div>
              </Show>
              <For each={other()}>{output => <Output rendermime={props.rendermime} output={output} />}</For>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

function language(cellType: string): EditorLanguage {
  return cellType === "code" ? "python" : cellType === "markdown" ? "markdown" : "text"
}

function Output(props: { rendermime: RenderMimeRegistry; output: unknown }) {
  const plain = createMemo(() => toOutput(props.output))
  return (
    <Rendered
      rendermime={props.rendermime}
      bundle={outputBundle(plain())}
      metadata={(plain() as { metadata?: Record<string, unknown> }).metadata}
      class="pwnb-output"
    />
  )
}

/** Renders a mime bundle with rendermime, again whenever it changes. */
function Rendered(props: { rendermime: RenderMimeRegistry; bundle: nbformat.IMimeBundle; metadata?: Record<string, unknown>; class: string }) {
  let host!: HTMLDivElement
  let dispose = () => {}
  let generation = 0
  onMount(() => {
    createEffect(() => {
      const bundle = props.bundle
      const metadata = props.metadata
      const current = ++generation
      const target = document.createElement("div")
      void renderBundle(props.rendermime, target, bundle, metadata).then(
        release => {
          if (current !== generation) return release()
          dispose()
          dispose = release
          host.replaceChildren(...target.childNodes)
        },
        error => console.warn("[jupyter] couldn't render an output", error),
      )
    })
  })
  onCleanup(() => {
    generation++
    dispose()
  })
  return <div class={props.class} ref={host} />
}

function toOutput(output: unknown): nbformat.IOutput {
  return toPlain<nbformat.IOutput>(output)
}
