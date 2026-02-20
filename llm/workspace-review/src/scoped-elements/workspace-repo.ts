import {
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";

export interface WorkspaceOverlay {
  mappings?: Record<string, { cloneUrl: AutomergeUrl }>;
}

class WorkspaceDocHandle<T> {
  #clone: DocHandle<T>;
  #originalUrl: AutomergeUrl;

  constructor(cloneHandle: DocHandle<T>, originalUrl: AutomergeUrl) {
    this.#clone = cloneHandle;
    this.#originalUrl = originalUrl;
  }

  get url() { return this.#originalUrl; }
  get documentId() { return this.#clone.documentId; }
  get state() { return this.#clone.state; }
  isReady() { return this.#clone.isReady(); }
  isUnloaded() { return this.#clone.isUnloaded(); }
  isDeleted() { return this.#clone.isDeleted(); }
  isUnavailable() { return this.#clone.isUnavailable(); }
  inState(states: any) { return this.#clone.inState(states); }
  whenReady(states?: any, options?: any) { return this.#clone.whenReady(states, options); }
  doc() { return this.#clone.doc(); }
  docSync() { return (this.#clone as any).docSync(); }
  heads() { return this.#clone.heads(); }
  history() { return this.#clone.history(); }
  view(heads: any) { return this.#clone.view(heads); }
  diff(first: any, second?: any) { return this.#clone.diff(first, second); }
  change(callback: any, options?: any) { return this.#clone.change(callback, options); }
  changeAt(heads: any, callback: any, options?: any) { return this.#clone.changeAt(heads, callback, options); }
  isReadOnly() { return this.#clone.isReadOnly(); }
  merge(other: any) { return this.#clone.merge(other); }
  broadcast(message: any) { return this.#clone.broadcast(message); }
  metrics() { return this.#clone.metrics(); }
  on(event: any, cb: any) { return this.#clone.on(event, cb); }
  off(event: any, cb: any) { return this.#clone.off(event, cb); }
  emit(event: any, ...args: any[]) { return this.#clone.emit(event, ...args); }
  once(event: any, cb: any) { return this.#clone.once(event, cb); }
  addListener(event: any, cb: any) { return this.#clone.addListener(event, cb); }
  removeListener(event: any, cb: any) { return this.#clone.removeListener(event, cb); }
  removeAllListeners(event?: any) { return this.#clone.removeAllListeners(event); }
  listeners(event: any) { return this.#clone.listeners(event); }
  listenerCount(event: any) { return this.#clone.listenerCount(event); }
  eventNames() { return this.#clone.eventNames(); }
}

class WorkspaceRepo {
  #repo: Repo;
  #workspaceHandle: DocHandle<WorkspaceOverlay>;

  constructor(repo: Repo, workspaceHandle: DocHandle<WorkspaceOverlay>) {
    this.#repo = repo;
    this.#workspaceHandle = workspaceHandle;
  }

  get handles() { return this.#repo.handles; }
  get peers() { return this.#repo.peers; }
  get peerId() { return this.#repo.peerId; }
  get networkSubsystem() { return this.#repo.networkSubsystem; }
  get storageSubsystem() { return this.#repo.storageSubsystem; }
  get synchronizer() { return this.#repo.synchronizer; }
  get peerMetadataByPeerId() { return this.#repo.peerMetadataByPeerId; }
  get sharePolicy() { return this.#repo.sharePolicy; }
  set sharePolicy(p: any) { this.#repo.sharePolicy = p; }
  get shareConfig() { return this.#repo.shareConfig; }
  set shareConfig(c: any) { this.#repo.shareConfig = c; }

  getStorageIdOfPeer(peerId: any) { return this.#repo.getStorageIdOfPeer(peerId); }
  create<T>(initialValue?: T) { return this.#repo.create(initialValue); }
  create2<T>(initialValue?: T) { return this.#repo.create2(initialValue); }
  clone<T>(handle: DocHandle<T>) { return this.#repo.clone(handle); }
  delete(id: any) { return this.#repo.delete(id); }
  export(id: any) { return this.#repo.export(id); }
  import<T>(binary: Uint8Array, args?: any) { return this.#repo.import<T>(binary, args); }
  storageId() { return this.#repo.storageId(); }
  flush(documents?: any) { return this.#repo.flush(documents); }
  removeFromCache(documentId: any) { return this.#repo.removeFromCache(documentId); }
  shutdown() { return this.#repo.shutdown(); }
  metrics() { return this.#repo.metrics(); }
  shareConfigChanged() { return this.#repo.shareConfigChanged(); }
  subscribeToRemotes(remotes: any) { return this.#repo.subscribeToRemotes(remotes); }
  findWithProgress<T>(id: any, options?: any) { return this.#repo.findWithProgress<T>(id, options); }

  on(event: any, cb: any) { return this.#repo.on(event, cb); }
  off(event: any, cb: any) { return this.#repo.off(event, cb); }
  emit(event: any, ...args: any[]) { return this.#repo.emit(event, ...args); }
  once(event: any, cb: any) { return this.#repo.once(event, cb); }
  addListener(event: any, cb: any) { return this.#repo.addListener(event, cb); }
  removeListener(event: any, cb: any) { return this.#repo.removeListener(event, cb); }
  removeAllListeners(event?: any) { return this.#repo.removeAllListeners(event); }
  listeners(event: any) { return this.#repo.listeners(event); }
  listenerCount(event: any) { return this.#repo.listenerCount(event); }
  eventNames() { return this.#repo.eventNames(); }

  async find<T>(id: any, options?: any): Promise<DocHandle<T>> {
    const ws = this.#workspaceHandle.doc();
    const url = String(id) as AutomergeUrl;
    const mapping = ws?.mappings?.[url];
    if (mapping) {
      const cloneHandle = await this.#repo.find<T>(mapping.cloneUrl);
      return new WorkspaceDocHandle(cloneHandle, url) as unknown as DocHandle<T>;
    }
    return this.#repo.find<T>(id, options);
  }
}

export function createWorkspaceRepo(
  repo: Repo,
  workspaceHandle: DocHandle<WorkspaceOverlay>
): Repo {
  return new WorkspaceRepo(repo, workspaceHandle) as unknown as Repo;
}
