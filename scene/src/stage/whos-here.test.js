// @vitest-environment happy-dom
// Who's here across links (STAGE.md, "Views, stages and links"): a viewer's body and held tool
// are the view's, so the view says them on every channel it acts on. A
// person seated at a game linked into a host shows as seated to someone
// viewing the game alone, and entering the game (moving the focus) doesn't
// make them "look" to someone viewing the host. Two views in one page, one
// repo, the page bus the only carrier, on one manual clock (presence's
// coalescing and heartbeat run on it, so "never" is checked frame by frame
// past a heartbeat).

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK, linkOpener } from "../test/links.js";
import { manualTime } from "./time.js";
import { DEFAULT_HZ, HEARTBEAT_MS } from "./presence.js";

const SIT = { meta: { id: "t.seatish", traits: ["t.game"] }, module: { create: () => ({ bodies: [{ id: "t.sit", label: "Player 1", here: false, enter: () => ({ input: {} }) }] }) } };
// a part of every doc: what its doc's channel says of each person there is what this view knows of them
const PEERS = { meta: { id: "t.peers" }, module: { create: () => ({}) } };

let cleanups = [];
afterEach(() => {
  for (const c of cleanups.reverse()) c();
  cleanups = [];
  vi.restoreAllMocks();
});

/** A second view on the same repo (the page bus carries between them): `handle` alone, viewer cara. */
async function second(repo, handle, time) {
  const { default: Stage } = await import("./stage.js");
  const el = document.createElement("div");
  el.repo = repo;
  el.viewerId = "viewer:cara";
  el.time = time;
  document.body.append(el);
  const unmount = Stage(handle, el);
  cleanups.push(() => {
    unmount();
    el.remove();
  });
  return { el, debug: () => el.querySelector(".scene-stage").__sceneDebug };
}
/** The body a view's outermost doc's channel says `session` is in, or null if it doesn't list them. */
const bodyOf = (view, session) => view.debug()?.host.record("t.peers")?.api.channel.peers()[session]?.body?.id ?? null;

describe("who's here, across links", () => {
  async function setup() {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const time = manualTime();
    const repo = new FakeRepo();
    const game = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card" }) }, order: ["card"], traits: { "t.game": {} } }));
    const s = await mountStage({
      repo,
      viewerId: "viewer:ana",
      time,
      extensions: [SIT, PEERS, linkOpener()],
      doc: { objects: { L: object({ name: "Game", sourceUrl: game.url, providerId: LINK, renderUrl: null }) }, order: ["L"] },
    });
    cleanups.push(() => s.unmount());
    await time.until(() => s.debug.view.stages().length === 2 && s.debug.view.stages()[1].debug.host.instanceOf("t.seatish"), { what: "the linked game's seat" });
    return { s, repo, game, time, session: s.debug.view.session };
  }

  it("seated at the game linked into a host: someone viewing the game alone sees them seated, not looking", async () => {
    const { s, repo, game, time, session } = await setup();
    const alone = await second(repo, game, time);
    await time.until(() => bodyOf(alone, session) != null, { what: "the game's channel listing ana" });
    expect(bodyOf(alone, session)).toBe("look");
    expect(s.debug.view.enterBody("t.sit", null)).toBeTruthy();
    await time.until(() => bodyOf(alone, session) === "t.sit", { what: "ana seated, on the game's channel" });
    expect(s.debug.view.focusStage().n).toBe(0); // the focus never moved: the host's
  });

  it("entering the game moves the focus, and someone viewing the host still sees what they're doing", async () => {
    const { s, repo, time, session } = await setup();
    const host = await second(repo, s.handle, time);
    await time.until(() => bodyOf(host, session) != null, { what: "the host's channel listing ana" });
    expect(s.debug.view.enterBody("t.sit", null)).toBeTruthy();
    await time.until(() => bodyOf(host, session) === "t.sit", { what: "ana seated, on the host's channel" });
    expect(s.debug.view.enter(["L"])).toBeTruthy();
    await settle();
    expect(s.debug.view.focusStage().path).toEqual(["L"]);
    // past a heartbeat and a send interval on the host's channel, frame by
    // frame: whatever the focus move sent there has arrived, and ana is still
    // seated, never "look"
    const frames = Math.ceil((HEARTBEAT_MS + 1000 / DEFAULT_HZ) / time.frameMs) + 2;
    for (let i = 0; i < frames; i++) {
      await time.step(1, { draw: false });
      const b = bodyOf(host, session);
      if (b !== "t.sit") throw new Error(`frame ${i} after Enter: the host's channel says ${JSON.stringify(b)}`);
    }
  });
});
