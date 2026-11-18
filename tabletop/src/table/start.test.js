// Start game (start.js, the table extension's world verb) on a table laid
// out from a recipe (contract/v2/fixtures/valid/recipe.json: a deck shuffled,
// dealt into each seat's tray and drawn onto a market, who goes first),
// against both keepers: the plain one (a real container: its slots permuted,
// each viewer's looks), and the joint one (real clients: the deal goes into
// the hands before the players' first shuffle, and once it's done each sees
// their own hand and the market, never the other's). Seats are the stand-in's.
import { afterEach, describe, it, expect, vi } from "vitest";
import Extension from "./extension.js";
import { START, runStart, startOf, startState } from "./start.js";
import { audienceOf, seatAt, zones } from "./visibility.js";
import { testScene } from "./test-scene.js";
import { tableLayout, writeTable } from "../setup.js";
import { prepareTable } from "./made-with.js";
import { emptyScene } from "../empty-scene.js";
import PlainKeeper from "../keep/plain-keeper.js";
import { create as jointKeeper } from "../keep/joint-keeper.js";
import { newSecret } from "../keep/crypto/derive.js";
import * as fakes from "../test/fakes.js";
import { SEATS, keptIn, registries, roster, seatsPlugin } from "../test/stand-ins.js";
import { seeded } from "../test/games.js";
import { applyRecipe } from "../../contract/v2/recipe.js";

import recipe from "../../contract/v2/fixtures/valid/recipe.json" with { type: "json" };
const BACK = { min: [-0.02, 0, -0.03], max: [0.02, 0.0005, 0.03] };
const fileOf = (kind) => ({ url: `automerge:2File${kind.padEnd(20, "x")}abcdefghij`, hint: { bounds: kind === "back" ? BACK : { min: [-0.01, 0, -0.01], max: [0.01, 0.01, 0.01] } } });
const VIEWERS = { a: "ann", b: "ben", c: "cal" };

/** The fake world's repo, its docs under URLs a keeper takes for a doc's (base58). */
function repoOf() {
  const r = fakes.fakeRepo();
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0;
  r.create2 = async (doc) => r.add(doc, `automerge:2Doc${B58[n++]}abcdefghijkmnopqrstuv`);
  return r;
}

/** The recipe's table for these options, written as the session writer writes it: its containers in `repo`, its seats by the stand-in. */
async function laidTable(options, { secure = false, repo = repoOf() } = {}) {
  const g = applyRecipe(recipe, options);
  if (secure) g.setup.find((t) => t.id === "deck").deck.secure = true;
  const layout = tableLayout(g, { fileOf, rng: seeded(5) });
  const regs = registries(seatsPlugin());
  const made = await prepareTable({ repo, registry: async (type) => regs[type] ?? null }, layout);
  const doc = emptyScene();
  writeTable(doc, layout, made);
  return { g, layout, doc, repo };
}

/** Who may see what, by the table's own policy, as the stage's audience says it: "all", the viewers, or nobody ([]). */
const audienceIn = (snap) => {
  const policy = audienceOf(snap, roster.seats(snap));
  return (id) => policy(id)?.show ?? [];
};

