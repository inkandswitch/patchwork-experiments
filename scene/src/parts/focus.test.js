// @vitest-environment happy-dom
// The editor across links (EDITOR.md, "The interface"; HISTORY.md, Kernel step 1 and
// COMPOSITION Decisions): the bar holds the focus path's world commands, the
// inspector's pane follows the focus, putting the editor down puts the
// selection down, and holding it, a click is its wherever it lands.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "../native/link-graph.js";
import { editing } from "./editing.js";
import { keyOf } from "../stage/paths.js";
import { atFocus, selectionStep } from "../stage/selection.js";
import inspector from "./inspector.js";
import toolbar from "./toolbar.js";

const link = (url, extra = {}) => object({ name: "Link", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });
const J = JSON.stringify;

/** Trait parts that record what reaches them, a view plugin, and Enter (scene.links, native). */
function extensions(log) {
  const input = (who) => ({ press: (ev) => (log.push(`${who} ${ev.hit?.id ?? "-"}`), null), click: (ev) => (log.push(`click ${who} ${ev.hit?.id ?? "-"}`), null) });
  return [
    { meta: { id: "t.card", traits: ["t.card"] }, module: { create: () => ({ input: input("t.card") }) } },
    { meta: { id: "t.host", traits: ["t.host"] }, module: { create: () => ({ input: input("t.host") }) } },
    { meta: { id: "t.general", type: "scene:view" }, module: { create: () => ({ input: input("t.general") }) } },
  ];
}

/**
 * Parts that hold something (STAGE.md, "Bodies"): a part of every doc
 * offering a body (as walk is), a view plugin offering a tool (as Measure
 * does), and the host's trait part offering a seat. Each counts its starts.
 */
function holders(started) {
  const count = (id) => (started[id] = (started[id] ?? 0) + 1);
  const body = (id) => ({ id, label: id, enter: () => ({ input: {} }) });
  return [
    { meta: { id: "t.walk", traits: ["*"] }, module: { create: () => (count("t.walk"), { bodies: [body("t.walk")] }) } },
    { meta: { id: "t.measure", type: "scene:view" }, module: { create: () => (count("t.measure"), { commands: [{ id: "measure", name: "Measure", tool: {}, run: () => ({ press: () => null }) }] }) } },
    { meta: { id: "t.seat", traits: ["t.host"] }, module: { create: () => (count("t.seat"), { bodies: [body("t.seat")] }) } },
  ];
}

/**
 * Host A: a table, L and R both live links to B (L acts, the first in path
 * order; R is closed, a repeat), P a pin of B, X a link to a doc that can't
 * be opened. B: a card and M, a live link to C. C: a piece. So the stages
 * are A [], B [L], C [L, M], and B pinned [P] (its M closed: unpinned, the
 * pin holds no C).
 */
async function mountNested({ repo = new FakeRepo(), log = [], extra = [], time = null } = {}) {
  const c = repo.add(emptyScene({ title: "C", objects: { piece: object({ name: "Piece", traits: { "t.card": {} } }) }, order: ["piece"] }));
  const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card", traits: { "t.card": {} } }), M: link(c.url, { name: "C" }) }, order: ["card", "M"] }));
  const objects = {
    table: object({ name: "Table", traits: { "t.host": {} } }),
    L: link(b.url, { name: "B" }),
    R: link(b.url, { name: "B again" }),
    P: link(b.url, { name: "B fixed", at: { heads: b.heads() } }),
    X: link("automerge:2222222222222222222222222222", { name: "Gone" }),
  };
  const s = await mountStage({ repo, time, editor: true, natives: true, extensions: [...extensions(log), ...extra], doc: { title: "A", objects, order: Object.keys(objects) } });
  const view = s.debug.view;
  await until(() => ["L", "L/M", "P"].every((p) => stageOf(view, p)?.debug.host.instanceOf("t.card")) && s.api("t.host")?.use("links").role("X")?.role === "closed" && s.api("t.host")?.use("links").role("R")?.reason === "repeat", 3000);
  return { s, view, repo, b, c, log };
}

