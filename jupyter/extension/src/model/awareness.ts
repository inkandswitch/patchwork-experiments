type State = Record<string, any>;
type Transport = {
  broadcast(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
};
type ChangeEvent = { added: number[]; updated: number[]; removed: number[] };
type Listener = (event: ChangeEvent, origin: unknown) => void;
type Message =
  | { type: 'jupyter-awareness'; clientID: number; clock: number; state: State | null }
  | { type: 'jupyter-awareness-query' };

const HEARTBEAT = 10_000;
const TIMEOUT = 30_000;

/**
 * A y-protocols compatible awareness carried over Automerge ephemeral
 * messages instead of a Yjs provider.
 */
export class EphemeralAwareness {
  constructor(transport: Transport) {
    this._transport = transport;
    this._unsubscribe = transport.onMessage(message => this._receive(message as Message));
    this.states.set(this.clientID, {});
    this._send({ type: 'jupyter-awareness-query' });
    this._heartbeat = setInterval(() => this._tick(), HEARTBEAT);
  }

  readonly clientID = Math.floor(Math.random() * 0xffffffff);
  readonly states = new Map<number, State>();
  readonly meta = new Map<number, { clock: number; lastUpdated: number }>();
  readonly doc = null;

  getLocalState(): State | null {
    return this.states.get(this.clientID) ?? null;
  }

  setLocalState(state: State | null): void {
    const previous = this.states.get(this.clientID);
    if (state === null) {
      this.states.delete(this.clientID);
    } else {
      this.states.set(this.clientID, state);
    }
    this._clock++;
    this._broadcastLocal();
    const event: ChangeEvent = {
      added: !previous && state ? [this.clientID] : [],
      updated: previous && state ? [this.clientID] : [],
      removed: previous && !state ? [this.clientID] : []
    };
    this._emit(event, 'local');
  }

  setLocalStateField(field: string, value: unknown): void {
    const state = this.getLocalState();
    if (state) {
      this.setLocalState({ ...state, [field]: value });
    }
  }

  getStates(): Map<number, State> {
    return this.states;
  }

  on(event: 'change' | 'update', listener: Listener): void {
    this._listeners(event).add(listener);
  }

  off(event: 'change' | 'update', listener: Listener): void {
    this._listeners(event).delete(listener);
  }

  destroy(): void {
    if (this._destroyed) return;
    this._send({ type: 'jupyter-awareness', clientID: this.clientID, clock: this._clock + 1, state: null });
    this._destroyed = true;
    clearInterval(this._heartbeat);
    this._unsubscribe();
    this._handlers.clear();
  }

  private _receive(message: Message): void {
    if (this._destroyed || !message || typeof message !== 'object') return;
    if (message.type === 'jupyter-awareness-query') {
      this._broadcastLocal();
      return;
    }
    if (message.type !== 'jupyter-awareness' || message.clientID === this.clientID) return;
    const { clientID, clock, state } = message;
    const known = this.meta.get(clientID);
    if (known && known.clock > clock) return;
    const previous = this.states.get(clientID);
    this.meta.set(clientID, { clock, lastUpdated: Date.now() });
    if (state === null) {
      if (previous) {
        this.states.delete(clientID);
        this._emit({ added: [], updated: [], removed: [clientID] }, 'remote');
      }
      return;
    }
    this.states.set(clientID, state);
    this._emit(
      { added: previous ? [] : [clientID], updated: previous ? [clientID] : [], removed: [] },
      'remote'
    );
  }

  private _tick(): void {
    this._broadcastLocal();
    const now = Date.now();
    const removed: number[] = [];
    for (const [clientID, meta] of this.meta) {
      if (now - meta.lastUpdated > TIMEOUT && this.states.has(clientID)) {
        this.states.delete(clientID);
        this.meta.delete(clientID);
        removed.push(clientID);
      }
    }
    if (removed.length > 0) {
      this._emit({ added: [], updated: [], removed }, 'timeout');
    }
  }

  private _broadcastLocal(): void {
    this._send({
      type: 'jupyter-awareness',
      clientID: this.clientID,
      clock: this._clock,
      state: this.getLocalState()
    });
  }

  private _send(message: Message): void {
    if (this._destroyed) return;
    try {
      this._transport.broadcast(message);
    } catch {
      // Not connected yet: the next heartbeat retries.
    }
  }

  private _emit(event: ChangeEvent, origin: unknown): void {
    for (const listener of this._listeners('update')) listener(event, origin);
    if (event.added.length || event.updated.length || event.removed.length) {
      for (const listener of this._listeners('change')) listener(event, origin);
    }
  }

  private _listeners(event: string): Set<Listener> {
    let set = this._handlers.get(event);
    if (!set) {
      set = new Set();
      this._handlers.set(event, set);
    }
    return set;
  }

  private _clock = 0;
  private _destroyed = false;
  private _handlers = new Map<string, Set<Listener>>();
  private _heartbeat: ReturnType<typeof setInterval>;
  private _transport: Transport;
  private _unsubscribe: () => void;
}
