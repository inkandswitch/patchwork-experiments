// A machine in a scene (running.js), on two views of one session over real
// automerge-repo in virtual time: each view has its own world time, the
// follower's trailing the computer's as a scene's does. The toy engine, so
// every case is quick; the cases are the bounded space of who plays, the
// world running or paused, and how far the follower trails.
import { readFileSync } from "node:fs";
import { initSubduction } from "@automerge/automerge-repo";
import { SimNet } from "../host/simnet.js";
import { rig, FRAME, LAN } from "../host/harness.js";
import { tickAt } from "../host/clock.js";
import { newSession } from "../patchwork/load.js";
import { runMachine } from "./running.js";
import { follow } from "./seating.js";

const wasm = readFileSync(new URL("../../engines/toy/dist/toy.wasm", import.meta.url));
const content = new TextEncoder().encode("scene");
await initSubduction();
const PORTS = 4;
const { peer, replay } = await rig({ wasm, content, input: () => new Uint8Array(2) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// A scene's world clock as one view has it: its t moves only when the test
// moves it; process() registrations are counted.
function world(t, running = true) {
  const w = {
    s: t,
    run: running,
    processes: new Set(),
    steps: [],
    t: () => w.s,
    running: () => w.run,
    process(spec) {
      // a process as STAGE.md has it (step is not optional), replicated; its step does
      // nothing, since the host pulls its tick from t() on every frame
      expect(Object.keys(spec).sort()).toEqual(["replicated", "step"]);
      expect(spec.replicated).toBe(true);
      expect(typeof spec.step).toBe("function");
      w.processes.add(spec);
      w.steps.push(spec.step);
      return () => w.processes.delete(spec);
    },
  };
  return w;
}

// Two views of one machine made `born` seconds into the world; b's world
// trails a's by `lag` seconds.
async function views({ born = 0, lag = 0, input = () => new Uint8Array(2) } = {}) {
  const net = new SimNet({ latency: LAN });
  const a = peer(net, "a"), b = peer(net, "b");
  a.world = world(born);
  b.world = world(born - lag);
  const session = await newSession(a.repo, { kind: "toy", wasm, content, wall: a.world.t() * 1000 });
  for (const p of [a, b]) {
    const found = p.repo.find(session.url);
    await vi.advanceTimersByTimeAsync(300);
    await found;
    let done = false;
    runMachine({ repo: p.repo, url: session.url, wasm, content, ports: PORTS, world: p.world, now: p.now, writable: () => true, by: p.name, input })
      .then((m) => ((p.m = m), (p.host = m.host), (done = true)));
    while (!done) await vi.advanceTimersByTimeAsync(20);
  }
  return { a, b, url: session.url };
}

// Frames of virtual time; each view's world moves on with them while it runs.
async function frames(peers, ms) {
  for (let t = 0; t < ms; t += FRAME) {
    for (const p of peers) {
      if (p.world.run) p.world.s += FRAME / 1000;
      p.m.frame();
    }
    await vi.advanceTimersByTimeAsync(FRAME);
  }
}

test("made hours into the world, it starts at tick 0, stopped, and keeps no world going while nobody plays", async () => {
  const { a, b } = await views({ born: 7200, lag: 0.1 });
  await frames([a, b], 1000);
  for (const p of [a, b]) {
    expect(p.host.tick).toBe(0);
    expect(tickAt(p.m.clock, [35, 1])).toBe(0);
    expect(p.world.processes.size).toBe(0);
  }
});

test("the process is registered exactly while the machine runs, on every view: who plays × the world running or paused", async () => {
  for (const lag of [0, 0.2])
    for (const paused of [false, true]) {
      const { a, b } = await views({ born: 50, lag });
      const registered = () => [a.world.processes.size, b.world.processes.size];
      await frames([a, b], 200);
      expect(registered()).toEqual([0, 0]); // nobody plays
      expect(a.m.play(1)).toBe(1);
      await frames([a, b], 500);
      expect(registered()).toEqual([1, 1]); // a plays: both count it
      expect(a.m.holders().map(Boolean)).toEqual([false, true, false, false]);
      expect(b.m.holders().map(Boolean)).toEqual([false, true, false, false]);
      if (paused) {
        a.world.run = b.world.run = false; // the scene's clock paused (anyone's pause)
        await frames([a, b], 300);
        expect(registered()).toEqual([0, 0]);
        const ticks = [a.host.tick, b.host.tick];
        await frames([a, b], 500);
        expect([a.host.tick, b.host.tick]).toEqual(ticks); // a paused world stops the machine
        a.world.run = b.world.run = true;
        await frames([a, b], 300);
        expect(registered()).toEqual([1, 1]);
      }
      a.m.leave(); // the last player leaves: the machine stops, for everyone
      await frames([a, b], 1500);
      expect(registered()).toEqual([0, 0]);
      expect(a.host.clock.running()).toBe(false);
      expect(b.host.clock.running()).toBe(false);
      await a.m.close();
      await b.m.close();
    }
});

test("two views play and stop: both at the same tick, with the state the documents give, whatever the follower's lag", async () => {
  for (const lag of [0, 0.05, 0.2]) {
    let k = 0;
    const input = () => new Uint8Array([((k++ >> 2) % 5) - 2, k % 7 === 0 ? 1 : 0]);
    const { a, b } = await views({ born: 30, lag, input });
    a.m.play(0);
    await frames([a, b], 200);
    expect(b.m.play(0)).toBe(null); // taken
    expect(b.m.play(1)).toBe(1);
    expect(b.host.seat.port).toBe(1);
    await frames([a, b], 2000);
    a.m.leave();
    await frames([a, b], 300);
    b.m.leave();
    await frames([a, b], 2000);
    const tick = a.host.tick;
    expect(tick).toBeGreaterThan(50);
    expect(b.host.tick).toBe(tick);
    const truth = await replay(a, tick);
    expect(a.host.engine.hash()).toBe(truth[tick]);
    expect(b.host.engine.hash()).toBe(truth[tick]);
    // and it stays there while the world runs on
    await frames([a, b], 1000);
    expect([a.host.tick, b.host.tick]).toEqual([tick, tick]);
    await a.m.close();
    await b.m.close();
  }
}, 30_000);

test("play takes the port asked for when it's free, none when it's held; holding one, that one", async () => {
  const { a, b } = await views();
  expect(a.m.play(2)).toBe(2);
  expect(a.m.play(0)).toBe(2); // already seated: the same port
  await frames([a, b], 300);
  expect(b.m.play(2)).toBe(null);
  expect(b.host.seat).toBe(null);
  expect(b.m.play(0)).toBe(0);
  await a.m.close();
  await b.m.close();
});

test("the process's step moves nothing: stepped on the stage's grid or not, the host is where world time puts it", async () => {
  const { a, b } = await views({ born: 10 });
  a.m.play(0);
  await frames([a, b], 600);
  for (const p of [a, b]) {
    expect(p.world.steps.length).toBe(1);
    const [tick, hash] = [p.host.tick, p.host.engine.hash()];
    // a quarter second of the stage's grid, as the stage would step a replicated process
    for (let k = 1; k <= 15; k++) p.world.steps[0](1 / 60, p.world.s + k / 60);
    expect([p.host.tick, p.host.engine.hash()]).toEqual([tick, hash]);
  }
  await a.m.close();
  await b.m.close();
});

test("a seat drives the port: every sequence of three seats for one view (none, P1, P2) while the other sits at P2, then gets up", async () => {
  // b sits at port 1 throughout; a follows each of 27 sequences of three
  // wants, 400 ms each. After each: a holds what it wants unless b holds it
  // (then nothing, and the pad never came), the pad was picked up once per
  // port taken and put down once per port given back, and two views never
  // hold one port. Then b gets up: a takes P2 if it's still waiting for it,
  // and if a is up too, the machine stops.
  const WANTS = [null, 0, 1];
  let cases = 0;
  for (const x of WANTS)
    for (const y of WANTS)
      for (const z of WANTS) {
        const { a, b } = await views();
        const pads = { a: [], b: [] };
        const hands = (p) => ({ pickUp: (port) => pads[p.name].push(["up", port]), putDown: () => pads[p.name].push(["down"]) });
        const want = { a: null, b: 1 };
        const run = async (ms) => {
          for (let t = 0; t < ms; t += FRAME) {
            for (const p of [a, b]) {
              follow(p.m, want[p.name], hands(p));
              if (p.world.run) p.world.s += FRAME / 1000;
              p.m.frame();
            }
            await vi.advanceTimersByTimeAsync(FRAME);
          }
        };
        await run(400);
        let mine = null; // the port a holds, by the model
        let ups = 0, downs = 0;
        for (const w of [x, y, z]) {
          if (mine !== null && w !== mine) downs++;
          want.a = w;
          await run(400);
          const next = w === 1 ? null : w; // b holds port 1
          if (next !== null && next !== mine) ups++;
          mine = next;
          expect(a.host.seat?.port ?? null).toBe(mine === null && w === 1 ? null : mine);
          expect(pads.a.filter(([k]) => k === "up").length).toBe(ups);
          expect(pads.a.filter(([k]) => k === "down").length).toBe(downs);
          const h = a.m.holders();
          expect(h[1]?.by).toBe("b");
          if (mine !== null) expect(h[mine]?.by).toBe("a");
          expect(h.filter((s) => s?.by === "a").length).toBe(mine === null ? 0 : 1);
        }
        expect(pads.b).toEqual([["up", 1]]);
        want.b = null;
        await run(1000);
        expect(b.host.seat).toBe(null);
        // b's port free now: a, still wanting it, takes it; and a machine nobody holds stops
        expect(a.host.seat?.port ?? null).toBe(z);
        expect(a.m.clock.running()).toBe(z !== null);
        await a.m.close();
        await b.m.close();
        cases++;
      }
  expect(cases).toBe(27);
}, 120_000);
