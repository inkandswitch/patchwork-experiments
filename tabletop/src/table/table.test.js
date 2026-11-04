import { describe, it, expect, vi } from "vitest";
import { HIDDEN, SEATS, ZONE, docUrl, isFaceUp, seatAt, seatOf, seatedPlayers, visibility, zones } from "./visibility.js";
import { plainResolver } from "./plain-deck.js";
import Extension, { PANEL, migrate, needsMigration } from "./extension.js";
import { testScene } from "./test-scene.js";

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const zone = (seat) => ({ [ZONE]: { seat, min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] } });
const DECK = "automerge:2DeckDeckDeckDeckDeckDeck1";
const hidden = { [HIDDEN]: { by: DECK } };
const objects = () => ({
  // two hand trays, one turned round, each a private zone 0.6 × 0.1 m, 0.15 m high
  hand1: { name: "Hand 1", transform: T([0, 0, 0.5]), traits: zone("p1") },
  hand2: { name: "Hand 2", transform: T([0, 0, -0.5], [0, Math.PI, 0]), traits: zone("p2") },
  inHand1: { name: "Card", transform: T([0.1, 0.002, 0.5]), traits: hidden },
  inHand2Flipped: { name: "Card", transform: T([0.2, 0.002, -0.49], [0, 0, Math.PI]), traits: hidden },
  faceUp: { name: "Card", transform: T([0, 0, 0]), traits: hidden },
  faceDown: { name: "Card", transform: T([0.3, 0.001, 0], [0, 0.4, Math.PI]), traits: hidden },
  // attached to the tray: its world position decides
  onTray: { name: "Card", parent: "hand1", transform: T([-0.2, 0.002, 0]), traits: hidden },
  board: { name: "Board", transform: T([0, 0, 0]) },
});
const seats = (p1 = null, p2 = null) => ({ p1: { name: "Player 1", player: p1 }, p2: { name: "Player 2", player: p2 } });

describe("who may see what", () => {
  it("zones: the seat whose box holds a point, through the zone's own turn", () => {
    const scene = testScene(objects());
    const regions = zones(scene);
    expect(regions.map((r) => r.seat).sort()).toEqual(["p1", "p2"]);
    expect(seatAt(scene, regions, [0.25, 0.1, 0.52])).toBe("p1");
    expect(seatAt(scene, regions, [-0.25, 0.1, -0.46])).toBe("p2");
    expect(seatAt(scene, regions, [0, 0.2, 0.5])).toBeNull(); // above it
    expect(seatAt(scene, regions, [0, 0, 0])).toBeNull();
    expect(zones(testScene({ a: { transform: T([0, 0, 0]), traits: { [ZONE]: { seat: "p1" } } } }))).toEqual([]);
  });

  it("face up is +Y up in the world, whatever the yaw", () => {
    const scene = testScene(objects());
    expect(isFaceUp(scene, "faceUp")).toBe(true);
    expect(isFaceUp(scene, "faceDown")).toBe(false);
  });

  it("a hand is its seat's alone, either way up; the table is face up for everyone", () => {
    const scene = testScene(objects());
    const see = visibility(scene, seats("alice", "bob"));
    const hiddenOnes = (set) => [...set].filter((id) => scene.objects[id].traits?.[HIDDEN]).sort();
    expect(hiddenOnes(see("alice"))).toEqual(["faceUp", "inHand1", "onTray"]);
    expect(hiddenOnes(see("bob"))).toEqual(["faceUp", "inHand2Flipped"]);
    expect(hiddenOnes(see(null))).toEqual(["faceUp"]);
    expect(hiddenOnes(see("carol"))).toEqual(["faceUp"]); // not seated: watching
  });

  it("seats", () => {
    expect(seatOf(seats("alice"), "alice")).toBe("p1");
    expect(seatOf(seats("alice"), "bob")).toBeNull();
    expect(seatedPlayers(seats(null, "bob"))).toEqual(["bob"]);
    expect(docUrl(`${DECK}#heads`)).toBe(DECK);
    expect(docUrl("nope")).toBeNull();
  });
});

