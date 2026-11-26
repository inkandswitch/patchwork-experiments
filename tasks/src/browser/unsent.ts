// What runs wrote, sent to the sync server when it can be reached.
//
// The page that hosts the pool saves what each linked run wrote before the
// run is reported (`PageLinks.keep`, link.ts). The site's Repo sends a
// document to the sync server only while it has it open, and it loads a
// stored document only when something asks for it: what a run wrote with no
// network is in the page's Repo, and survives a reload, but once the page
// that had it open has been reloaded or closed, nothing sends it.
//
// So, as the page saves what a run wrote, it lists those documents in a
// small list that survives a reload: the task system's own entry in this
// origin's localStorage, UNSENT_KEY, by document id. It lists them whether
// or not the server can be reached then (the simpler of the two, and the one
// that also covers a network lost, or a page reloaded, a moment after the
// save), and takes each off again once the server has reported heads equal
// to the page's: with the network, within moments. While a pool runs in
// this page (one page per browser profile, so one writer of the list),
// whenever the server can be reached (at the pool's start, when the Repo
// says it has connected, when the browser says it is online, and every
// PASS_MS while anything is listed), it finds each listed document in the
// site's Repo, which then syncs it, and takes it off the list once the
// server has its heads, or once it has been tried for TRY_MS while the
// server could be reached. Nothing waits on this: it is done in the
// background, and a run's report never depends on it.
//
// Whether the server can be reached is the Repo's word
// (`connectedSubductionPeerIds`), or, for a Repo that cannot say, the
// browser's (`navigator.onLine`). Whether the server has a document is the
// Repo's 'subduction-remote-heads' event; with a Repo that has none, each
// listed document is kept open for TRY_MS of trying, and then let go.

/** This origin's localStorage entry for the list: `{ [documentId]: { since?: ms } }`, `since` when it was first tried with the server reachable. */
export const UNSENT_KEY = 'patchwork-tasks-unsent';
/** How often the list is looked at while anything is on it. */
export const PASS_MS = 10_000;
/** How long a document is tried for while the server can be reached before it is let go. */
export const TRY_MS = 10 * 60_000;
/** The most documents listed; the oldest are let go first. */
export const MAX_UNSENT = 200;
/** How many documents' latest reports are kept. */
const REPORTS_KEPT = 1000;

type Listed = Record<string, { since?: number }>;

/** What the list needs of the site's Repo; every member but `handles` and `find` is optional. */
export interface UnsentRepo {
  handles: Record<string, { heads(): readonly unknown[] } | undefined>;
  find(url: string): Promise<unknown>;
  on?(event: string, listener: (event: any) => void): unknown;
  off?(event: string, listener: (event: any) => void): unknown;
  connectedSubductionPeerIds?(): Promise<string[]>;
  resyncSubduction?(documentId: string): void;
}

/** Where the list is kept: localStorage, by default. */
export interface UnsentStore {
  read(): string | null;
  write(value: string | null): void;
}

const localStore: UnsentStore = {
  read: () => {
    try {
      return localStorage.getItem(UNSENT_KEY);
    } catch {
      return null;
    }
  },
  write: (value) => {
    try {
      if (value === null) {
        localStorage.removeItem(UNSENT_KEY);
      } else {
        localStorage.setItem(UNSENT_KEY, value);
      }
    } catch {
      // a browser that keeps nothing keeps no list: what the page has open still syncs
    }
  },
};

const headsKey = (heads: readonly unknown[]) => [...heads].map(String).sort().join(',');

