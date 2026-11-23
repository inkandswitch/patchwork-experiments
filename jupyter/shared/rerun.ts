/**
 * Rerunning a notebook when what its last run read changes, for a notebook
 * someone has open. Every change to a document the run read pokes it; it
 * waits until those documents have been quiet for `quietMs` (so it doesn't
 * run while someone is typing in the register), then asks `check` whether
 * to run (the setting is on, nothing is running, and the run is stale) and,
 * if so, runs. A quiet period that ends while it is checking or running
 * starts another once that is done, so no change is left unchecked. Timers are injectable for tests.
 */

export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }

export const QUIET_MS = 3000

export class AutoRerun {
  constructor(options: { check(): Promise<boolean> | boolean; run(): Promise<unknown> | void; quietMs?: number; timers?: Timers }) {
    this._options = options
    this._timers = options.timers ?? realTimers
  }

  /** Something the run read changed: start (or restart) the quiet period. */
  poke(): void {
    if (this._disposed) return
    if (this._timer !== undefined) this._timers.clear(this._timer)
    this._timer = this._timers.set(() => void this._fire(), this._options.quietMs ?? QUIET_MS)
  }

  dispose(): void {
    this._disposed = true
    if (this._timer !== undefined) this._timers.clear(this._timer)
    this._timer = undefined
  }

  private async _fire(): Promise<void> {
    this._timer = undefined
    if (this._disposed) return
    if (this._busy) return void (this._again = true)
    this._busy = true
    try {
      if (await this._options.check()) await this._options.run()
    } finally {
      this._busy = false
      if (this._again) {
        this._again = false
        this.poke()
      }
    }
  }

  private _again = false
  private _busy = false
  private _disposed = false
  private _options: { check(): Promise<boolean> | boolean; run(): Promise<unknown> | void; quietMs?: number }
  private _timer: unknown = undefined
  private _timers: Timers
}
