import type { KernelMessage } from "@jupyterlab/services"

export type KernelStatus = "starting" | "idle" | "busy" | "dead"

/**
 * What the notebook needs from a kernel. Messages are Jupyter's, so a client
 * for a remote jupyter server can implement this over @jupyterlab/services'
 * KernelConnection as well.
 */
export interface KernelClient {
  readonly status: KernelStatus
  /** Called whenever `status` changes; returns an unsubscribe function. */
  onStatus(listener: (status: KernelStatus) => void): () => void
  /** Resolves with the reply once the kernel is done; IOPub messages for this request arrive meanwhile. */
  execute(
    code: string,
    onIOPub: (message: KernelMessage.IIOPubMessage) => void,
  ): Promise<KernelMessage.IExecuteReplyMsg["content"]>
  complete(code: string, cursor: number): Promise<KernelMessage.ICompleteReplyMsg["content"]>
  inspect(code: string, cursor: number): Promise<KernelMessage.IInspectReplyMsg["content"]>
  /** Throws the current kernel away and starts a fresh one. */
  restart(): Promise<void>
  dispose(): void
}