const stageOf = (view, p) => view.stages().find((x) => x.path.join("/") === p) ?? null;
// the stages, by path, and what each holds
const STAGES = { "": ["table", "L", "R", "P", "X"], L: ["card", "M"], "L/M": ["piece"], P: ["card", "M"] };
const pathOf = (p) => (p === "" ? [] : p.split("/"));


/** The stages the view plugins have facets of (api.focus()): the focus stage's, once one asks, and no other. */
const facetsAt = (view) => view.stages().filter((x) => x.debug.facets().length).map((x) => x.path.join("/"));
function placed(view) {
  view.plugins.record("scene.links").api.focus();
  expect(facetsAt(view)).toEqual([view.atom.get().focus.join("/")]);
}

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("the bar of tools across docs", () => {
  it("looking, entered in B: the game's and the host's world commands are on the bar, the game's first, the host's worked out in the host's context; it doesn't change under the pointer; each runs where it's from; no editor command shows", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const ran = [];
    const world = (id, name, state) => (api) => ({ commands: [{ id, name, show: ["world"], ...(state ? { state } : {}), run: () => ran.push([id, api.url]) }, { id: `${id}-edit`, name: `${name} (editor)`, show: ["toolbar"], run() {} }] });
    const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card", traits: { "t.game": {} } }) }, order: ["card"] }));
    // the host's applies only where there is a table: in its own doc, never in B's
    const HOST = { meta: { id: "t.host", traits: ["t.host"] }, module: { create: world("ring", "Ring", (t, ctx) => (t == null && ctx.scene.objects.table ? {} : null)) } };
    const GAME = { meta: { id: "t.game", traits: ["t.game"] }, module: { create: world("deal", "Deal") } };
    const objects = { table: object({ name: "Table", traits: { "t.host": {} } }), L: link(b.url, { name: "B" }) };
    s = await mountStage({ repo, editor: true, natives: true, extensions: [HOST, GAME, { meta: { id: "scene.toolbar" }, module: toolbar }], doc: { title: "A", objects, order: Object.keys(objects) } });
    const view = s.debug.view;
    await until(() => stageOf(view, "L")?.debug.host.instanceOf("t.game"), 3000);
    s.edit(false);
    const buttons = (cluster) => [...view.root.querySelectorAll(`.toolbar .${cluster} button`)];
    const labels = (cluster) => buttons(cluster).map((x) => x.textContent);
    await until(() => J(labels("world")) === J(["Ring"]), 2000);
    // outside the game, its command isn't on the focus path
    expect([labels("tools"), labels("world")]).toEqual([[], ["Ring"]]);
    expect(view.enter(["L"])).toBe(true);
    await until(() => J(labels("world")) === J(["Deal", "Ring"]), 2000);
    expect(s.local.get().body.id).toBe("look");
    expect(labels("tools")).toEqual([]);
    // the pointer over B's card, then the host's table, then nothing: the bar stays as it is
    for (const [i, hit] of [{ id: keyOf(stageOf(view, "L").n, "card") }, { id: "table" }, null].entries()) {
      view.viewport.pick = () => (hit ? { ...hit, point: [0, 0, 0], normal: [0, 1, 0], distance: 3 } : null);
      s.pointer("pointermove", 20 + i * 3, 20, { buttons: 0 });
      await settle();
      expect(labels("world")).toEqual(["Deal", "Ring"]);
    }
    for (const x of buttons("world")) x.click();
    expect(ran).toEqual([
      ["deal", b.url],
      ["ring", s.handle.url],
    ]);
  });
});

