// A Host whose engine runs in a worker. The page keeps the surface (frame,
// sit, stand, pause, resume, picture, output, status, stats) and the things
// only it has: this peer's input, the clock if the page keeps one, and the
// repo. The worker (serve.js) runs the Host, engine and timeline, and has an
// automerge-repo of its own, whose one peer is the page's repo over a
// MessageChannel, as Patchwork's tab repo has its shared worker for a peer.
// So the host moves whole and unchanged: the documents reach it by sync, and
// its ephemeral messages go out through the page's repo, which relays them
// like any peer's.
//
// The page never waits for the worker. frame() sends a request unless one is
// still out, and the answer brings the state, the pictures asked for (their
// pixels transferred, not copied), and the output since the last one. So
// what the page shows is at most one worker frame old, and a worker busy
// catching up costs the page nothing.
//
// One worker serves one RemoteHost. close() keeps the link open until the
// page's repo holds everything the worker's repo did (which keeps nothing
// itself), so a worker ended after it loses no write.
import { next as A } from "@automerge/automerge/slim";
import { PortAdapter } from "./port.js";

export class RemoteHost {
  /** The last state the worker reported, for a view. */
  status = { start: 0, desync: [], rebases: 0, asked: 0, written: { chunks: 0, checkpoints: 0 }, fault: null, error: null };
  stats = null;
  tick = 0;
  frontier = 0;
  loading = true;
  seat = null;

  #worker;
  #repo;
  #adapter;
  #input;
  #clock;
  #calls = new Map(); // id -> { resolve, reject }
  #ids = 0;
  #out = false; // a frame request is out
  #views = new Set(); // views asked for since the last frame request
  #pictures = new Map(); // view -> { width, height, rgba }
  #queue = [];
  #target = 0;
  #info = {};
  #error = null; // the worker's own failure, kept across its reports
  #closed = false;
  #listen = ({ data }) => this.#answer(data);
  #failed = (e) => this.#fail(e.message ?? e);

