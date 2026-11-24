// Where a playing peer's memory goes over a long session: one peer playing
// Doom on virtual time for ten minutes, measured each minute (after a GC):
// the process's heap and array buffers, and the host's own holdings. Run
// with and without the player's history (patchwork/tool.js records one), to
// tell the history's share from the host's.
//   MINUTES=3 HISTORY=1 EVERY=600 node --expose-gc node_modules/vitest/vitest.mjs run --config bench/vitest.config.js bench/memory/memory.test.js
import { readFileSync } from "node:fs";
import { initSubduction } from "@automerge/automerge-repo";
import { SimNet } from "../../src/host/simnet.js";
import { rig, run } from "../../src/host/harness.js";
import { content as doomContent } from "../../src/doom.js";
import { History } from "../../src/history/history.js";

const root = new URL("../../", import.meta.url);
const wasm = readFileSync(new URL("engines/doom/dist/doom.wasm", root));
const content = doomContent({ wads: [readFileSync(new URL("engines/doom/test/freedoom1.wad", root))], args: ["-skill", "3", "-warp", "1", "1", "-players", "1"] });
await initSubduction();
// Walk and turn in a slow loop, so the world changes.
const input = (p, t) => {
  const b = new Uint8Array(6);
  b[0] = t % 140 < 100 ? 25 : 0;
  b[3] = t % 140 >= 100 ? 0x04 : 0;
  return b;
};
const { session } = await rig({ wasm, content, input });
const MB = (n) => Math.round(n / 1e5) / 10;
const minutes = +(process.env.MINUTES ?? 10);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// One case per process (HISTORY=0|1), so one doesn't count the other's
// leftovers; EVERY sets the checkpoint period in seconds (the Machine view
// uses 600 for Doom).
const cases = [{ history: process.env.HISTORY !== "0", every: +(process.env.EVERY ?? 600) }];
test.each(cases)("Doom for some minutes, history $history, checkpoints every $every s", async ({ history, every }) => {
  const h = history ? new History({ inputBytes: 6, keep: 600 * 35 }) : null;
  const { peers } = await session(new SimNet({ latency: [20] }), 1, { seconds: { every }, ...(h ? { trace: h.record } : {}) });
  const [p] = peers;
  p.port = 0;
  p.host.sit(0);
  const rows = [];
  for (let m = 0; m <= minutes; m++) {
    if (m) await run(peers, 60_000);
    globalThis.gc?.();
    const u = process.memoryUsage();
    rows.push({
      min: m,
      tick: p.host.tick,
      heapMB: MB(u.heapUsed),
      buffersMB: MB(u.arrayBuffers),
      rssMB: MB(u.rss),
      docs: Object.keys(p.repo.handles).length,
      histNodes: h?.size,
      histConflicts: h?.conflicts.length,
    });
  }
  console.table(rows);
}, 1_800_000);
