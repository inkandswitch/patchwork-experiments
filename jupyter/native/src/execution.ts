import { type Accessor, createSignal } from "solid-js"
import { CellRunner, type RunOutcome, type RunnerHooks } from "../../shared/cells"
import type { NotebookStore } from "./doc"
import type { KernelClient } from "./kernel/types"

export { removeOverwrittenChars } from "../../shared/cells"

/**
 * This tab's cell runner (shared/cells.ts) as signals. Which cells are
 * queued or running is this tab's alone, not the document's.
 */
export class Executor {
  readonly running: Accessor<string | null>
  readonly queued: Accessor<ReadonlySet<string>>

  constructor(store: NotebookStore, kernel: KernelClient, hooks: Omit<RunnerHooks, "onState"> = {}) {
    const [running, setRunning] = createSignal<string | null>(null)
    const [queued, setQueued] = createSignal<ReadonlySet<string>>(new Set(), { equals: false })
    this.running = running
    this.queued = queued
    this._runner = new CellRunner(store, kernel, {
      ...hooks,
      onState: (now, waiting) => {
        setRunning(now)
        setQueued(new Set(waiting))
      },
    })
  }

  run(ids: string[]): Promise<RunOutcome> {
    return this._runner.run(ids)
  }

  /** Forgets the queue; the kernel restart that usually follows stops the running cell. */
  cancel(): void {
    this._runner.cancel()
  }

  dispose(): void {
    this._runner.dispose()
  }

  private _runner: CellRunner
}
