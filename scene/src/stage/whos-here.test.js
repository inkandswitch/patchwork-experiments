// Who's here across links (COMPOSITION.md §6): a viewer's body and held tool
// are the view's, so the view says them on every channel it acts on. A
// person seated at a game linked into a host shows as seated to someone
// viewing the game alone, and entering the game (moving the focus) doesn't
// make them "look" to someone viewing the host. Two views in one page, one
// repo, the page bus the only carrier.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import body from "../parts/body.js";

const SIT = { meta: { id: "t.seatish", traits: ["t.game"] }, module: { create: () => ({ bodies: [{ id: "t.sit", label: "Player 1", here: false, enter: () => ({ input: {} }) }] }) } };
const BODY = { meta: { id: "scene.body" }, module: body };

let cleanups = [];
afterEach(() => {
  for (const c of cleanups.reverse()) c();
  cleanups = [];
  vi.restoreAllMocks();
});

/** A second view on the same repo (the page bus carries between them): `handle` alone, viewer cara. */
async function second(repo, handle) {
  const { default: Stage } = await import("./stage.js");
  const el = document.createElement("div");
  el.repo = repo;
  el.viewerId = "viewer:cara";
  document.body.append(el);
  const unmount = Stage(handle, el);
  cleanups.push(() => {
    unmount();
    el.remove();
  });
  return { el, debug: () => el.querySelector(".scene-stage").__sceneDebug };
}
/** What a view's chip says of `session`, or null if it doesn't list them. */
const rowOf = (el, session) => el.querySelector(`.body-person[data-session="${session}"]`)?.textContent ?? null;

describe("who's here, across links", () => {
  async function setup() {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const game = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card" }) }, order: ["card"], traits: { "t.game": {} } }));
    const s = await mountStage({
      repo,
      viewerId: "viewer:ana",
      extensions: [SIT, BODY],
      doc: { objects: { L: object({ name: "Game", sourceUrl: game.url, providerId: LINK, renderUrl: null }) }, order: ["L"] },
    });
    cleanups.push(() => s.unmount());
    await until(() => s.debug.view.stages().length === 2 && s.debug.view.stages()[1].debug.host.instanceOf("t.seatish"));
    return { s, repo, game, session: s.debug.view.session };
  }

  it("seated at the game linked into a host: someone viewing the game alone sees them seated, not looking", async () => {
    const { s, repo, game, session } = await setup();
    const alone = await second(repo, game);
    await until(() => alone.debug()?.host.instanceOf("scene.body"));
    await until(() => rowOf(alone.el, session) != null);
    expect(rowOf(alone.el, session)).not.toContain("player 1"); // (the harness's start: Edit)
    expect(s.debug.view.enterBody("t.sit", null)).toBeTruthy();
    await until(() => rowOf(alone.el, session)?.includes("player 1"));
    expect(s.debug.view.focusStage().n).toBe(0); // the focus never moved: the host's
  });

  it("entering the game moves the focus, and someone viewing the host still sees what they're doing", async () => {
    const { s, repo, session } = await setup();
    const host = await second(repo, s.handle);
    await until(() => host.debug()?.host.instanceOf("scene.body"));
    expect(s.debug.view.enterBody("t.sit", null)).toBeTruthy();
    await until(() => rowOf(host.el, session)?.includes("player 1"));
    expect(s.debug.view.enter(["L"])).toBeTruthy();
    await settle();
    expect(s.debug.view.focusStage().path).toEqual(["L"]);
    // a heartbeat's worth of time on the host's channel: still seated, never "look"
    await new Promise((r) => setTimeout(r, 50));
    expect(rowOf(host.el, session)).toContain("player 1");
  });
});
