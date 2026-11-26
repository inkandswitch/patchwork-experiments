// The local link: a MessagePort between the site's Repo, in the page that
// holds this browser's pool, and the Repo of each worker below it (the
// pool's, and each run worker's), carrying the Repo's own messages and
// nothing else. With it, what a page asks through the site's Repo reaches the
// pool, and what a task writes reaches the page, with no network: without
// it, the site's Repo and the task system's Repos (other databases, and a
// keyhive Repo keeps its commits under another storage prefix) meet only at
// the sync server (notes/LINK.md).
//
// The page's end of each link is a MessageChannel network adapter, the one
// the site's import map names, added to the site's Repo with
// `networkSubsystem.addNetworkAdapter`, as Patchwork's core adds its public
// reader (bootloader public-pair.ts). The worker's end is the same adapter in
// the worker's Repo (webworker-lib.ts). Classic sync runs over it beside
// Subduction, and the site's link to the sync server goes on as before.
//
// The page's end is gated (`LinkGate`). A worker runs strangers' code, and
// the site's Repo would otherwise offer it every document the page has open
// and give it any document whose id it knows: the link would be a way round
// keyhive. So the page gives over a link no more than the sync server would
// give a Repo of no one's: only documents keyhive leaves unprotected, and of
// those only the ones the worker has named first.
//
// What a worker names: a document is named once a `request` or a `sync`
// message for it comes from the worker, which its Repo sends for a document
// it asks for (`find`), and for one it has, made or found, as it announces
// it. Nothing else names one. A name lasts as long as the link.
//
// The gate reads the `type` and `documentId` of each message, both ways:
//
// - From the worker: `request` and `sync` for an unprotected document name it
//   and pass; for a protected one they are dropped, and the worker is told,
//   as a Repo says it, that the page does not have it (`doc-unavailable`).
//   `ephemeral`, `doc-unavailable` and `remote-heads-changed` pass for a
//   named document and are dropped for any other. A `request`, `sync` or
//   `ephemeral` that would pass, but whose data the page's Repo could not
//   read (it decodes a sync message, and an ephemeral one's CBOR, as the
//   gate does first), names nothing and ends the link
//   from the page's side, as the worker's leave would: no worker of the task
//   system's own sends one, and each the Repo were handed would cost the page
//   a logged error, without bound.
// - To the worker: the same five types pass for a named document. A
//   `request` for any other is dropped, and the page's Repo is told that the
//   worker does not have it, so that its find does not wait on the worker.
//   Anything else for a document not named is dropped.
// - Every other message (one that names no document, such as
//   `remote-subscription-change`, or Subduction's own) is dropped both ways.
//
// Before any of that, the gate reads what arrives on the page's port, ahead
// of the adapter, which does not see what it drops (`LinkGate.fromPort`).
// The page names each link's one peer: for every link it makes or is
// handed, it chooses a fresh random peer id (`PageLinks`), and that link's
// worker's Repo is made with exactly that id (the pool's worker's from
// 'start', a run worker's from its settings, both set by the task system's
// own code before any task's code is loaded). The page's end admits only that
// peer, and from it, in this order: its first word (an `arrive` addressed to
// no one, or a `welcome` addressed to the page), once; then any message
// addressed to the page; then at most one `leave` addressed to no one, after
// which nothing. Everything else is dropped. So whatever order things happen
// in, a worker's code can speak on its link only as its own worker, and is
// taken for a new peer once: each arrive or welcome a Repo hears makes it
// offer the peer every document it has open, so one admitted again and again
// would cost the page that much each time. (The two Repos each say `arrive`
// as they connect and answer the other's with a `welcome`, so the page hears
// both, and takes the first.) A Repo sends its messages for a
// peer through the adapter that last announced that peer, and forgets a peer
// whose adapter says it left; without the named peer, a worker's code that
// knew another peer's id (the pool's, which the page's relayed ephemeral
// messages carry) could take the page's messages for that peer, or have the
// page forget it, and could make the adapter throw in the page with a
// message addressed to another peer.
//
// What a dropped message costs. The page's Repo sends a `sync` to a new peer
// for each document it has open (its announce), and the gate drops those for
// documents the worker has not named. A first sync message between two
// peers carries no changes, only heads and what each has (Automerge sends
// changes only once the other side has said what it has), and the page sends
// no other until the worker answers for that document, which names it. So
// what is dropped never carries a change, and the page's sync state with the
// worker for a document it named is the same as if nothing had been dropped.
//
// A link ends when its worker does (PageLinks.remove): the adapter is taken
// out of the site's Repo, which then forgets the worker as a peer.
//
// Kept before reported. A run's ending is said once the page's Repo has
// what the run wrote (run-worker.ts), and the pool reports it only once the
// page has also saved it (`PageLinks.keep`, asked through the pool's worker;
// executor.ts): a page reloaded the moment the run is reported has it, with
// no network too. The page saves only documents that run's link carried.
// What it saves it also lists until the sync server has it, so that what
// was written with no network is sent when the server can be reached again,
// a reload between (unsent.ts).

