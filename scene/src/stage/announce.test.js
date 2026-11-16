// The announcer (./announce.js): a doc is announced on its first hold and
// retracted on its last release, exactly once each, whatever the order of
// holds and releases; dispose retracts what's still held and silences it.
// Checked over every sequence of up to five steps on two docs.

import { describe, expect, it } from "vitest";
import { createAnnouncer, TOOL_ID } from "./announce.js";

const A = "automerge:a";
const B = "automerge:b";
const STEPS = [
  ["hold", A],
  ["hold", B],
  ["release", A],
  ["release", B],
  ["dispose"],
];

/** Every sequence of `n` steps. */
function* sequences(n) {
  if (n === 0) return yield [];
  for (const rest of sequences(n - 1)) for (const s of STEPS) yield [...rest, s];
}

/** An event target that records what reaches it. */
function recorder() {
  const target = new EventTarget();
  const events = [];
  for (const type of ["patchwork:mounted", "patchwork:unmounted"])
    target.addEventListener(type, (e) => events.push([type === "patchwork:mounted" ? "+" : "-", e.detail.url, e.detail.toolId, e.bubbles, e.composed]));
  return { target, events };
}

describe("createAnnouncer", () => {
  it("announces on the first hold and retracts on the last release, for every sequence", () => {
    for (let n = 0; n <= 5; n++)
      for (const seq of sequences(n)) {
        const { target, events } = recorder();
        const announcer = createAnnouncer(target);
        // the model: holds per url, and whether it's been disposed
        const counts = new Map();
        let disposed = false;
        const want = [];
        for (const [op, url] of seq) {
          if (op === "hold") {
            if (disposed) continue;
            const c = counts.get(url) ?? 0;
            counts.set(url, c + 1);
            if (c === 0) want.push(["+", url]);
            announcer.hold(url);
          } else if (op === "release") {
            const c = counts.get(url) ?? 0;
            if (c === 1) {
              counts.delete(url);
              if (!disposed) want.push(["-", url]);
            } else if (c > 1) counts.set(url, c - 1);
            announcer.release(url);
          } else {
            if (!disposed) for (const url of counts.keys()) want.push(["-", url]);
            counts.clear();
            disposed = true;
            announcer.dispose();
          }
        }
        expect(events.map(([s, url]) => [s, url]), JSON.stringify(seq)).toEqual(want);
        expect(announcer.held(), JSON.stringify(seq)).toEqual([...counts.keys()].sort());
        // every announcement says who and travels out of the view
        for (const [, , toolId, bubbles, composed] of events) expect([toolId, bubbles, composed]).toEqual([TOOL_ID, true, true]);
        // and the announcements pair up: never more retractions than announcements of a url
        for (const url of [A, B]) {
          let open = 0;
          for (const [s, u] of events) if (u === url) expect((open += s === "+" ? 1 : -1)).toBeGreaterThanOrEqual(0);
        }
      }
  });

  it("ignores what isn't a url", () => {
    const { target, events } = recorder();
    const announcer = createAnnouncer(target);
    for (const v of [undefined, null, "", 3]) announcer.hold(v);
    announcer.release("automerge:never-held");
    expect(events).toEqual([]);
  });
});