describe("the start plan, resolved when the table is laid out (pure)", () => {
  for (const players of [2, 3])
    it(`for ${players}: the deck's cards shuffled, dealt into every seat's tray, three face up on the market; who goes first`, async () => {
      const { g, doc } = await laidTable({ players });
      const plan = startOf(testScene(doc.objects, doc.traits));
      expect(plan.started).toBe(null);
      expect(plan.steps.map((s) => Object.keys(s)[0])).toEqual(players === 2 ? ["shuffle", "deal", "deal", "draw", "first"] : ["shuffle", "deal", "draw", "first"]);
      const cards = Object.keys(doc.objects).filter((id) => doc.objects[id].traits?.["tabletop.card"]);
      expect(plan.steps[0].shuffle.sort()).toEqual([...cards].sort());
      // where every move goes, in a scene where it has gone
      const moved = structuredClone(doc.objects);
      const moves = plan.steps.flatMap((s) => s.moves ?? []);
      for (const [id, t] of moves) moved[id].transform = { ...t, scale: 1 };
      const snap = testScene(moved, doc.traits);
      const regions = zones(snap);
      const at = (id) => snap.world(id).slice(12, 15);
      const per = {};
      for (const [id] of moves) per[seatAt(snap, regions, at(id)) ?? "table"] = (per[seatAt(snap, regions, at(id)) ?? "table"] ?? 0) + 1;
      const each = players === 2 ? 3 : 2;
      expect(per).toEqual({ ...Object.fromEntries(Object.keys(g.seats).map((s) => [s, each])), table: 3 });
      // each card moved once, to a place of its own, face up (its +Y up), resting on what it lies on
      expect(new Set(moves.map(([id]) => id)).size).toBe(moves.length);
      expect(new Set(moves.map(([, t]) => t.position.map((v) => v.toFixed(4)).join())).size).toBe(moves.length);
      for (const [id] of moves) expect(snap.world(id)[5]).toBeCloseTo(1, 9);
      // the market's three lie on its three snap points
      const market = Object.keys(doc.objects).find((id) => doc.objects[id].name === "Market");
      const onMarket = moves.filter(([id]) => !seatAt(snap, regions, at(id))).map(([id]) => snap.toLocal(market, at(id)).map((v) => +v.toFixed(6) + 0));
      expect(onMarket).toEqual(recipe.pieces.market.snapPoints.map((s) => s.position));
    });
});

