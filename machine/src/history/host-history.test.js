// A history taken through a real Host, two peers on the WAN table: the
// trace reaches it from the host's timeline and frames, the conflicts it
// finds are the host's rollbacks, and the state it rebuilds at the head is
// the host's own.
import { readFileSync } from "node:fs";
import { initSubduction } from "@automerge/automerge-repo";
import { SimNet } from "../host/simnet.js";
import { rig, run, WAN, LOSSLESS, SKEWS } from "../host/harness.js";
import { History, pathTo } from "./history.js";
import { Rebuilder } from "./rebuild.js";

const wasm = readFileSync(new URL("../../engines/toy/dist/toy.wasm", import.meta.url));
const content = new TextEncoder().encode("host history");
await initSubduction();
const { machine, peer, open, session } = await rig({
  wasm,
  content,
  input: (p, t) => new Uint8Array([(((t >> 2) + (p.port ?? 0)) % 5) - 2, t % 9 === (p.port ?? 0) ? 1 : 0]),
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("a watching peer's history: the host's rollbacks are its conflicts, its head the host's state", async () => {
  const net = new SimNet({ latency: WAN, loss: LOSSLESS });
  const { peers, url } = await session(net, 2, { seconds: { chunk: 0.25, every: 1, roll: 2 } });
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  const history = new History({ inputBytes: 2 });
  const w = peer(net, "w", SKEWS[2]);
  await open(w, url, { trace: history.record });
  await run([...peers, w], 3000);
  peers[0].host.pause();
  await run([...peers, w], 1500);

  const host = w.host;
  expect(host.stats.rewinds).toBeGreaterThan(0);
  expect(history.head.tick).toBe(host.tick);
  expect(history.frontier).toBe(host.frontier);
  expect(history.conflicts.length).toBeGreaterThan(0);
  expect(history.conflicts.length + history.idle).toBeLessThanOrEqual(host.stats.rewinds);
  for (const c of history.conflicts) expect(c.ports.length).toBeGreaterThan(0);
  const r = new Rebuilder(machine, content);
  expect(r.at(history.head).hash()).toBe(host.engine.hash());
  expect(pathTo(history.head)[0]).toBe(history.root);
  expect(history.root.tick).toBe(host.status.start);
}, 30_000);
