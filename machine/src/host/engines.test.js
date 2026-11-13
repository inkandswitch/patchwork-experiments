// The host with the real engines: four peers of Chocolate Doom, and of a
// Super NES running Unarmed (five pads; the fifth stays vacant), over the WAN table with ephemeral loss, one of
// them joining late from a checkpoint. The host knows nothing about either;
// these are the toy's scenarios with real programs in the engine's place.
import { existsSync, readFileSync } from "node:fs";
import { initSubduction } from "@automerge/automerge-repo";
import { SimNet } from "./simnet.js";
import { rig, run, FRAME, WAN, LOSSY, SKEWS } from "./harness.js";
import { content as doomContent, demo } from "../doom.js";
import { FOUR_PLAYERS, pads } from "../../engines/snes/test/unarmed.js";

await initSubduction();
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const doomDir = new URL("../../engines/doom/test/", import.meta.url);
const iwadPath = process.env.FREEDOOM1 ?? new URL("freedoom1.wad", doomDir).pathname;

// Three peers play; a fourth opens the session partway through (from the
// newest checkpoint), takes the last port, and plays too.
async function play({ session, peer, open, settle }, seconds) {
  const net = new SimNet({ latency: WAN, loss: LOSSY });
  const { peers, url } = await session(net, 3, { seconds });
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  await run(peers, 4000);
  const d = peer(net, "d", SKEWS[3]);
  let done = false;
  open(d, url).then(() => (done = true));
  while (!done) await run(peers, FRAME);
  peers.push(d);
  d.port = 3;
  d.host.sit(3);
  await run(peers, 3000);
  expect(d.host.status.start).toBeGreaterThan(0);
  await settle(peers);
}

const doom = existsSync(iwadPath) ? test : test.skip;
doom("Doom (needs engines/doom/test/freedoom1.wad): four peers, one late, agree with the durable record", async () => {
  const bot = demo(readFileSync(new URL("bot4p.lmp", doomDir)));
  const r = await rig({
    wasm: readFileSync(new URL("../../engines/doom/dist/doom.wasm", import.meta.url)),
    content: doomContent({ wads: [readFileSync(iwadPath)], args: bot.args }),
    // Each port plays the bot's recorded ticcmds, at the tick its clock says.
    input: (p, t) => bot.tics[t % bot.tics.length].subarray(p.port * 6, p.port * 6 + 6),
  });
  await play(r, { chunk: 1, every: 2, roll: 5 });
}, 120_000);

test("Super NES, Unarmed: four peers, one late, agree with the durable record", async () => {
  const r = await rig({
    wasm: readFileSync(new URL("../../engines/snes/dist/snes.wasm", import.meta.url)),
    content: new Uint8Array(readFileSync(new URL("../../engines/snes/test/unarmed.sfc", import.meta.url))),
    // The engine has five pads of two bytes; the script drives the first four.
    input: (p, t) => pads(FOUR_PLAYERS, t).subarray(p.port * 2, p.port * 2 + 2),
  });
  await play(r, { chunk: 1, every: 2, roll: 5 });
}, 120_000);