describe("Start game, with the plain keeper", () => {
  afterEach(() => vi.useRealTimers());

  async function table(players = 2) {
    const t = await laidTable({ players });
    const w = fakes.fakeWorld(t.doc, { repo: t.repo });
    const join = (session, viewer) => {
      const api = w.join(session, { viewer });
      const keeper = PlainKeeper.create(api);
      const x = w.attach(session, Extension.create(api));
      w.view(session).collected = { roster, keeper: keeper.keeper };
      w.view(session).audience = (id) => audienceIn(api.scene())(id);
      w.view(session).shown = (id) => audienceIn(api.scene())(id);
      return { api, keeper, x, seen: () => keeper.update(api.scene()) };
    };
    const A = join("A", "ann");
    const B = join("B", "ben");
    w.flush();
    A.seen();
    B.seen();
    await vi.advanceTimersByTimeAsync(10);
    const cmd = (who) => who.x.commands.find((c) => c.id === "start");
    const state = (who) => cmd(who).state(null, { scene: who.api.scene() });
    const sit = (seats) => {
      for (const [sid, v] of Object.entries(seats)) w.doc.traits[SEATS][sid].player = v;
      w.flush();
    };
    const container = () => {
      const by = keptIn(Object.values(w.doc.objects).find((o) => keptIn(o)))?.by;
      return t.repo.handles.get(by).doc();
    };
    return { ...t, w, A, B, cmd, state, sit, container, notices: (s) => w.view(s).notices.map((n) => n.text) };
  }

  it("is the table's: on the bar of tools in every body and the menu, for the scene alone; disabled until every seat is taken, saying whose", async () => {
    const t = await table();
    expect(t.cmd(t.A)).toMatchObject({ name: "Start game", show: ["menu", "world"] });
    expect(t.cmd(t.A).state("o0001", { scene: t.A.api.scene() })).toBe(null);
    expect(t.state(t.A)).toEqual({ disabled: true, title: "Every seat must be taken to start: waiting for A, B" });
    t.sit({ a: "ann" });
    expect(t.state(t.A)).toEqual({ disabled: true, title: "Every seat must be taken to start: waiting for B" });
    t.cmd(t.A).run(null);
    expect(t.w.doc.traits[START].started).toBe(null);
    t.sit({ b: "ben" });
    expect(t.state(t.A)).toEqual({ title: "Start the game: shuffle, deal 2 to each seat, deal 1 to each seat, lay out 3, choose who goes first" });
    t.w.done();
  });

  it("shuffles the deck through its keeper, deals into each tray and onto the market in one change; each sees their own hand and the market, never the other's", async () => {
    const t = await table();
    t.sit({ a: "ann", b: "ben" });
    const before = [...t.container().at];
    const changes = vi.spyOn(t.A.api, "change");
    vi.spyOn(Math, "random").mockReturnValue(0);
    t.cmd(t.A).run(null);
    vi.mocked(Math.random).mockRestore();
    // the keeper's container: its slots permuted (Math.random 0 every draw: each slot swapped with the first, never the identity)
    expect(t.container().at).not.toEqual(before);
    expect([...t.container().at].sort((x, y) => x - y)).toEqual([...before].sort((x, y) => x - y));
    expect(changes).toHaveBeenCalledTimes(1);
    t.w.flush();
    const snap = t.A.api.scene();
    const regions = zones(snap);
    const cards = Object.keys(snap.objects).filter((id) => snap.objects[id].traits?.["tabletop.card"]);
    const where = (id) => seatAt(snap, regions, snap.world(id).slice(12, 15)) ?? (Math.abs(snap.world(id)[14] + 0.25) < 0.01 ? "market" : "deck");
    const count = (w) => cards.filter((id) => where(id) === w).length;
    expect([count("a"), count("b"), count("market"), count("deck")]).toEqual([3, 3, 3, 3]);
    // who may see what: a hand its seat's alone, the market everyone's, the deck nobody's
    const aud = audienceIn(snap);
    for (const id of cards) expect(aud(id)).toEqual({ a: ["ann"], b: ["ben"], market: "all", deck: [] }[where(id)]);
    // and what each viewer's keeper shows them
    t.A.seen();
    t.B.seen();
    await vi.advanceTimersByTimeAsync(10);
    const shown = (who) => [...who.keeper.showing().keys()].map(where).sort();
    expect(shown(t.A)).toEqual(["a", "a", "a", "market", "market", "market"]);
    expect(shown(t.B)).toEqual(["b", "b", "b", "market", "market", "market"]);
    // told as a count; who goes first in the HUD, by the seat's name (Math.random 0: the first seat)
    expect(t.notices("A")).toEqual(["You started the game, dealing 2 to each seat"]);
    expect(t.notices("B")).toEqual(["<ann> started the game, dealing 2 to each seat"]);
    expect(t.w.doc.traits[START].started).toEqual({ first: "a" });
    expect(t.B.x.hud()).toEqual([{ text: "A goes first.", state: "info" }]);
    t.w.done();
  });

  it("once started it says so, and Start again changes nothing (pressed on two peers, the second sees it started)", async () => {
    const t = await table();
    t.sit({ a: "ann", b: "ben" });
    t.cmd(t.A).run(null);
    t.w.flush();
    const after = structuredClone(t.w.doc);
    const items = [...t.container().at];
    expect(t.state(t.B)).toEqual({ disabled: true, label: "Game started", title: "This game has started" });
    t.cmd(t.B).run(null);
    t.w.flush();
    expect(t.w.doc).toEqual(after);
    expect(t.container().at).toEqual(items);
    t.w.done();
  });

  it("for three: two dealt to each of the three trays", async () => {
    const t = await table(3);
    t.sit({ a: "ann", b: "ben", c: "cal" });
    t.cmd(t.A).run(null);
    t.w.flush();
    const snap = t.A.api.scene();
    const regions = zones(snap);
    const cards = Object.keys(snap.objects).filter((id) => snap.objects[id].traits?.["tabletop.card"]);
    const per = {};
    for (const id of cards) {
      const s = seatAt(snap, regions, snap.world(id).slice(12, 15));
      if (s) per[s] = (per[s] ?? 0) + 1;
    }
    expect(per).toEqual({ a: 2, b: 2, c: 2 });
    t.w.done();
  });
});