describe("the drawer follows the focus", () => {
  it("the inspector's pane open as the focus moves stays open, its tree on the linked doc's objects; link rows say what they are and enter", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const c = repo.add(emptyScene({ title: "C", objects: { piece: object({ name: "Piece" }) }, order: ["piece"] }));
    const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card" }), M: link(c.url, { name: "C" }) }, order: ["card", "M"] }));
    const objects = { table: object({ name: "Table" }), L: link(b.url, { name: "B" }), P: link(b.url, { name: "B fixed", at: { heads: b.heads() } }) };
    s = await mountStage({ repo, editor: true, natives: true, extensions: [{ meta: { id: "scene.inspector" }, module: inspector }], doc: { title: "A", objects, order: Object.keys(objects) } });
    const view = s.debug.view;
    await until(() => stageOf(view, "L")?.debug && s.instance("scene.links") && s.api("scene.links")?.use("links").role("P")?.open, 3000);
    s.edit(true);
    s.instance("scene.inspector").tab.open();
    await settle();
    const rows = () => [...view.root.querySelectorAll(".scene-outline .object-row")].map((li) => [li.dataset.id, li.querySelector(".link-mark")?.textContent ?? null, !!li.querySelector(".enter-link")]);
    await until(() => J(rows()) === J([["table", null, false], ["L", "linked", true], ["P", "fixed", false]]), 2000).catch(() => {});
    expect(rows()).toEqual([["table", null, false], ["L", "linked", true], ["P", "fixed", false]]);
    // its Enter goes in; the tab stays, now on B's objects
    view.root.querySelector('.object-row[data-id="L"] .enter-link').click();
    expect(view.atom.get().focus).toEqual(["L"]);
    await until(() => J(rows()) === J([["card", null, false], ["M", "linked", true]]), 2000).catch(() => {});
    expect(rows()).toEqual([["card", null, false], ["M", "linked", true]]);
    // one pane, the tree and the fields together, in the focus doc
    expect(view.root.querySelectorAll('.stage-drawer [data-panel="inspector"]').length).toBe(1);
    expect(view.root.querySelector('.stage-drawer [data-panel="inspector"] .inspector-body .inspector')?.dataset.kind).toBe("scene");
    // a double-click on a link row enters it too
    view.root.querySelector('.object-row[data-id="M"] .row-main').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(view.atom.get().focus).toEqual(["L", "M"]);
    await until(() => J(rows()) === J([["piece", null, false]]), 2000).catch(() => {});
    expect(rows()).toEqual([["piece", null, false]]);
  });
});

describe("putting the editor down puts the selection down; a body doesn't (HISTORY.md, Kernel step 1)", () => {
  // Attention is the selection, so a selection kept from editing would aim F
  // and the use prompt at what was last edited. Every state changed from × to
  // (Look and a walk, each holding the editor or not; a seat over Look) × a
  // selection or none, with the focus two links in (edit-body.test.js has
  // the rule in the scene itself): the selection goes exactly when the
  // editor is put down; the focus never moves. 5 × 5 × 2 = 50 cases.
  const STATES = [["look", false], ["look", true], ["t.walk", false], ["t.walk", true], ["t.seat", false]];
  const FOCI = [["L", "M"]];
  const ELEMENT = { "L/M": "piece" };
  it("every state × every state × a selection or none, two links in: cleared exactly on putting the editor down, the focus kept", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = {};
    const m = await mountNested({ extra: holders(started) });
    s = m.s;
    const { view } = m;
    let cases = 0;
    for (const focus of FOCI) {
      expect(view.focusOn(focus)).toBe(true);
      await placed(view);
      for (const from of STATES)
        for (const to of STATES)
          for (const withSel of [false, true]) {
            const name = `${J(focus)} ${from} → ${to}${withSel ? " selected" : ""}`;
            view.enterBody("look");
            s.edit(from[1]);
            expect(view.enterBody(from[0]), name).toBe(true);
            const sel = withSel ? [...focus, ELEMENT[focus.join("/")]] : null;
            view.select(sel);
            expect(J(view.atom.get().selected), name).toBe(J(sel));
            if (from[0] !== to[0]) expect(view.enterBody(to[0]), name).toBe(true);
            s.edit(to[1]);
            const want = from[1] && !to[1] ? null : sel;
            expect([name, J(view.atom.get().selected), J(view.atom.get().focus)]).toEqual([name, J(want), J(focus)]);
            cases++;
          }
    }
    expect(cases).toBe(50);
  }, 60_000);
});

