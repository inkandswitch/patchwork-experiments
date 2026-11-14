// RemoteHost and serve(), in one thread: each "worker" is serve() on one end
// of an in-process pair whose messages are structured clones delivered by
// timer, transferring what is transferred (so a buffer the sender keeps
// after transferring it would be found detached). Peers a and b run their
// hosts this way; c runs a Host on its own thread, in the same session. The
// page repos are on SimNet, WAN with loss, in virtual time; each worker's
// repo is a peer of its page's repo alone.
import { readFileSync } from "node:fs";
import { initSubduction, Repo } from "@automerge/automerge-repo";
import { SimNet } from "../host/simnet.js";
import { rig, run, FRAME, WAN, LOSSY, SKEWS } from "../host/harness.js";
import { createSession } from "../host/host.js";
import { RemoteHost } from "./remote.js";
import { serve } from "./serve.js";

const ALLOC = 1, FREE = 2;
const wasm = readFileSync(new URL("../../engines/toy/dist/toy.wasm", import.meta.url));
const content = new TextEncoder().encode("host");
await initSubduction();
const input = (port, t) => new Uint8Array([(((t >> 3) + port) % 5) - 2, t % 11 === port ? ALLOC : t % 13 === port ? FREE : 0]);
const { peer, open, replay } = await rig({ wasm, content, input: (p, t) => input(p.port ?? 0, t) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// One end of an in-process message pair.
class End {
  other = null;
  #listeners = new Set();
  postMessage(data, transfer = []) {
    // A real postMessage would transfer the repo's MessagePort (`link`); here
    // it is passed as it is.
    const link = data?.link;
    const copy = structuredClone({ ...data, link: undefined }, { transfer: transfer.filter((t) => t !== link) });
    if (link) copy.link = link;
    setTimeout(() => this.other.#listeners.forEach((fn) => fn({ data: copy })), 0);
  }
  addEventListener(type, fn) {
    if (type === "message") this.#listeners.add(fn);
  }
  removeEventListener(type, fn) {
    this.#listeners.delete(fn);
  }
  start() {}
}
function pair() {
  const a = new End(), b = new End();
  [a.other, b.other] = [b, a];
  return [a, b];
}

// A peer whose host runs in a "worker": its page repo is on the network.
async function remote(net, name, url, port, engine = { wasm, content }) {
  const repo = new Repo({ peerId: name, network: [net.adapter(name)] });
  const [page, worker] = pair();
  const served = serve(worker, { now: () => Date.now() + SKEWS["abcd".indexOf(name)] });
  const p = { name, repo, port, served, host: null };
  await vi.advanceTimersByTimeAsync(500);
  let done = false;
  RemoteHost.open(repo, url, {
    worker: page,
    channel: () => {
      const [port1, port2] = pair();
      return { port1, port2 };
    },
    ...engine,
    id: name,
    input: () => input(port, p.host ? p.host.target() : 0),
  }).then((h) => ((p.host = h), (done = true)));
  while (!done) await vi.advanceTimersByTimeAsync(20);
  return p;
}

test("hosts in workers play with a host on the page's thread, and agree with the documents", async () => {
  const net = new SimNet({ latency: WAN, loss: LOSSY });
  const c = peer(net, "c", SKEWS[2]);
  const handle = await createSession(c.repo, { wasm, content, wall: c.now() });
  await open(c, handle.url);
  const a = await remote(net, "a", handle.url, 0);
  const b = await remote(net, "b", handle.url, 1);
  const peers = [a, b, c];
  c.port = 2;
  await Promise.all([a.host.sit(0), b.host.sit(1), vi.advanceTimersByTimeAsync(50)]);
  c.host.sit(2);
  expect(a.host.seat.port).toBe(0);
  const heard = new Map([[a, []], [b, []]]);
  for (let k = 0; k < 200; k++) {
    await run(peers, FRAME);
    for (const p of [a, b]) {
      heard.get(p).push(...p.host.output());
      p.host.picture(p.port);
    }
  }
  // What the page sees: the worker's state, its pictures, its output.
  for (const p of [a, b]) {
    expect(p.host.tick).toBeGreaterThan(150);
    expect(p.host.status.error).toBe(null);
    const pic = p.host.picture(p.port);
    expect([pic.width, pic.height, pic.rgba.length]).toEqual([16, 16, 16 * 16 * 4]);
    const ticks = heard.get(p).filter((o) => !o.gap && !o.was).map((o) => o.tick);
    expect(ticks.length).toBeGreaterThan(100);
    expect(ticks.every((t, i) => i === 0 || t === ticks[i - 1] + 1)).toBe(true);
    expect(heard.get(p).filter((o) => o.audio).every((o) => o.audio.samples.length === 64)).toBe(true);
  }
  // Paused, everyone agrees with the documents.
  a.host.pause();
  await run(peers, 1500);
  const tick = c.host.tick;
  const truth = await replay(c, tick);
  for (const h of [a.served.host, b.served.host, c.host]) {
    expect(h.tick).toBe(tick);
    expect(h.frontier).toBeGreaterThanOrEqual(tick);
    expect(h.engine.hash()).toBe(truth[tick]);
    expect(h.status.desync).toEqual([]);
  }
  expect(a.host.tick).toBe(tick); // the page's view caught up too
}, 30_000);

test("the page never waits: one frame request out at a time, and a trap in the worker is a status", async () => {
  const net = new SimNet({ latency: WAN });
  const c = peer(net, "c", SKEWS[2]);
  const handle = await createSession(c.repo, { wasm, content, wall: c.now() });
  await open(c, handle.url);
  const a = await remote(net, "a", handle.url, 0);
  await Promise.all([a.host.sit(0), vi.advanceTimersByTimeAsync(50)]);
  // Frames asked for faster than the worker answers are not queued.
  const posted = vi.spyOn(a.host, "frame");
  let asked = 0;
  const send = End.prototype.postMessage;
  const counting = vi.spyOn(End.prototype, "postMessage").mockImplementation(function (data, transfer) {
    if (data?.m === "frame") asked++;
    return send.call(this, data, transfer);
  });
  for (let i = 0; i < 10; i++) a.host.frame();
  expect(asked).toBe(1);
  counting.mockRestore();
  posted.mockRestore();
  await run([a, c], 1000);
  const T = a.served.host.tick + 10;
  const e = a.served.host.engine;
  const step = e.step.bind(e);
  e.step = (row) => {
    const t = a.served.host.tick;
    step(row);
    if (t === T) throw new WebAssembly.RuntimeError("unreachable");
  };
  await run([a, c], 1500);
  expect(a.host.status.fault).toMatchObject({ tick: T, confirmed: true });
  expect(a.host.tick).toBe(T);
  expect(c.host.tick).toBeGreaterThan(T + 30);
  expect(c.host.frontier).toBeGreaterThan(T + 30); // a's inputs still come
}, 30_000);

test("close: the worker's last writes reach the page before the link closes; nothing after it is sent or heard", async () => {
  const net = new SimNet({ latency: WAN });
  const c = peer(net, "c", SKEWS[2]);
  const handle = await createSession(c.repo, { wasm, content, wall: c.now() });
  await open(c, handle.url);
  const a = await remote(net, "a", handle.url, 0);
  await Promise.all([a.host.sit(0), vi.advanceTimersByTimeAsync(50)]);
  await run([a, c], 1000);
  const id = a.host.seat.id;
  // Stand, ask for a frame and close, all at once: the stand's change is
  // made in the worker's repo and its sync crosses after close was asked
  // for, and the frame's answer comes after it.
  const stood = a.host.stand();
  a.host.frame();
  const seen = a.host.tick;
  let closed = false;
  a.host.close().then(() => (closed = true));
  while (!closed) await vi.advanceTimersByTimeAsync(10);
  const page = (await a.repo.find(handle.url)).doc();
  expect(page.seats[id].until).toBeGreaterThan(0);
  expect(a.served.host).toBe(null);
  expect(a.host.tick).toBe(seen); // the frame answered after close was not heard
  await stood;
  const posted = vi.spyOn(End.prototype, "postMessage");
  a.host.frame();
  await a.host.close();
  await expect(a.host.sit(0)).rejects.toThrow("closed");
  expect(posted).not.toHaveBeenCalled();
  posted.mockRestore();
  // c hears the stand too.
  await run([c], 1000);
  expect((await c.repo.find(handle.url)).doc().seats[id].until).toBe(page.seats[id].until);
}, 30_000);

test("a view is drawn again when the state changes at the same tick (a rollback), and only then", async () => {
  const [page, worker] = pair();
  const served = serve(worker);
  let drawn = 0;
  served.host = {
    tick: 10, revision: 1, status: {}, stats: null, loading: false, seat: null,
    frame() {}, target: () => 10, output: () => [],
    picture: () => (drawn++, { width: 1, height: 1, rgba: new Uint8ClampedArray(4) }),
  };
  const answers = [];
  page.addEventListener("message", ({ data }) => answers.push(data.result));
  const frame = async () => {
    page.postMessage({ m: "frame", id: 1, input: null, clock: null, views: [0] });
    await vi.advanceTimersByTimeAsync(1);
    return Object.keys(answers.at(-1).pictures).length;
  };
  expect(await frame()).toBe(1);
  expect(await frame()).toBe(0); // same tick, same revision
  served.host.revision = 2; // re-stepped to the same tick
  expect(await frame()).toBe(1);
  served.host.tick = 11;
  expect(await frame()).toBe(1);
  expect(drawn).toBe(3);
});

test("a query is asked of the host and answered again exactly when the state changed since that kind was last asked, per kind", async () => {
  // Every sequence of 3 frames, each keeping the state, re-stepping it to the same tick
  // (revision) or stepping it on (tick), and asking for kind 0, kind 1 or kind 2, which
  // the engine can't answer (null), or two of them. The host is asked a kind only when
  // the state changed since it was last asked that kind, answered or not.
  const CHANGES = ["same", "revision", "tick"];
  const ASKS = [[0], [1], [2], [0, 1], [1, 2]];
  let cases = 0;
  for (const c1 of CHANGES) for (const c2 of CHANGES) for (const c3 of CHANGES)
    for (const a1 of ASKS) for (const a2 of ASKS) for (const a3 of ASKS) {
      const [page, worker] = pair();
      const served = serve(worker);
      const answered = [];
      served.host = {
        tick: 10, revision: 1, status: {}, stats: null, loading: false, seat: null,
        frame() {}, target: () => 10, output: () => [], picture: () => null,
        query: (kind) => (answered.push(kind), kind === 2 ? null : new Uint8Array([kind, served.host.tick, served.host.revision])),
      };
      const answers = [];
      page.addEventListener("message", ({ data }) => answers.push(data.result.answers));
      const last = new Map(); // kind -> the state it was last asked at
      for (const [change, ask] of [[null, a1], [c1, a2], [c2, a3], [c3, [0, 1, 2]]]) {
        if (change === "revision") served.host.revision++;
        if (change === "tick") served.host.tick++;
        answered.length = 0;
        page.postMessage({ m: "frame", id: 1, input: null, clock: null, views: [], queries: ask });
        await vi.advanceTimersByTimeAsync(1);
        const at = `${served.host.tick}:${served.host.revision}`;
        const want = ask.filter((k) => last.get(k) !== at);
        expect(answered).toEqual(want); // asked of the host: each copies the state
        expect(Object.keys(answers.at(-1)).map(Number)).toEqual(want.filter((k) => k !== 2));
        for (const k of want) {
          if (k !== 2) expect([...answers.at(-1)[k]]).toEqual([k, served.host.tick, served.host.revision]);
          last.set(k, at);
        }
      }
      cases++;
    }
  expect(cases).toBe(27 * 125);
});

test("a query that comes back null while the host is loading is asked again once it has loaded, the state unchanged", async () => {
  for (const kinds of [[0], [2], [0, 2]]) {
    const [page, worker] = pair();
    const served = serve(worker);
    const answered = [];
    served.host = {
      tick: 10, revision: 1, status: {}, stats: null, loading: true, seat: null,
      frame() {}, target: () => 10, output: () => [], picture: () => null,
      query: (kind) => (answered.push(kind), served.host.loading || kind === 2 ? null : new Uint8Array([kind])),
    };
    const answers = [];
    page.addEventListener("message", ({ data }) => answers.push(data.result.answers));
    const frame = async () => {
      answered.length = 0;
      page.postMessage({ m: "frame", id: 1, input: null, clock: null, views: [], queries: kinds });
      await vi.advanceTimersByTimeAsync(1);
      return [...answered];
    };
    expect(await frame()).toEqual(kinds); // loading: nothing to answer yet
    expect(await frame()).toEqual(kinds); // still loading: asked again
    served.host.loading = false; // loaded at the same tick and revision
    expect(await frame()).toEqual(kinds);
    expect(Object.keys(answers.at(-1)).map(Number)).toEqual(kinds.filter((k) => k !== 2));
    expect(await frame()).toEqual([]); // loaded, nothing changed: not asked again, null or not
  }
});

test("a RemoteHost's query reaches the page for the state its worker reached, from a real engine (the Super NES's work RAM)", async () => {
  const snes = readFileSync(new URL("../../engines/snes/dist/snes.wasm", import.meta.url));
  const rom = new Uint8Array(readFileSync(new URL("../../engines/snes/test/unarmed.sfc", import.meta.url)));
  const net = new SimNet({ latency: [5] });
  const c = peer(net, "c");
  const handle = await createSession(c.repo, { wasm: snes, content: rom, wall: c.now() });
  const a = await remote(net, "a", handle.url, 0, { wasm: snes, content: rom });
  const host = a.host;
  expect(host.query(0)).toBe(null); // nothing asked for yet
  await Promise.all([host.sit(0), vi.advanceTimersByTimeAsync(50)]);
  let checked = 0;
  for (let k = 0; k < 40; k++) {
    host.query(0);
    host.query(9); // a kind the engine lacks: never answered
    await run([a], FRAME);
    const wram = host.query(0);
    const h = a.served.host;
    if (!wram || h.tick !== host.tick) continue;
    expect(wram.length).toBe(131072);
    expect(wram).toEqual(h.engine.query(0));
    expect(host.query(9)).toBe(null);
    checked++;
  }
  expect(host.tick).toBeGreaterThan(20);
  expect(checked).toBeGreaterThan(5);
}, 30_000);