import { decodeSyncMessage } from '@automerge/automerge/slim';
import { cbor, parseAutomergeUrl, type AutomergeUrl } from '@automerge/automerge-repo/slim';

/** What the gate does with a message: passes it, drops it, drops it and answers that the document is not there, or drops it and ends the link. */
export type Verdict = 'pass' | 'drop' | 'refuse' | 'end';

/** The messages that are about one document, and the only ones a link carries. */
const ABOUT_A_DOCUMENT = new Set(['request', 'sync', 'ephemeral', 'doc-unavailable', 'remote-heads-changed']);

/** The messages by which a worker names a document. */
const NAMING = new Set(['request', 'sync']);

/**
 * Whether keyhive leaves a document of this binary id unprotected: an id
 * shorter than 32 bytes, or 32 bytes whose last 16 are all zero. The same
 * rule as `isUnprotectedDocId` in @automerge/automerge-repo-keyhive.
 */
export function isUnprotectedDocId(bytes: Uint8Array): boolean {
  if (bytes.length < 32) {
    return true;
  }
  for (let i = 16; i < 32; i++) {
    if (bytes[i] !== 0) {
      return false;
    }
  }
  return true;
}

/** Whether `documentId` (as a Repo's messages carry it) names a document keyhive leaves unprotected; false for anything that is not a document id. */
export function unprotected(documentId: string): boolean {
  try {
    return isUnprotectedDocId(parseAutomergeUrl(`automerge:${documentId}` as AutomergeUrl).binaryDocumentId);
  } catch {
    return false;
  }
}

interface AboutADocument {
  type?: unknown;
  documentId?: unknown;
  data?: unknown;
}

/** Whether the page's Repo can read the data of a message of `type` (as the adapter emits it): a sync message, or an ephemeral message's CBOR. */
function readable(type: string, data: unknown): boolean {
  if (type !== 'request' && type !== 'sync' && type !== 'ephemeral') {
    return true;
  }
  if (!(data instanceof Uint8Array)) {
    return false;
  }
  try {
    if (type === 'ephemeral') {
      cbor.decode(data);
    } else {
      decodeSyncMessage(data);
    }
    return true;
  } catch {
    return false;
  }
}

/** One link's gate, on the page's end (see the header). */
export class LinkGate {
  /** The documents the worker has named, each unprotected. */
  readonly named = new Set<string>();

  /** Where the link is: waiting for its peer's first word, open, or over (it left, or the page ended it). */
  private state: 'waiting' | 'open' | 'over' = 'waiting';

  /** `peer`: the link's one peer, the id the page chose for its worker's Repo. */
  constructor(readonly peer: string) {}

  /** Whether the link is over: nothing more from its worker is admitted. */
  get over() {
    return this.state === 'over';
  }

  /** Ends the link from the page's side: nothing more from its worker is admitted. */
  end() {
    this.state = 'over';
  }

  /** Whether the adapter may read `message`, as it arrived on the page's port; `self` is the page's peer id. */
  fromPort(message: unknown, self: unknown): boolean {
    if (this.state === 'over' || typeof message !== 'object' || message === null) {
      return false;
    }
    const { type, senderId, targetId } = message as { type?: unknown; senderId?: unknown; targetId?: unknown };
    if (senderId !== this.peer) {
      return false;
    }
    const toNoOne = !('targetId' in message);
    const toPage = typeof self === 'string' && targetId === self;
    if (type === 'arrive' || type === 'welcome') {
      // its first word, once
      if (this.state !== 'waiting' || !(type === 'arrive' ? toNoOne : toPage)) {
        return false;
      }
      this.state = 'open';
      return true;
    }
    if (this.state !== 'open') {
      return false;
    }
    if (type === 'leave') {
      if (!toNoOne) {
        return false;
      }
      this.state = 'over';
      return true;
    }
    return toPage;
  }