describe("Start game, with the joint keeper (a secure deck)", () => {
  const until = async (fn, ms = 60000) => {
    for (const t0 = Date.now(); !fn(); await new Promise((r) => setTimeout(r, 10))) if (Date.now() - t0 > ms) throw new Error("timed out");
  };

  it("deals into the hands before the players' first shuffle; the start's shuffle follows it, every player taking part; then each sees their own hand and the market", async () => {
    const t = await laidTable({ players: 2 }, { secure: true });
    let objects = t.doc.objects;
    const traits = t.doc.traits;
    t.doc.traits[SEATS].a.player = "ann";
    t.doc.traits[SEATS].b.player = "ben";
    const snapOf = () => testScene(objects, traits);
    const deckUrl = keptIn(Object.values(objects).find((o) => keptIn(o)?.kind === "joint")).by;
    const clients = {};
    for (const viewer of ["ann", "ben"]) {
      const secret = newSecret();
      const api = {
        repo: t.repo,
        writable: () => true,
        channel: { viewer },
        settled: () => ({ ready: true, missing: [] }),
        collect: (name) => (name === "roster" ? [{ id: "seats", value: roster }] : []),
        use: (n) => (n === "audience" ? { audience: (id) => audienceIn(snapOf())(id), shown: (id) => audienceIn(snapOf())(id), veil: () => () => {} } : n === "notices" ? { notify() {}, changed() {} } : null),
        display: () => () => {},
      };
      clients[viewer] = jointKeeper(api, { secret: () => secret });
    }
    const update = () => Object.values(clients).forEach((c) => c.update(snapOf()));
    update();
    const deck = async () => (await t.repo.find(deckUrl)).doc();
    // both clients have joined the deck: its first shuffle is about to start
    for (const viewer of ["ann", "ben"]) await until(() => t.repo.handles.get(deckUrl).doc().participants?.some((p) => p.id === viewer));
    // Start: the deal moves objects, whatever the shuffle makes them
    const plan = startOf(snapOf());
    const done = runStart({
      scene: snapOf(),
      seats: roster.seats(snapOf()),
      keeperOf: () => clients.ann.keeper,
      change: (fn) => {
        const d = structuredClone({ objects, traits });
        fn(d);
        objects = d.objects;
        Object.assign(traits, d.traits);
      },
      setTransform: (_s, id, tr) => (d) => (d.objects[id].transform = tr),
      random: () => 0,
    });
    expect(done).toEqual({ dealt: 2, moved: 9, first: "a" });
    // the start's shuffle is queued in the deck, for every player to take part in, after the first
    expect((await deck()).queue.at(-1).offsets).toHaveLength(plan.steps[0].shuffle.length);
    update();
    // both shuffles done: every card two epochs on
    await until(() => Object.values(t.repo.handles.get(deckUrl).doc().epochs ?? {}).filter((e) => e === 2).length === 12);
    const faces = (c) => [...c.showing()].filter(([, l]) => !l.veil).map(([id]) => id);
    const snap = snapOf();
    const regions = zones(snap);
    const where = (id) => seatAt(snap, regions, snap.world(id).slice(12, 15)) ?? (Math.abs(snap.world(id)[14] + 0.25) < 0.01 ? "market" : "deck");
    await until(() => faces(clients.ann).length === 6 && faces(clients.ben).length === 6);
    expect(faces(clients.ann).map(where).sort()).toEqual(["a", "a", "a", "market", "market", "market"]);
    expect(faces(clients.ben).map(where).sort()).toEqual(["b", "b", "b", "market", "market", "market"]);
    // the market's faces are the same for both; nobody's hand is anyone else's
    const name = (c, id) => c.showing().get(id).name;
    for (const id of faces(clients.ann).filter((x) => where(x) === "market")) expect(name(clients.ann, id)).toBe(name(clients.ben, id));
    Object.values(clients).forEach((c) => c.dispose());
  }, 120000);
});
