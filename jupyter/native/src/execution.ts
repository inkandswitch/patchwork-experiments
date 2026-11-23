import type * as nbformat from "@jupyterlab/nbformat"
import type { KernelMessage } from "@jupyterlab/services"
import { type Accessor, createSignal } from "solid-js"
import { readString } from "../../shared/json"
import type { NotebookStore } from "./doc"
import type { KernelClient } from "./kernel/types"

/**
 * Runs cells one at a time on this tab's kernel and writes what they output
 * into the document as it arrives, so every peer sees it live. Which cells
 * are queued or running is this tab's alone, not the document's.
 */
export class Executor {
  readonly running: Accessor<string | null>
  readonly queued: Accessor<ReadonlySet<string>>

  constructor(store: NotebookStore, kernel: KernelClient) {
    this._store = store
    this._kernel = kernel
    const [running, setRunning] = createSignal<string | null>(null)
    const [queued, setQueued] = createSignal<ReadonlySet<string>>(new Set(), { equals: false })
    this.running = running
    this.queued = queued
    this._setRunning = setRunning
    this._setQueued = setQueued
  }

  run(ids: string[]): void {
    for (const id of ids) {
      if (this._queue.includes(id) || this.running() === id) continue
      this._queue.push(id)
    }
    this._publishQueue()
    void this._drain()
  }

  /** Forgets the queue; the kernel restart that usually follows stops the running cell. */
  cancel(): void {
    this._queue = []
    this._publishQueue()
  }

  dispose(): void {
    this.cancel()
    this._disposed = true
  }

  private async _drain(): Promise<void> {
    if (this._draining) return
    this._draining = true
    try {
      while (this._queue.length && !this._disposed) {
        const id = this._queue.shift()!
        this._publishQueue()
        const ok = await this._execute(id)
        if (!ok) this.cancel()
      }
    } finally {
      this._draining = false
    }
  }

  /** False when the cell raised, so the rest of the queue doesn't run. */
  private async _execute(id: string): Promise<boolean> {
    const cell = this._store.cell(id, this._store.current())
    if (!cell || readString(cell.cell_type) !== "code") return true
    const code = readString(cell.source)
    this._store.clearOutputs(id)
    forgetDisplays(this._displays, id)
    this._setRunning(id)
    const writer = new OutputWriter(this._store, id, this._displays)
    try {
      const reply = await this._kernel.execute(code, message => writer.handle(message))
      this._store.setExecutionCount(id, reply.execution_count ?? null)
      return reply.status === "ok"
    } catch (error) {
      console.warn("[jupyter] the cell didn't finish", error)
      return false
    } finally {
      this._setRunning(null)
    }
  }

  private _publishQueue(): void {
    this._setQueued(new Set(this._queue))
  }

  private _disposed = false
  private _displays: Displays = new Map()
  private _draining = false
  private _kernel: KernelClient
  private _queue: string[] = []
  private _setQueued: (queued: ReadonlySet<string>) => void
  private _setRunning: (id: string | null) => void
  private _store: NotebookStore
}

/** Where outputs with a `display_id` went, so `update_display_data` can find them. */
type Displays = Map<string, Array<{ cellId: string; index: number }>>

function forgetDisplays(displays: Displays, cellId: string): void {
  for (const [displayId, places] of displays) {
    const kept = places.filter(place => place.cellId !== cellId)
    if (kept.length) displays.set(displayId, kept)
    else displays.delete(displayId)
  }
}

/** Turns one execution's IOPub messages into nbformat outputs, as JupyterLab's output area does. */
class OutputWriter {
  constructor(store: NotebookStore, cellId: string, displays: Displays) {
    this._store = store
    this._cellId = cellId
    this._displays = displays
  }

  handle(message: KernelMessage.IIOPubMessage): void {
    const content = message.content as any
    switch (message.header.msg_type) {
      case "stream":
        this._stream(content.name, content.text)
        break
      case "display_data":
        this._append({ output_type: "display_data", data: content.data, metadata: content.metadata ?? {} }, content.transient?.display_id)
        break
      case "execute_result":
        this._append(
          { output_type: "execute_result", execution_count: content.execution_count, data: content.data, metadata: content.metadata ?? {} },
          content.transient?.display_id,
        )
        break
      case "error":
        this._append({ output_type: "error", ename: content.ename, evalue: content.evalue, traceback: content.traceback })
        break
      case "update_display_data":
        this._update(content.transient?.display_id, content.data, content.metadata ?? {})
        break
      case "clear_output":
        if (content.wait) this._clearOnNext = true
        else this._clear()
        break
    }
  }

  private _stream(name: string, text: string): void {
    this._clearIfWaiting()
    const cell = this._store.cell(this._cellId, this._store.current())
    const outputs = cell?.outputs ?? []
    const index = outputs.length - 1
    const last = outputs[index] as Record<string, unknown> | undefined
    if (last && readString(last.output_type) === "stream" && readString(last.name) === name) {
      const current = readString(last.text)
      if (/[\r\b]/.test(text) || current.endsWith("\r")) {
        this._store.writeStream(this._cellId, index, removeOverwrittenChars(current + text), true)
      } else {
        this._store.writeStream(this._cellId, index, text, false)
      }
      return
    }
    this._store.appendOutput(this._cellId, { output_type: "stream", name, text: removeOverwrittenChars(text) } as nbformat.IStream)
  }

  private _append(output: nbformat.IOutput, displayId?: string): void {
    this._clearIfWaiting()
    const index = this._store.appendOutput(this._cellId, output)
    if (displayId && index >= 0) {
      this._displays.set(displayId, [...(this._displays.get(displayId) ?? []), { cellId: this._cellId, index }])
    }
  }

  private _update(displayId: string | undefined, data: nbformat.IMimeBundle, metadata: nbformat.OutputMetadata): void {
    if (!displayId) return
    for (const { cellId, index } of this._displays.get(displayId) ?? []) {
      const existing = this._store.cell(cellId, this._store.current())?.outputs?.[index] as Record<string, unknown> | undefined
      if (!existing) continue
      const outputType = readString(existing.output_type)
      if (outputType === "execute_result") {
        this._store.setOutput(cellId, index, { output_type: "execute_result", execution_count: existing.execution_count as number, data, metadata })
      } else if (outputType === "display_data") {
        this._store.setOutput(cellId, index, { output_type: "display_data", data, metadata })
      }
    }
  }

  private _clearIfWaiting(): void {
    if (!this._clearOnNext) return
    this._clearOnNext = false
    this._clear()
  }

  private _clear(): void {
    this._store.clearOutputs(this._cellId)
    forgetDisplays(this._displays, this._cellId)
  }

  private _cellId: string
  private _clearOnNext = false
  private _displays: Displays
  private _store: NotebookStore
}

/** Apply `\b` and `\r` as a terminal would, as JupyterLab does for stream output. */
export function removeOverwrittenChars(text: string): string {
  return fixCarriageReturn(fixBackspace(text))
}

function fixBackspace(text: string): string {
  let next = text
  do {
    text = next
    next = text.replace(/[^\n]\x08/gm, "")
  } while (next.length < text.length)
  return text
}

function fixCarriageReturn(text: string): string {
  text = text.replace(/\r+\n/gm, "\n")
  while (text.search(/\r[^$]/g) > -1) {
    const base = text.match(/^(.*)\r+/m)![1]
    let insert = text.match(/\r+(.*)$/m)![1]
    insert = insert + base.slice(insert.length, base.length)
    text = text.replace(/\r+.*$/m, "\r").replace(/^.*\r/m, insert)
  }
  return text
}
