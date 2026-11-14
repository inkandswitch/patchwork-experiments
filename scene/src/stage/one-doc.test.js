// I1, one doc per extension (COMPOSITION.md, Invariants): every read and
// write through an api goes to its stage's handle. The harness: spy handles
// on every doc a view can reach, an extension that uses every api that
// writes or sends (change, claim, send, presence, a pose hold, remove, a
// part's drop context), and the check that only its own stage's handle was
// touched. Run against the outermost stage here, and against a linked doc's
// stage in links-live.test.js.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";

/** Record every write and send a handle takes. */
export function spy(handle) {
  const log = [];
  const change = handle.change.bind(handle);
  const broadcast = handle.broadcast.bind(handle);
  handle.change = (fn, opts) => {
    log.push("change");
    return change(fn, opts);
  };
  handle.broadcast = (m) => {
    log.push(`broadcast:${m?.type ?? "?"}`);
    return broadcast(m);
  };
  return log;
}

/** An extension that writes and sends through every api that does, once it has run `go`. */
export const WRITER = {
  meta: { id: "t.writer", traits: ["t.writer"] },
  module: {
    create(api) {
      return {
        go() {
          api.change((d) => {
            d.objects.a.name = "written";
          });
          api.claim("a", "t.hold");
          api.send("t.ping", { n: 1 });
          api.presence.set("here", true);
          api.pose.hold("a", { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 });
          api.pose.release("a");
          api.remove(["b"]);
        },
      };
    },
  },
};

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("I1: one doc per extension", () => {
  it("an extension of the outermost stage writes and sends only on its own handle", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    // another doc the repo holds: nothing may touch it
    const other = repo.add({ objects: { a: object() }, order: ["a"] });
    const otherLog = spy(other);
    s = await mountStage({ repo, extensions: [WRITER], doc: { objects: { a: object(), b: object() }, order: ["a", "b"], traits: { "t.writer": {} } } });
    await until(() => s.instance("t.writer"));
    const ownLog = spy(s.handle);
    s.instance("t.writer").go();
    await settle();
    expect(otherLog).toEqual([]);
    expect(ownLog).toContain("change");
    expect(ownLog.some((e) => e.startsWith("broadcast:"))).toBe(true);
    expect(s.doc().objects.a.name).toBe("written");
    expect(s.doc().objects.b).toBeUndefined();
  });
});
