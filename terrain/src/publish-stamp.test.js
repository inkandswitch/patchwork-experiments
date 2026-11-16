// @vitest-environment node
// What both publishers send (probes/publish-stamp.mjs): a dry run in a
// checkout that was never synced goes on unstamped and says so; a real
// publish there stops; where the packages have urls, the scene is stamped
// and checked. Every case.
import { describe, it, expect } from "vitest";
import { publishDocs } from "../probes/publish-stamp.mjs";

const snap = {
  scene: "automerge:scene",
  docs: {
    "automerge:scene": { "@patchwork": { type: "scene" }, claims: { a: 1 }, objects: { o: { claims: { b: 2 }, x: 1 } } },
    "automerge:me": { "@patchwork": { type: "contact" } },
    "automerge:glb": { "@patchwork": { type: "file" } },
  },
};
const unsynced = { withPackages: () => { throw new Error("scene has no .pushwork/config.json"); }, packageProblems: () => [] };
const synced = (problems = []) => ({ withPackages: (d, pkgs) => ({ ...d, packages: pkgs.map((p) => ({ url: p })) }), packageProblems: () => problems });

describe("the docs a publisher sends", () => {
  it("leave out the contact doc and every claim, in each case", () => {
    for (const [dry, io] of [[true, unsynced], [false, unsynced], [true, synced()], [false, synced()]]) {
      const { docs } = publishDocs(snap, ["scene"], { dry, ...io });
      expect(Object.keys(docs).sort()).toEqual(["automerge:glb", "automerge:scene"]);
      expect(docs["automerge:scene"].claims).toBeUndefined();
      expect(docs["automerge:scene"].objects.o).toEqual({ x: 1 });
    }
    expect(snap.docs["automerge:scene"].claims).toEqual({ a: 1 });
  });
  it("in a checkout never synced: a dry run goes on unstamped and says why; a real publish stops", () => {
    const dry = publishDocs(snap, ["scene"], { dry: true, ...unsynced });
    expect(dry.problems).toEqual([]);
    expect(dry.note).toMatch(/aren't stamped \(scene has no \.pushwork\/config\.json\)/);
    expect(dry.docs["automerge:scene"].packages).toBeUndefined();
    const real = publishDocs(snap, ["scene"], { dry: false, ...unsynced });
    expect(real.problems).toEqual(["scene has no .pushwork/config.json"]);
    expect(real.note).toBe(null);
  });
  it("where the packages have urls: stamped, its problems reported whether dry or not", () => {
    for (const dry of [true, false]) {
      const ok = publishDocs(snap, ["scene", "terrain"], { dry, ...synced() });
      expect(ok.docs["automerge:scene"].packages).toEqual([{ url: "scene" }, { url: "terrain" }]);
      expect([ok.problems, ok.note]).toEqual([[], null]);
      expect(publishDocs(snap, ["scene"], { dry, ...synced(["packages doesn't list terrain"]) }).problems).toEqual(["packages doesn't list terrain"]);
    }
  });
});