  /**
   * Opens a session in a worker. The options are Host.open's, plus:
   * @param o.worker   a Worker running worker.js (or any endpoint serve() listens on)
   * @param o.channel  () => a MessageChannel (for tests)
   * @param o.budget   as Host's, but 25 ms by default: the page does not wait
   *                  for it, and a joiner catches up sooner (bench/worker)
   * The other options cross to the worker, so they are data: functions such
   * as now and perf are the worker's own (serve's `local`).
   * The worker's repo has the peer id `machine-…`: Patchwork's tab repo
   * announces documents only to its shared worker, so the machine worker
   * gets exactly the documents it asks for.
   */
  static async open(repo, url, { worker, channel = () => new MessageChannel(), wasm, content = new Uint8Array(), input, clock, budget = 25, ...options }) {
    const { port1, port2 } = channel();
    const adapter = new PortAdapter(port1);
    repo.networkSubsystem.addNetworkAdapter(adapter);
    const remote = new RemoteHost(worker, repo, adapter, input, clock);
    const id = options.id ?? Math.random().toString(36).slice(2);
    const own = (b) => new Uint8Array(b); // a copy of the caller's bytes, to transfer
    const [w, c] = [own(wasm), own(content)];
    remote.#info = await remote.#call(
      "open",
      { url, link: port2, peerId: `machine-${id}`, wasm: w, content: c, options: { ...options, budget, id }, given: { input: !!input, clock: !!clock } },
      [port2, w.buffer, c.buffer],
    );
    remote.#update(remote.#info.state);
    return remote;
  }

  constructor(worker, repo, adapter, input, clock) {
    this.#worker = worker;
    this.#repo = repo;
    this.#adapter = adapter;
    this.#input = input;
    this.#clock = clock;
    worker.addEventListener("message", this.#listen);
    worker.addEventListener("error", this.#failed);
  }

  get url() {
    return this.#info.url;
  }
  get id() {
    return this.#info.id;
  }
  get delay() {
    return this.#info.delay;
  }
  /** There is no engine on this side; use picture() and output(). */
  get engine() {
    return null;
  }
  get clock() {
    return this.#clock ?? null;
  }
  target() {
    return this.#target;
  }

  /** Asks the worker for a frame, unless it has not answered the last one. */
  frame() {
    if (this.#out || !this.#info.url || this.#closed) return;
    this.#out = true;
    const input = this.#input ? new Uint8Array(this.#input()) : null;
    const clock = this.#clock ? { t: this.#clock.t(), running: this.#clock.running() } : null;
    const views = [...this.#views];
    this.#views.clear();
    this.#call("frame", { input, clock, views }).then(
      ({ state, pictures, output }) => {
        this.#out = false;
        if (this.#closed) return;
        this.#update(state);
        for (const [view, p] of Object.entries(pictures)) this.#pictures.set(+view, p);
        this.#queue.push(...output);
      },
      (e) => {
        this.#out = false;
        if (!this.#closed) this.#fail(e.message);
      },
    );
  }

  /** The newest picture from `view`; asking is what makes the worker draw it. */
  picture(view = 0) {
    this.#views.add(view);
    return this.#pictures.get(view) ?? null;
  }

  /** What the machine played since the last call (Host.output). */
  output() {
    return this.#queue.splice(0);
  }

  async sit(port) {
    this.#update(await this.#call("sit", { port }));
  }
  async stand() {
    this.#update(await this.#call("stand", {}));
  }
  /** With a clock of the page's own, pausing is the clock's business. */
  pause(margin) {
    return this.#clock ? this.#clock.pause?.(margin) : this.#call("pause", { margin });
  }
  resume() {
    return this.#clock ? this.#clock.resume?.() : this.#call("resume", {});
  }

  /**
   * Closes the host in the worker, then the link to it once the page's repo
   * holds every change the worker's repo made (its last chunk, a stand, a
   * checkpoint: sync sends them up to 100 ms after they are made), or after
   * `wait` ms if the worker does not answer. Await it before ending the
   * worker, which is the caller's to end. Calls after it do nothing.
   */
  async close({ wait = 5000 } = {}) {
    if (this.#closed) return;
    this.#closed = true;
    let timer;
    const late = new Promise((resolve) => (timer = setTimeout(resolve, wait)));
    const held = (async () => {
      const heads = await this.#call("close", {});
      await Promise.all(Object.entries(heads).map(([url, h]) => this.#has(url, h)));
    })().catch(() => {});
    await Promise.race([held, late]);
    clearTimeout(timer);
    this.#adapter.disconnect();
    this.#worker.removeEventListener("message", this.#listen);
    this.#worker.removeEventListener("error", this.#failed);
    for (const call of this.#calls.values()) call.reject(new Error("closed"));
    this.#calls.clear();
  }

  // Resolves once the page's copy of url holds every change in heads.
  async #has(url, heads) {
    const handle = await this.#repo.find(url);
    const has = () => A.hasHeads(handle.fullDoc(), heads);
    if (has()) return;
    await new Promise((resolve) => {
      const changed = () => has() && (handle.off("change", changed), resolve());
      handle.on("change", changed);
    });
  }

  #update(s) {
    if (!s) return;
    ({ tick: this.tick, frontier: this.frontier, target: this.#target, loading: this.loading, seat: this.seat, stats: this.stats } = s);
    this.status = { ...s.status, error: s.status.error ?? this.#error };
  }

  #fail(why) {
    this.#error = String(why);
    this.status = { ...this.status, error: this.#error };
  }

  #call(m, payload, transfer = []) {
    if (this.#closed && m !== "close") return Promise.reject(new Error("closed"));
    const id = ++this.#ids;
    return new Promise((resolve, reject) => {
      this.#calls.set(id, { resolve, reject });
      this.#worker.postMessage({ m, id, ...payload }, transfer);
    });
  }

  #answer({ id, result, error }) {
    const call = this.#calls.get(id);
    if (!call) return;
    this.#calls.delete(id);
    if (error) call.reject(new Error(error));
    else call.resolve(result);
  }
}