describe("the plain deck", () => {
  it("shows what the viewer may see, and shuffles entries", () => {
    let doc = { objects: { a: { sourceUrl: "automerge:a", name: "A" }, b: { sourceUrl: "automerge:b", name: "B" } } };
    const handle = { doc: () => doc, change: (fn) => ((doc = structuredClone(doc)), fn(doc)), on() {}, off() {} };
    const r = plainResolver({ handle, viewer: "alice" });
    r.update({ visibleTo: () => new Set(["a"]) });
    expect([...r.looks().keys()]).toEqual(["a"]);
    expect(r.shuffle(["a", "b"], () => 0)).toBe(2);
    expect(doc.objects.a.name).toBe("B");
    expect(r.shuffle(["a"])).toBe(0);
  });
});

describe("old scenes", () => {
  it("move seats, zones and hidden into traits, and open on the Table panel", () => {
    const d = {
      view: { units: "cm" },
      seats: seats("alice"),
      objects: { tray: { name: "Tray", zone: { seat: "p1", min: [0, 0, 0], max: [1, 1, 1] } }, card: { name: "Card", hidden: { by: DECK } }, board: { name: "Board" } },
    };
    expect(needsMigration(d)).toBe(true);
    migrate(d);
    expect(needsMigration(d)).toBe(false);
    expect(d.seats).toBeUndefined();
    expect(d.traits[SEATS].p1.player).toBe("alice");
    expect(d.objects.tray.traits[ZONE].seat).toBe("p1");
    expect(d.objects.card.traits[HIDDEN].by).toBe(DECK);
    expect(d.objects.card.hidden).toBeUndefined();
    expect(d.objects.board.traits).toBeUndefined();
    expect(d.view.panels).toEqual([PANEL, "inspector"]);
  });
});

/** An in-memory repo with real-looking urls, whose handles emit "change". */
function fakeRepo() {
  const handles = new Map();
  let n = 0;
  const make = (url, doc) => {
    const listeners = new Set();
    const h = {
      url,
      doc: () => doc,
      change(fn) {
        doc = structuredClone(doc);
        fn(doc);
        for (const l of [...listeners]) l();
      },
      on: (ev, fn) => ev === "change" && listeners.add(fn),
      off: (ev, fn) => listeners.delete(fn),
    };
    handles.set(url, h);
    return h;
  };
  return {
    add: (doc, url = `automerge:2Doc${String(n++).padStart(4, "x")}abcdefghijkmnopqr`) => make(url, structuredClone(doc)),
    async find(url) {
      const h = handles.get(url);
      if (!h) throw new Error("unavailable");
      return h;
    },
  };
}

