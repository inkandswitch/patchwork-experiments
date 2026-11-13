// What the worker check runs in a headless Chrome page (bundled by run.mjs):
// a Super NES session on Unarmed, its page repos on an in-page SimNet (LAN
// table, real time). Peers a and b play from the start, each with its host
// in a worker. At JOIN seconds, peer c opens the session: the newest
// checkpoint is EVERY seconds old at most, so c catches up for seconds. How
// c runs is the mode:
//   worker   a RemoteHost, its host in a worker;
//   main     a Host on the page's thread, budgeted (10 ms a frame, the default);
//   greedy   a Host on the page's thread with no budget (the host before phase 1's budget).
// Every animation frame, the page asks each host for a frame and draws each
// peer's picture into a canvas, as a scene would. Measured on the page's
// thread: long tasks (PerformanceObserver "longtask", over 50 ms) and the
// intervals between animation frames, before c joins and from its open until
// three seconds after it caught up.
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { SimNet } from "../../src/host/simnet.js";
import { createSession, Host } from "../../src/host/host.js";
import { RemoteHost } from "../../src/worker/remote.js";
import { pads, TWO_PLAYERS, B, Y, A, X, LEFT, RIGHT } from "../../engines/snes/test/unarmed.js";

const EVERY = 30; // s between checkpoints
const JOIN = 55; // s: c opens the session; its checkpoint is 25 s old
const AFTER = 3000; // ms measured after c caught up

const report = (x) => fetch("/report", { method: "POST", body: JSON.stringify(x) });
const say = (x) => fetch("/log", { method: "POST", body: String(x) });

// The scripts reach a round; from frame 1500 each pad keeps fighting on a
// pattern of its own, so input keeps changing.
const FIGHT = [[0, 30, RIGHT], [30, 40, Y], [40, 46, A], [46, 76, LEFT], [76, 86, X], [86, 92, B], [92, 110, RIGHT | Y]];
function script(port, frame) {
  if (frame < 1500) return pads(TWO_PLAYERS, frame).subarray(port * 2, port * 2 + 2);
  const phase = (frame + 41 * port) % 150;
  let b = 0;
  for (const [from, to, buttons] of FIGHT) if (phase >= from && phase < to) b |= buttons;
  return new Uint8Array([b & 0xff, b >> 8]);
}

async function load(path) {
  const r = await fetch(`/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
  const r = (x) => Math.round(x * 10) / 10;
  return { n: s.length, p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1] ?? 0), over33: s.filter((x) => x > 33.4).length, over50: s.filter((x) => x > 50).length };
};

async function main() {
  const mode = new URLSearchParams(location.search).get("mode");
  const budget = +(new URLSearchParams(location.search).get("budget") ?? 25);
  await initSubduction();
  const wasm = await load("engines/snes/dist/snes.wasm");
  const rom = await load("engines/snes/test/unarmed.sfc");
  const net = new SimNet({ latency: [20, 25, 30] });
  // As Patchwork's tab repo does, the page repos announce documents to each
  // other (there, to the shared worker) and not to the machine workers, which
  // ask for what they need.
  const sharePolicy = async (peer) => !peer.startsWith("machine-");
  const repo = (name) => new Repo({ peerId: name, network: [net.adapter(name)], sharePolicy });
  const repos = { a: repo("a"), b: repo("b"), c: repo("c") };
  const handle = await createSession(repos.a, { wasm, content: rom, seconds: { every: EVERY } });
  const url = handle.url;
  const worker = () => new Worker("/out/worker.js", { type: "module" });

  const hosts = {};
  const canvases = {};
  for (const name of ["a", "b", "c"]) {
    const c = document.createElement("canvas");
    [c.width, c.height] = [256, 224];
    document.body.append(c);
    canvases[name] = c.getContext("2d");
  }
  const input = (name, port) => () => script(port, hosts[name]?.target() ?? 0);
  for (const [name, port] of [["a", 0], ["b", 1]]) {
    await repos[name].find(url);
    hosts[name] = await RemoteHost.open(repos[name], url, { worker: worker(), wasm, content: rom, id: name, input: input(name, port) });
    await hosts[name].sit(port);
  }

  // The page's frame loop: every host's frame, every peer's picture drawn.
  const intervals = [];
  const work = []; // ms of the page's thread each frame spends on the machines
  let last = performance.now();
  let running = true;
  const loop = (now) => {
    intervals.push([now, now - last]);
    last = now;
    const began = performance.now();
    for (const [name, h] of Object.entries(hosts)) {
      h.frame();
      h.output();
      const p = h.picture(0);
      if (p) canvases[name].putImageData(new ImageData(p.rgba, p.width, p.height), 0, 0);
    }
    work.push([now, performance.now() - began]);
    if (running) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const longtasks = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longtasks.push([e.startTime, e.duration]);
  }).observe({ type: "longtask", buffered: true });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  while (performance.now() - t0 < JOIN * 1000) {
    await sleep(1000);
    say(`${mode} t=${Math.round((performance.now() - t0) / 1000)} a=${hosts.a.tick} b=${hosts.b.tick} cp=${Object.keys(handle.doc().checkpoints ?? {})}`);
  }

  // c joins.
  const join = performance.now();
  await repos.c.find(url);
  if (mode === "worker") hosts.c = await RemoteHost.open(repos.c, url, { worker: worker(), wasm, content: rom, id: "c", budget });
  else hosts.c = await Host.open(repos.c, url, { wasm, content: rom, id: "c", budget: mode === "greedy" ? Infinity : 10 });
  const opened = performance.now();
  const c = hosts.c;
  const behind = c.target() - c.tick;
  const start = c.status.start;
  while (c.loading || c.tick < c.target() - 1) await sleep(20);
  const caught = performance.now();
  await sleep(AFTER);
  const end = performance.now();
  // Pause, let it settle, and see that everyone is at the same tick.
  hosts.a.pause();
  await sleep(2000);
  running = false;

  const within = (xs, from, to) => xs.filter(([t]) => t >= from && t < to);
  const tasks = (from, to) => {
    const xs = within(longtasks, from, to).map(([, d]) => d);
    return { count: xs.length, total: Math.round(xs.reduce((a, b) => a + b, 0)), max: Math.round(Math.max(0, ...xs)) };
  };
  const window = (from, to) => {
    const w = within(work, from, to).map(([, d]) => d);
    return {
      ms: Math.round(to - from),
      longtasks: tasks(from, to),
      frames: stats(within(intervals, from, to).map(([, d]) => d)),
      work: { ...stats(w), total: Math.round(w.reduce((a, b) => a + b, 0)) },
    };
  };
  const ticks = Object.fromEntries(Object.entries(hosts).map(([n, h]) => [n, h.tick]));
  return {
    mode: mode + (mode === "worker" && budget !== 25 ? `:${budget}` : ""),
    userAgent: navigator.userAgent,
    joiner: { start, behind, openMs: Math.round(opened - join), catchUpMs: Math.round(caught - opened), stats: c.stats },
    before: window(join - 10_000, join),
    join: window(join, end),
    ticks,
    frontiers: Object.fromEntries(Object.entries(hosts).map(([n, h]) => [n, h.frontier])),
    status: Object.fromEntries(Object.entries(hosts).map(([n, h]) => [n, { desync: h.status.desync, fault: h.status.fault, error: h.status.error }])),
  };
}

addEventListener("error", (e) => say(e.message));
addEventListener("unhandledrejection", (e) => say(e.reason?.stack ?? e.reason));
main().then(
  (result) => report({ ok: true, result }),
  (e) => report({ ok: false, fatal: String(e?.stack ?? e) }),
);
