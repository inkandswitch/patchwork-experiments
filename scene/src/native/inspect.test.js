// The natives' `inspect()` (CONVENTIONS.md, "Inspect"): each a frozen
// plain-JSON snapshot of what it holds, read with collect("inspect"). On one
// stage: a claim, a pose hold, a process, an audience policy and a link.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./link-graph.js";

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

const T = { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 };

describe("the natives' inspect snapshots", () => {
  it("claims, poses, clock, audience and links each say what they hold, as frozen plain data, who never what", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const b = repo.add(emptyScene({ title: "B", objects: { c: object({ name: "C" }) }, order: ["c"] }));
    const t = {
      meta: { id: "t.x" },
      module: {
        create: () => {
          return { audience: () => (id) => (id === "x" ? { show: ["viewer:ana", "viewer:ben"], only: ["viewer:ana"] } : null) };
        },
      },
    };
    const objects = { x: object({ name: "X" }), y: object({ name: "Y" }), L: object({ name: "B", sourceUrl: b.url, providerId: LINK, renderUrl: null }) };
    s = await mountStage({ repo, extensions: [t], doc: { objects, order: Object.keys(objects) }, viewerId: "viewer:ana" });
    await until(() => s.debug.view.stageAt(["L"]), 2000);
    // (t.x runs in every doc: the outermost's)
    const api = s.api("t.x");
    api.use("claims").claim("x", "helm");
    api.use("poses").hold("y", T, { yields: true });
    api.use("clock").process({ step() {} });
    await settle();
    const by = Object.fromEntries(s.debug.view.collect("inspect").filter((c) => c.stage === 0).map(({ id, value }) => [id, value()]));
    const session = api.channel.session;
    // (the process makes this view the clock's computer: the scene's "clock" claim, first)
    expect(by["scene.claims"]).toEqual({
      claims: [
        { id: null, kind: "clock", viewer: "viewer:ana", session, mine: true, ext: "scene.clock", lapsing: false },
        { id: "x", kind: "helm", viewer: "viewer:ana", session, mine: true, ext: "t.x", lapsing: false },
      ],
    });
    expect(by["scene.poses"]).toMatchObject({ holds: [{ id: "y", session, ext: "t.x", yields: true, landed: false, mine: true, rank: 0 }] });
    expect(by["scene.clock"]).toMatchObject({ running: true, computing: true, computer: { viewer: "viewer:ana", session, mine: true }, processes: { "t.x": 1 } });
    expect(by["scene.audience"]).toEqual({ objects: [{ id: "x", audience: ["viewer:ana"], shown: ["viewer:ana", "viewer:ben"], veiled: false }] });
    expect(by["scene.links"]).toEqual({ stages: [{ path: ["L"], role: "acting", open: true, url: b.url }] });
    for (const v of Object.values(by)) {
      expect(Object.isFrozen(v)).toBe(true);
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    }
  });
});