  /** What to do with a message from the worker to the page. */
  fromWorker(message: AboutADocument | null | undefined): Verdict {
    const type = String(message?.type);
    const id = message?.documentId;
    if (!ABOUT_A_DOCUMENT.has(type) || typeof id !== 'string') {
      return 'drop';
    }
    const passing = this.named.has(id) || (NAMING.has(type) && unprotected(id));
    if (!passing) {
      return NAMING.has(type) ? 'refuse' : 'drop';
    }
    if (!readable(type, message?.data)) {
      return 'end';
    }
    this.named.add(id);
    return 'pass';
  }

  /** What to do with a message from the page to the worker. */
  toWorker(message: AboutADocument | null | undefined): Verdict {
    const type = String(message?.type);
    const id = message?.documentId;
    if (!ABOUT_A_DOCUMENT.has(type) || typeof id !== 'string') {
      return 'drop';
    }
    if (this.named.has(id)) {
      return 'pass';
    }
    return type === 'request' ? 'refuse' : 'drop';
  }
}

/** A Repo message, as an adapter sends and emits it. */
interface RepoMessage {
  type: string;
  senderId: string;
  targetId: string;
  documentId?: string;
}

/** What the page needs of the MessageChannel network adapter's class. */
export interface PortAdapter {
  peerId?: string;
  send(message: RepoMessage): void;
  emit(event: string, ...args: unknown[]): boolean;
  disconnect(): void;
}
export type PortAdapterClass = new (port: MessagePort) => PortAdapter;
/** The page's end of a link: an adapter gated for the one peer `peer`. */
export type GatedAdapterClass = new (port: MessagePort, peer: string) => PortAdapter & { gate: LinkGate };

/**
 * `port` as the adapter is given it: the same port, but a 'message' listener
 * added to it hears only what `admit` lets through.
 */