describe("holding the editor, a click is its wherever it lands (HISTORY.md, COMPOSITION Decisions, Edit's click is Edit's)", () => {
  // HISTORY.md, Kernel step 1: holding the editor a plain click selects, before any package's click verb. Inside an entered
  // link a click on the host can't select, and must not go down the chain either, where a host's click verb
  // would take it. Editing or not × every focus × a selection or none × every thing a click can land on
  // outside the focus (another stage's objects, a pin's and a closed link's), nothing, and a stale hit (which
  // editInput takes as nothing): the click goes down the chain exactly without the editor, or holding it on
  // nothing (or a stale hit) with nothing selected; the selection is selectionStep's (outside the focus:
  // unchanged); the body and the focus never move. Clicks under the focus are the H10 test's above.
  const FOCI = [[], ["L"], ["L", "M"]];
  const ELEMENT = { "": "table", L: "card", "L/M": "piece" };
  // a hit is { key: (view) => the viewport's key, path: the hit's path, or null for nothing }. Stale hits: an id
  // its stage no longer has (removed between the pick and the click), in every stage; a stage no longer there;
  // a malformed key.
  const live = Object.entries(STAGES).flatMap(([sp, ids]) => ids.map((id) => ({ name: `${sp}:${id}`, key: (view) => keyOf(stageOf(view, sp).n, id), path: [...pathOf(sp), id] })));
  const stale = [
    ...Object.keys(STAGES).map((sp) => ({ name: `${sp}:gone (stale)`, key: (view) => keyOf(stageOf(view, sp).n, "gone"), path: null })),
    { name: "a stage no longer there (stale)", key: () => keyOf(999, "card"), path: null },
    { name: "a malformed key (stale)", key: () => "\u001fx\u001fcard", path: null },
    { name: "nothing", key: null, path: null },
  ];
  const HITS = [...live, ...stale];
  it("editing or not × every focus × a selection or none × every hit: down the chain only without the editor or on nothing with nothing selected", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const { view, log } = m;
    let cases = 0;
    for (const focus of FOCI) {
      expect(view.focusOn(focus)).toBe(true);
      await placed(view);
      for (const base of ["look", "edit"])
        for (const withSel of [false, true])
          for (const hit of HITS.filter((h) => !h.path || !atFocus(focus, h.path))) {
            const name = `${base} ${J(focus)}${withSel ? " selected" : ""} click on ${hit.name}`;
            view.enterBody("look");
            s.edit(base === "edit");
            const sel = withSel ? [...focus, ELEMENT[focus.join("/")]] : null;
            view.select(sel);
            expect(J(view.atom.get().selected), name).toBe(J(sel));
            view.viewport.pick = hit.key ? () => ({ id: hit.key(view), point: [0, 0, 0], normal: [0, 1, 0], distance: 3 }) : () => null;
            log.length = 0;
            s.click(20, 20);
            await settle();
            const down = base === "look" || (!hit.path && !withSel);
            const want = base === "look" ? sel : selectionStep({ focus, selected: sel }, { type: "press", path: hit.path ?? [] }).selected;
            expect([name, log.some((x) => x.startsWith("click ")), J(view.atom.get().selected), view.atom.get().body?.id, J(view.atom.get().focus)]).toEqual([name, down, J(want), "look", J(focus)]);
            cases++;
          }
    }
    // per focus, the live hits outside it (none at the scene, whose focus holds every path; 7 one in; 9 two in), and 6 stale and nothing
    expect(cases).toBe(2 * 2 * (7 + 14 + 16));
  }, 60_000);
});
