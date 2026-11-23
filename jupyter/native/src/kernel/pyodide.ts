import { KernelMessage } from "@jupyterlab/services"
// The kernel module itself: the package index also re-exports the prebuilt workers.
import { PyodideKernel } from "@jupyterlite/pyodide-kernel/lib/kernel"
import type { KernelClient, KernelStatus } from "./types"

export type PyodideKernelOptions = {
  /** Pyodide's ES module entry, `pyodide.mjs`, next to its lock file and packages. */
  pyodideUrl: string
  /** Silent code to run once the kernel is up, before anything else. */
  bootstrap?: string
}

type Pending = {
  onIOPub?: (message: KernelMessage.IIOPubMessage) => void
  resolve(content: any): void
  reject(error: unknown): void
}

/**
 * JupyterLite's Pyodide kernel without the JupyterLite app: it runs in a
 * worker and speaks Jupyter messages through `handleMessage` and
 * `sendMessage`. It handles one message at a time, so requests are queued.
 */
export class PyodideKernelClient implements KernelClient {
  constructor(options: PyodideKernelOptions) {
    this._options = options
    this._start()
  }

  get status(): KernelStatus {
    return this._status
  }

  get generation(): number {
    return this._generation
  }

  onStatus(listener: (status: KernelStatus) => void): () => void {
    this._statusListeners.add(listener)
    return () => this._statusListeners.delete(listener)
  }

  execute(code: string, onIOPub: (message: KernelMessage.IIOPubMessage) => void) {
    return this._request<"execute_request", KernelMessage.IExecuteReplyMsg["content"]>(
      "execute_request",
      { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false, stop_on_error: true },
      onIOPub,
    )
  }

  executeSilent(code: string) {
    return this._request<"execute_request", KernelMessage.IExecuteReplyMsg["content"]>("execute_request", {
      code,
      silent: true,
      store_history: false,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true,
    })
  }

  complete(code: string, cursor: number) {
    return this._request<"complete_request", KernelMessage.ICompleteReplyMsg["content"]>("complete_request", {
      code,
      cursor_pos: cursor,
    })
  }

  inspect(code: string, cursor: number) {
    return this._request<"inspect_request", KernelMessage.IInspectReplyMsg["content"]>("inspect_request", {
      code,
      cursor_pos: cursor,
      detail_level: 0,
    })
  }

  async restart(): Promise<void> {
    this._stop("restarted")
    this._start()
    await this._ready
  }

  dispose(): void {
    this._stop("disposed")
    this._statusListeners.clear()
  }

  private _start(): void {
    this._generation++
    this._setStatus("starting")
    const kernel = new PyodideKernel({
      id: crypto.randomUUID(),
      name: "python",
      location: "",
      sendMessage: message => this._onMessage(kernel, message),
      pyodideUrl: this._options.pyodideUrl,
      pipliteUrls: [],
      disablePyPIFallback: true,
      mountDrive: false,
      loadPyodideOptions: {} as PyodideKernel.IOptions["loadPyodideOptions"],
      contentsManager: undefined as unknown as PyodideKernel.IOptions["contentsManager"],
      logger: ({ payload }) => {
        if (payload.type === "text" && payload.level === "critical") console.error("[jupyter] kernel:", payload.data)
      },
    })
    this._kernel = kernel
    this._queue = Promise.resolve()
    this._ready = kernel.ready.then(async () => {
      if (this._kernel !== kernel) return
      if (this._options.bootstrap) await this._bootstrap(this._options.bootstrap)
      if (this._kernel === kernel) this._setStatus("idle")
    })
    this._ready.catch(error => {
      if (this._kernel !== kernel) return
      console.error("[jupyter] the Pyodide kernel didn't start", error)
      this._setStatus("dead")
    })
  }

  private async _bootstrap(code: string): Promise<void> {
    const reply = await this._send<KernelMessage.IExecuteReplyMsg["content"]>("execute_request", {
      code,
      silent: true,
      store_history: false,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true,
    })
    if (reply.status === "error") console.warn(`[jupyter] couldn't connect the kernel to Patchwork: ${reply.ename}: ${reply.evalue}`)
  }

  private _stop(reason: string): void {
    const kernel = this._kernel
    this._kernel = null
    for (const pending of this._pending.values()) pending.reject(new Error(`The kernel was ${reason}`))
    this._pending.clear()
    kernel?.dispose()
    this._setStatus("dead")
  }

  /** Waits for the kernel (and its bootstrap) before sending. */
  private async _request<T extends KernelMessage.ShellMessageType, R>(
    msgType: T,
    content: any,
    onIOPub?: (message: KernelMessage.IIOPubMessage) => void,
  ): Promise<R> {
    await this._ready
    return this._send<R>(msgType, content, onIOPub)
  }

  private _send<R>(
    msgType: KernelMessage.ShellMessageType,
    content: any,
    onIOPub?: (message: KernelMessage.IIOPubMessage) => void,
  ): Promise<R> {
    const kernel = this._kernel
    if (!kernel) return Promise.reject(new Error("The kernel isn't running"))
    const message = KernelMessage.createMessage({ channel: "shell", msgType, session: this._session, content } as any)
    return new Promise<R>((resolve, reject) => {
      this._pending.set(message.header.msg_id, { onIOPub, resolve, reject })
      this._queue = this._queue.then(() => (this._kernel === kernel ? kernel.handleMessage(message) : undefined)).catch(error => {
        const pending = this._pending.get(message.header.msg_id)
        this._pending.delete(message.header.msg_id)
        pending?.reject(error)
      })
    })
  }

  private _onMessage(kernel: PyodideKernel, message: KernelMessage.IMessage): void {
    if (this._kernel !== kernel) return
    const parentId = (message.parent_header as Partial<KernelMessage.IHeader>)?.msg_id
    const pending = parentId ? this._pending.get(parentId) : undefined
    if (message.channel === "iopub") {
      if (message.header.msg_type === "status") {
        const state = (message.content as KernelMessage.IStatusMsg["content"]).execution_state
        if (this._status !== "starting" && (state === "busy" || state === "idle")) this._setStatus(state)
        return
      }
      pending?.onIOPub?.(message as KernelMessage.IIOPubMessage)
    } else if (message.channel === "shell" && pending) {
      this._pending.delete(parentId!)
      pending.resolve(message.content)
    }
  }

  private _setStatus(status: KernelStatus): void {
    if (status === this._status) return
    this._status = status
    for (const listener of this._statusListeners) listener(status)
  }

  private _generation = 0
  private _kernel: PyodideKernel | null = null
  private _options: PyodideKernelOptions
  private _pending = new Map<string, Pending>()
  private _queue: Promise<unknown> = Promise.resolve()
  private _ready: Promise<void> = Promise.resolve()
  private _session = crypto.randomUUID()
  private _status: KernelStatus = "starting"
  private _statusListeners = new Set<(status: KernelStatus) => void>()
}
