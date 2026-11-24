// Ephemeral traffic, and what rate-limiting it costs. The host sends its
// port's inputs at most once per `send` ms (on average; frames quantize),
// each message carrying everything not yet sent plus the last 8, so a lost
// message costs nothing. Real engines through the host on SimNet, in
// virtual time: 4 players for 20 s at 150 ms one-way (fixed, lossless),
// all pairs linked (mesh) or every peer linked to a hub alone (a sync
// server, as Patchwork has), at send = every frame, 1/30 s and 1/20 s. Then
// on a hub at 1/30 s, 2, 3 and 4 players.
//
// Per peer, per second: the messages it broadcast (inputs, clock pings and
// answers, requests for gaps), the ephemeral messages it sent on the wire
// and received, and the payload bytes received; rollbacks and ticks
// re-stepped; and how far the frontier trails the head, mean, in ticks.
// automerge-repo forwards every ephemeral message it has not seen to every
// peer but its originator, so on the wire a peer also relays what it hears:
// on a mesh to the others, on a hub back to the hub, which drops it.
//
//   pnpm bench:traffic        (Doom needs engines/doom/test/freedoom1.wad)
import { existsSync, readFileSync } from "node:fs";
import { initSubduction, DocHandle } from "@automerge/automerge-repo";
import { SimNet } from "../src/host/simnet.js";
import { rig, run, FRAME } from "../src/host/harness.js";
import { content as doomContent, demo } from "../src/doom.js";
import { FOUR_PLAYERS, pads, B, Y, A, X, LEFT, RIGHT } from "../engines/snes/test/unarmed.js";

await initSubduction();
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const here = (p) => new URL(p, import.meta.url);
const iwad = process.env.FREEDOOM1 ?? here("../engines/doom/test/freedoom1.wad").pathname;
const PLAY = 20; // s
const rows = [];

const FIGHT = [[0, 30, RIGHT], [30, 40, Y], [40, 46, A], [46, 76, LEFT], [76, 86, X], [86, 92, B], [92, 110, RIGHT | Y]];
// Each pad fights on its own pattern from the start: input changes often.
function fight(port, frame) {
  const phase = (frame + 41 * port) % 150;
  let b = 0;
  for (const [from, to, buttons] of FIGHT) if (phase >= from && phase < to) b |= buttons;
  return new Uint8Array([b & 0xff, b >> 8]);
}

async function measure(r, { name, n, send, hub }) {
  const net = new SimNet({ latency: [150], hub: hub ? "hub" : null });
  const { peers } = await r.session(net, n, { seconds: { chunk: 1, every: 600, roll: 600 }, send, budget: Infinity });
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 1000);
  const before = new Map(peers.map((p) => [p.name, { ...net.by.get(p.name) }]));
  const hubBefore = hub ? { ...net.by.get("hub") } : null;
  const stats0 = peers.map((p) => ({ ...p.host.stats }));
  let broadcasts = 0;
  const broadcast = DocHandle.prototype.broadcast;
  DocHandle.prototype.broadcast = function (m) {
    broadcasts++;
    return broadcast.call(this, m);
  };
  let lag = 0, samples = 0;
  for (let k = 0; k < (PLAY * 1000) / FRAME; k++) {
    await run(peers, FRAME);
    for (const p of peers) lag += Math.max(0, p.host.tick - p.host.frontier);
    samples += peers.length;
  }
  DocHandle.prototype.broadcast = broadcast;
  const per = (key) => peers.reduce((s, p) => s + net.by.get(p.name)[key] - before.get(p.name)[key], 0) / n / PLAY;
  const row = {
    run: name, n, send: send === 0 ? "frame" : `${Math.round(1000 / send)}/s`, topology: hub ? "hub" : "mesh",
    broadcast: Math.round(broadcasts / n / PLAY), sent: Math.round(per("ephemeral")), received: Math.round(per("received")), bytesIn: Math.round(per("receivedBytes")),
    hubOut: hub ? Math.round((net.by.get("hub").ephemeral - hubBefore.ephemeral) / PLAY) : "",
    rollbacks: Math.round((10 * peers.reduce((s, p, i) => s + p.host.stats.rewinds - stats0[i].rewinds, 0)) / n / PLAY) / 10,
    restepped: Math.round((10 * peers.reduce((s, p, i) => s + p.host.stats.restepped - stats0[i].restepped, 0)) / n / PLAY) / 10,
    frontierLag: Math.round((10 * lag) / samples) / 10,
  };
  await r.settle(peers);
  rows.push(row);
  console.log(JSON.stringify(row));
}

const SENDS = [0, 1000 / 30, 1000 / 20];

test("Super NES, 4 players fighting", async () => {
  const snes = await rig({
    wasm: readFileSync(here("../engines/snes/dist/snes.wasm")),
    content: new Uint8Array(readFileSync(here("../engines/snes/test/unarmed.sfc"))),
    input: (p, t) => fight(p.port ?? 0, t),
  });
  for (const hub of [false, true]) for (const send of SENDS) await measure(snes, { name: "snes", n: 4, send, hub });
  for (const n of [2, 3]) await measure(snes, { name: "snes", n, send: 1000 / 30, hub: true });
}, 1_800_000);

const doomTest = existsSync(iwad) ? test : test.skip;
doomTest("Doom, 4-player bot demo", async () => {
  const bot = demo(readFileSync(here("../engines/doom/test/bot4p.lmp")));
  const doom = await rig({
    wasm: readFileSync(here("../engines/doom/dist/doom.wasm")),
    content: doomContent({ wads: [readFileSync(iwad)], args: bot.args }),
    input: (p, t) => bot.tics[t % bot.tics.length].subarray(p.port * 6, p.port * 6 + 6),
  });
  for (const hub of [false, true]) for (const send of SENDS) await measure(doom, { name: "doom", n: 4, send, hub });
  for (const n of [2, 3]) await measure(doom, { name: "doom", n, send: 1000 / 30, hub: true });
}, 1_800_000);

afterAll(() => console.table(rows));
