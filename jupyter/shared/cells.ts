import type * as nbformat from "@jupyterlab/nbformat"
import type { KernelMessage } from "@jupyterlab/services"
import type { KernelClient } from "../native/src/kernel/types"
import { readString } from "./json"
import type { NotebookWriter } from "./notebook-writer"

/** How one cell's run ended. */
export type CellResult = {
  id: string
  status: "ok" | "error" | "skipped" | "stopped"
  executionCount: number | null
  ename?: string
  evalue?: string
  traceback?: string[]
}

/** A batch's results, and why it didn't run at all when it couldn't. */
export type RunOutcome = { results: CellResult[]; problem?: string }

export type RunnerHooks = {
  /**
   * Before a batch runs: resolve imports, record the run. Throwing stops the
   * batch, and every cell queued in it ends `stopped`, with the error's
   * message as the batch's problem.
   */
  prepare?(ids: string[]): Promise<void>
  /** After a batch: record how it ended. */
  finish?(outcome: RunOutcome): Promise<void> | void
  /** Which cell runs and which are queued, whenever that changes. */
  onState?(running: string | null, queued: readonly string[]): void
}

/**
 * Runs cells one at a time on a kernel and writes what they output into the
 * document as it arrives, so every peer sees it live. A batch is what runs
 * from an idle start until the queue is empty; `prepare` runs before each
 * batch and `finish` after it. When a cell raises, the rest of the queue is
 * skipped, as in Jupyter. Framework-free: the native tool's Executor wraps it
 * in signals, and notebook_run uses it headless.
 */
export class CellRunner {
  constructor(writer: NotebookWriter, kernel: KernelClient, hooks: RunnerHooks = {}) {
    this._writer = writer
    this._kernel = kernel
    this._hooks = hooks
  }

  get running(): string | null {
    return this._running
  }

  get queued(): readonly string[] {
    return this._queue
  }

  /** Queues cells; resolves when every one of them has ended (run, skipped or stopped). */
  run(ids: string[]): Promise<RunOutcome> {
    const waits: Promise<CellResult>[] = []
    for (const id of ids) {
      waits.push(new Promise(resolve => this._waiters.set(id, [...(this._waiters.get(id) ?? []), resolve])))
      if (this._queue.includes(id) || this._running === id) continue
      this._queue.push(id)
    }
    this._publish()
    const batch = this._drain()
    return Promise.all(waits).then(async results => ({ results, ...((await batch) ? { problem: await batch } : {}) }))
  }

  /** Forgets the queue: its cells end `stopped`. The kernel restart that usually follows stops the running cell. */
  cancel(): void {
    const dropped = this._queue
    this._queue = []
    for (const id of dropped) this._settle({ id, status: "stopped", executionCount: null })
    this._publish()
  }

  dispose(): void {
    this.cancel()
    this._disposed = true
  }

  /** Runs the queue until it is empty; resolves with the batch's problem, if it couldn't start. */
  private _drain(): Promise<string | undefined> {
    if (this._batch) return this._batch
    this._batch = (async () => {
      const results: CellResult[] = []
      let problem: string | undefined
      try {
        try {
          await this._hooks.prepare?.([...this._queue])
        } catch (error) {
          problem = (error as Error)?.message ?? String(error)
          const dropped = this._queue
          this._queue = []
          for (const id of dropped) {
            const result: CellResult = { id, status: "stopped", executionCount: null }
            results.push(result)
            this._settle(result)
          }
          this._publish()
          return problem
        }
        while (this._queue.length && !this._disposed) {
          const id = this._queue.shift()!
          this._publish()
          const result = await this._execute(id)
          results.push(result)
          this._settle(result)
          if (result.status === "error") {
            const skipped = this._queue
            this._queue = []
            for (const other of skipped) {
              const r: CellResult = { id: other, status: "skipped", executionCount: null }
              results.push(r)
              this._settle(r)
            }
            this._publish()
          }
        }
        return undefined
      } finally {
        // Cleared before `finish` awaits, so a cell queued meanwhile starts a new batch.
        this._batch = null
        try {
          await this._hooks.finish?.({ results, ...(problem ? { problem } : {}) })
        } catch (error) {
          console.warn("[jupyter] couldn't record how the run ended", error)
        }
        if (this._queue.length && !this._batch && !this._disposed) void this._drain()
      }
    })()
    return this._batch
  }

  private async _execute(id: string): Promise<CellResult> {
    const cell = this._writer.cell(id, this._writer.current())
    if (!cell || readString(cell.cell_type) !== "code") return { id, status: "ok", executionCount: null }
    const code = readString(cell.source)
    this._writer.clearOutputs(id)
    forgetDisplays(this._displays, id)
    this._running = id
    this._publish()
    const writer = new OutputWriter(this._writer, id, this._displays)
    try {
      const reply = await this._kernel.execute(code, message => writer.handle(message))
      this._writer.setExecutionCount(id, reply.execution_count ?? null)
      if (reply.status === "ok") return { id, status: "ok", executionCount: reply.execution_count ?? null }
      const error = reply as KernelMessage.IReplyErrorContent
      return { id, status: "error", executionCount: reply.execution_count ?? null, ename: error.ename, evalue: error.evalue, traceback: error.traceback }
    } catch (error) {
      console.warn("[jupyter] the cell didn't finish", error)
      return { id, status: "stopped", executionCount: null, evalue: (error as Error)?.message ?? String(error) }
    } finally {
      this._running = null
      this._publish()
    }
  }

  private _settle(result: CellResult): void {
    const waiting = this._waiters.get(result.id)
    if (!waiting?.length) return
    this._waiters.delete(result.id)
    for (const resolve of waiting) resolve(result)
  }

  private _publish(): void {
    this._hooks.onState?.(this._running, [...this._queue])
  }

  private _batch: Promise<string | undefined> | null = null
  private _disposed = false
  private _displays: Displays = new Map()
  private _hooks: RunnerHooks
  private _kernel: KernelClient
  private _queue: string[] = []
  private _running: string | null = null
  private _waiters = new Map<string, Array<(result: CellResult) => void>>()
  private _writer: NotebookWriter
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
  constructor(store: NotebookWriter, cellId: string, displays: Displays) {
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
  private _store: NotebookWriter
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