/** The extension against a stand-in for the scene's api. */
function mount({ viewer = "alice", registries = {} } = {}) {
  const repo = fakeRepo();
  let doc = { objects: objects(), traits: { [SEATS]: seats(viewer) } };
  const deck = repo.add(
    { "@patchwork": { type: "scene-secrets" }, objects: Object.fromEntries(["inHand1", "inHand2Flipped", "faceUp", "faceDown", "onTray"].map((id) => [id, { sourceUrl: `automerge:${id}`, name: `Face of ${id}` }])) },
    DECK,
  );
  const calls = { toasts: [], refreshes: 0, selected: null, camera: null };
  const api = {
    repo,
    viewer,
    doc: () => doc,
    scene: () => testScene(doc.objects, doc.traits),
    change: (fn) => {
      doc = structuredClone(doc);
      fn(doc);
    },
    newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
    select: (id) => (calls.selected = id),
    toast: (m, kind) => calls.toasts.push([m, kind]),
    refresh: () => calls.refreshes++,
    box: () => null,
    setCamera: (c) => (calls.camera = c),
    registry: async (type) => registries[type] ?? null,
  };
  const x = Extension.create(api);
  return { x, api, deck, calls, repo, get doc() {
    return doc;
  } };
}
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("the table extension", () => {
  it("reads a deck and shows this viewer what they may see (an old plain deck is renamed)", async () => {
    const m = mount();
    m.x.update(m.api.scene());
    await settle();
    expect(m.deck.doc()["@patchwork"].type).toBe("plain-deck");
    expect(m.calls.refreshes).toBeGreaterThan(0);
    m.x.update(m.api.scene());
    expect([...m.x.looks().keys()].sort()).toEqual(["faceUp", "inHand1", "onTray"]);
    expect(m.x.looks().get("inHand1").name).toBe("Face of inHand1");
  });

  it("turns a hidden card face up over your own zone only", () => {
    const m = mount();
    m.x.update(m.api.scene());
    expect(m.x.landing("faceDown", [0.1, 0.01, 0.5])).toEqual({ faceUp: true });
    expect(m.x.landing("faceDown", [0.1, 0.01, -0.5])).toBeNull(); // someone else's
    expect(m.x.landing("faceDown", [0, 0, 0])).toBeNull();
    expect(m.x.landing("board", [0.1, 0.01, 0.5])).toBeNull(); // not hidden
    const watcher = mount({ viewer: "zed" });
    watcher.api.change((d) => (d.traits[SEATS] = seats()));
    watcher.x.update(watcher.api.scene());
    expect(watcher.x.landing("faceDown", [0.1, 0.01, 0.5])).toBeNull();
  });

  it("shuffles the pile a card is in, through its deck", async () => {
    const m = mount();
    m.x.update(m.api.scene());
    await settle();
    const shuffle = m.x.commands.find((c) => c.id === "shuffle");
    expect(shuffle.key).toBe("s");
    expect(shuffle.appliesTo("faceDown")).toBe(true);
    expect(shuffle.appliesTo("board")).toBe(false);
    // no boxes: the pile is what's on the same spot (faceDown alone)
    shuffle.run("faceDown");
    expect(m.calls.toasts.at(-1)[0]).toMatch(/nothing here to shuffle/);
  });

  it("the Table panel: sit, and the seat's camera", () => {
    const m = mount({ viewer: "carol" });
    m.api.change((d) => {
      d.traits[SEATS] = seats(null, "bob");
      d.traits[SEATS].p1.camera = { position: [0, 1, 1], target: [0, 0, 0] };
    });
    m.x.update(m.api.scene());
    const body = document.createElement("div");
    const panel = m.x.panels.find((p) => p.id === PANEL).mount(body);
    panel.update();
    const select = body.querySelector("select");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Watching", "Player 1", "Player 2 (taken)"]);
    select.value = "p1";
    select.dispatchEvent(new Event("change"));
    expect(m.doc.traits[SEATS].p1.player).toBe("carol");
    expect(m.calls.camera).toEqual({ position: [0, 1, 1], target: [0, 0, 0] });
  });

  it("lays out a deck dropped on the table when its provider can", async () => {
    const placement = vi.fn(() => ({ name: "Secret deck", count: 3, look: { sourceUrl: "automerge:back", name: "Card" }, bounds: { min: [0, 0, 0], max: [0.05, 0.001, 0.08] } }));
    const bind = vi.fn();
    const registry = {
      filter: (fn) => [{ id: "sd", supportedDatatypes: ["secure-deck"] }].filter(fn),
      load: async () => ({ module: { createResolver: () => ({ update() {}, looks: () => new Map() }), placement, bind } }),
    };
    const m = mount({ registries: { "tabletop:deck": registry } });
    const url = "automerge:2SecureSecureSecureSecure9";
    expect(await m.x.drop({ url, doc: { "@patchwork": { type: "secure-deck" } }, handle: {} })).toBe(true);
    const cards = Object.values(m.doc.objects).filter((o) => o.traits?.[HIDDEN]?.by === url);
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => Math.abs(c.transform.rotation[2] - Math.PI) < 1e-9)).toBe(true);
    expect(bind).toHaveBeenCalledOnce();
    // not a deck: left to the scene
    expect(await m.x.drop({ url: "automerge:2Other", doc: { "@patchwork": { type: "file" } }, handle: {} })).toBe(false);
  });
});