/** The list as kept, or an empty one where it cannot be read. */
export function readUnsent(store: UnsentStore = localStore): Listed {
  try {
    const value = JSON.parse(store.read() ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeUnsent(listed: Listed, store: UnsentStore) {
  const ids = Object.keys(listed);
  if (ids.length === 0) {
    store.write(null);
    return;
  }
  // the newest kept, as they were added
  const kept = Object.fromEntries(ids.slice(-MAX_UNSENT).map((id) => [id, listed[id]]));
  store.write(JSON.stringify(kept));
}

/** Whether the site's Repo can reach the sync server now. */
async function reachable(repo: UnsentRepo): Promise<boolean> {
  if (typeof repo.connectedSubductionPeerIds === 'function') {
    const peers = await repo.connectedSubductionPeerIds().catch(() => [] as string[]);
    return peers.length > 0;
  }
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * The list, for one page's site Repo. `remember` adds documents; `start`
 * sends what is listed, in the background, until the returned function is
 * called.
 */
export class Unsent {
  /** The heads the server last reported, by document id, for the latest REPORTS_KEPT documents it reported: a report can come before its document is listed. */
  private readonly reports = new Map<string, string>();
  /** The listed documents this page has asked its Repo for. */
  private readonly asked = new Set<string>();
  private running = false;
  private passing: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly repo: UnsentRepo,
    private readonly store: UnsentStore = localStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Lists `documents`, at once, so that they are sent to the server when it can be reached; looks at the list in the background. */
  remember(documents: readonly string[]) {
    if (documents.length === 0) {
      return;
    }
    const listed = readUnsent(this.store);
    for (const id of documents) {
      // listed again at the end, as the newest
      const entry = listed[id] ?? {};
      delete listed[id];
      listed[id] = entry;
    }
    writeUnsent(listed, this.store);
    void this.pass();
  }

  /** Sends what is listed, now and whenever the server may have become reachable, until the returned function is called. */
  start(): () => void {
    this.running = true;
    const report = ({ documentId, heads }: { documentId?: unknown; heads?: unknown }) => {
      if (typeof documentId !== 'string' || !Array.isArray(heads)) {
        return;
      }
      this.reports.delete(documentId);
      this.reports.set(documentId, headsKey(heads));
      if (this.reports.size > REPORTS_KEPT) {
        this.reports.delete(this.reports.keys().next().value!);
      }
      if (documentId in readUnsent(this.store)) {
        void this.pass();
      }
    };
    const connected = ({ connected }: { connected?: unknown }) => connected && this.pass();
    const online = () => this.pass();
    this.repo.on?.('subduction-remote-heads', report);
    this.repo.on?.('subduction-connection', connected);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', online);
    }
    const timer = setInterval(() => {
      if (Object.keys(readUnsent(this.store)).length > 0) {
        this.pass();
      }
    }, PASS_MS);
    this.pass();
    return () => {
      this.running = false;
      clearInterval(timer);
      this.repo.off?.('subduction-remote-heads', report);
      this.repo.off?.('subduction-connection', connected);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', online);
      }
    };
  }

  /** Looks at the list once (one look at a time, and one more if asked meanwhile). */
  pass(): Promise<void> {
    if (!this.running) {
      return Promise.resolve();
    }
    if (this.passing) {
      this.again = true;
      return this.passing;
    }
    this.passing = this.look()
      .catch((error) => console.warn(`tasks: what tasks wrote could not be sent to the sync server now: ${(error as Error)?.message ?? error}`))
      .finally(() => {
        this.passing = null;
        if (this.again) {
          this.again = false;
          void this.pass();
        }
      });
    return this.passing;
  }

  private async look() {
    if (Object.keys(readUnsent(this.store)).length === 0 || !(await reachable(this.repo))) {
      return;
    }
    // read again after the wait: only this page writes the list, but `remember` may have meanwhile
    const listed = readUnsent(this.store);
    const now = this.now();
    for (const [id, entry] of Object.entries(listed)) {
      if (this.sent(id)) {
        this.forget(listed, id);
        continue;
      }
      entry.since ??= now;
      if (now - entry.since >= TRY_MS) {
        console.warn(`tasks: a document a task wrote (${id.slice(0, 6)}…) was not seen at the sync server after ${TRY_MS / 60_000} minutes of trying; it stays in this browser, and is sent when something opens it`);
        this.forget(listed, id);
        continue;
      }
      if (!this.asked.has(id)) {
        // Opened in the site's Repo, which then syncs it with the server. Not
        // waited on: one that is never found costs nothing but its entry.
        this.asked.add(id);
        this.repo.find(`automerge:${id}`).then(
          () => this.pass(),
          () => this.asked.delete(id),
        );
      } else {
        this.repo.resyncSubduction?.(id);
      }
    }
    writeUnsent(listed, this.store);
  }

  private forget(listed: Listed, id: string) {
    delete listed[id];
    this.asked.delete(id);
  }

  /** Whether the server has reported heads equal to the site's Repo's for `id`. */
  private sent(id: string): boolean {
    const reported = this.reports.get(id);
    if (reported === undefined) {
      return false;
    }
    try {
      const heads = this.repo.handles[id]?.heads();
      return !!heads && heads.length > 0 && reported === headsKey(heads);
    } catch {
      return false;
    }
  }
}