function admittingPort(port: MessagePort, admit: (data: unknown) => boolean): MessagePort {
  const wrapped = new WeakMap<object, EventListener>();
  const wrap = (listener: EventListenerOrEventListenerObject) => {
    let gated = wrapped.get(listener);
    if (!gated) {
      gated = (event: Event) => {
        if (admit((event as MessageEvent).data)) {
          typeof listener === 'function' ? listener.call(port, event) : listener.handleEvent(event);
        }
      };
      wrapped.set(listener, gated);
    }
    return gated;
  };
  return new Proxy(port, {
    get(target, key) {
      if (key === 'addEventListener' || key === 'removeEventListener') {
        return (type: string, listener: EventListenerOrEventListenerObject | null, options?: unknown) =>
          target[key](type, (type === 'message' && listener ? wrap(listener) : listener) as EventListener, options as never);
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * The class of the page's end of a link: the MessageChannel network adapter
 * with a `LinkGate` for the link's one peer between it and the Repo. What arrives on the port reaches
 * the adapter only as `fromPort` admits it (the handshake included); what the
 * Repo sends goes through `send`; what comes from the worker reaches the
 * Repo as a 'message' event.
 */
export function gatedAdapterClass(Adapter: PortAdapterClass): GatedAdapterClass {
  return class GatedPortAdapter extends Adapter {
    readonly gate: LinkGate;

    constructor(port: MessagePort, peer: string) {
      const gate = new LinkGate(peer);
      // the page's peer id is read as each message arrives: the Repo gives it the adapter as it connects
      let adapter: PortAdapter | undefined;
      super(admittingPort(port, (data) => gate.fromPort(data, adapter?.peerId)));
      this.gate = gate;
      adapter = this;
    }

    send(message: RepoMessage) {
      const verdict = this.gate.toWorker(message);
      if (verdict === 'pass') {
        super.send(message);
      } else if (verdict === 'refuse') {
        // Said after this send returns, as an answer from the worker would be.
        queueMicrotask(() =>
          super.emit('message', {
            type: 'doc-unavailable',
            senderId: message.targetId,
            targetId: message.senderId,
            documentId: message.documentId,
          }),
        );
      }
    }

    emit(event: string, ...args: unknown[]): boolean {
      if (event !== 'message') {
        return super.emit(event, ...args);
      }
      const message = args[0] as RepoMessage;
      const verdict = this.gate.fromWorker(message);
      if (verdict === 'end') {
        // as its leave would: the page forgets the worker, and the adapter leaves the Repo
        this.gate.end();
        console.warn(`tasks: the page ended its link to a worker, which sent a ${message.type} message the page could not read`);
        super.emit('peer-disconnected', { peerId: this.gate.peer });
        super.emit('close');
      } else if (verdict === 'refuse') {
        super.send({ type: 'doc-unavailable', senderId: String(this.peerId), targetId: message.senderId, documentId: message.documentId });
      }
      return verdict === 'pass' ? super.emit(event, ...args) : false;
    }
  };
}

let loading: Promise<GatedAdapterClass | null> | null = null;

/** The longest the page waits for the adapter's module before starting its pool with no link. */
const LOAD_MS = 10_000;

/**
 * The gated adapter's class, made from the MessageChannel network adapter the
 * page's import map names; null, said in the console once, where it cannot
 * be loaded within LOAD_MS (the pool then runs with no link, as before there
 * was one).
 */
export function linkAdapterClass(): Promise<GatedAdapterClass | null> {
  loading ??= new Promise<GatedAdapterClass | null>((resolve) => {
    const none = (why: string) => {
      console.warn(`tasks: no local link between this page and its pool: the MessageChannel network adapter ${why}`);
      resolve(null);
    };
    const timer = setTimeout(() => none(`did not load in ${LOAD_MS / 1000} s`), LOAD_MS);
    import('@automerge/automerge-repo-network-messagechannel').then(
      ({ MessageChannelNetworkAdapter }) => {
        clearTimeout(timer);
        resolve(gatedAdapterClass(MessageChannelNetworkAdapter as unknown as PortAdapterClass));
      },
      (error) => {
        clearTimeout(timer);
        none(`could not be loaded (${(error as Error)?.message ?? error})`);
      },
    );
  });
  return loading;
}

/** The part of a Repo a link is added to. */
export interface LinkableRepo {
  networkSubsystem: {
    addNetworkAdapter(adapter: never): void;
    removeNetworkAdapter(adapter: never): void;
  };
  flush(documents?: never[]): Promise<void>;
}

/** A peer id for a link's worker: fresh and random, so no other peer of the page's Repo has it. */
const newPeer = () => `task-link-${crypto.randomUUID()}`;

/**
 * The links of one pool's worker to the site's Repo, by name: the pool's own
 * and one per run worker. Each is added to the Repo when opened and taken out
 * when removed; `removeAll` ends them all, when the pool's worker ends. The
 * page names each link's peer (see the header): `open` and `add` choose it,
 * and the worker at the other end must make its Repo with it.
 */
export class PageLinks {
  private readonly links = new Map<string, { adapter: PortAdapter & { gate: LinkGate }; port: MessagePort }>();

  constructor(
    private readonly repo: LinkableRepo,
    private readonly Adapter: GatedAdapterClass,
  ) {}

  /** A new link named `name`, its page end in the Repo: returns the worker's end, to be handed down, and the peer id its worker's Repo must have. */
  open(name: string): { port: MessagePort; peer: string } {
    const { port1, port2 } = new MessageChannel();
    return { port: port2, peer: this.add(name, port1) };
  }

  /** Adds `port`, the page's end of a link a worker made, to the Repo, as `name` (ending any link of that name first): returns the peer id its worker's Repo must have. */
  add(name: string, port: MessagePort): string {
    this.remove(name);
    const peer = newPeer();
    const adapter = new this.Adapter(port, peer);
    this.links.set(name, { adapter, port });
    this.repo.networkSubsystem.addNetworkAdapter(adapter as never);
    return peer;
  }

  /**
   * Saves, in the Repo, those of `documents` that the link named `name`
   * carried (the ones its worker named): what a run wrote, before the run is
   * reported. Resolves to those it saved; rejects when there is no such
   * link. Not bounded here: whoever waits on it bounds the wait.
   */
  keep(name: string, documents: readonly unknown[]): Promise<string[]> {
    const link = this.links.get(name);
    if (!link) {
      return Promise.reject(new Error('its link to the page had ended'));
    }
    const carried = [...new Set(documents)].filter((id): id is string => typeof id === 'string' && link.adapter.gate.named.has(id));
    return carried.length > 0 ? this.repo.flush(carried as never[]).then(() => carried) : Promise.resolve(carried);
  }

  /** Ends the link named `name`, if there is one: its adapter leaves the Repo, which forgets its worker as a peer. */
  remove(name: string) {
    const link = this.links.get(name);
    if (!link) {
      return;
    }
    this.links.delete(name);
    try {
      this.repo.networkSubsystem.removeNetworkAdapter(link.adapter as never);
    } catch (error) {
      console.warn(`tasks: a link to a worker could not be taken out of the page's Repo: ${(error as Error)?.message ?? error}`);
    }
    link.port.close();
  }

  removeAll() {
    for (const name of [...this.links.keys()]) {
      this.remove(name);
    }
  }

  /** How many links are open. */
  get size() {
    return this.links.size;
  }
}
