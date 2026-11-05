import { describe, it, expect, vi } from "vitest";
import { HIDDEN, SEATS, ZONE, docUrl, isFaceUp, seatAt, seatOf, seatedPlayers, visibility, zones } from "./visibility.js";
import { plainResolver } from "./plain-deck.js";
import Extension from "./extension.js";
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
function mount({ viewer = "alice", registries = {}, deckType = "plain-deck" } = {}) {
  const repo = fakeRepo();
  let doc = { objects: objects(), traits: { [SEATS]: seats(viewer) } };
  const deck = repo.add(
    { "@patchwork": { type: deckType }, objects: Object.fromEntries(["inHand1", "inHand2Flipped", "faceUp", "faceDown", "onTray"].map((id) => [id, { sourceUrl: `automerge:${id}`, name: `Face of ${id}` }])) },
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
    local: { get: () => ({}), swap: (fn) => (calls.selected = fn({}).selected) },
    notify: (m, kind) => calls.toasts.push([m, kind]),
    schedule: () => calls.refreshes++,
    overlay: () => (calls.overlay = document.createElement("div")),
    presence: { get: () => calls.peers ?? {}, watch: (fn) => ((calls.presenceWatch = fn), () => {}) },
    style() {},
    box: () => null,
    camera: { set: (c) => (calls.camera = c) },
    registry: async (type) => registries[type] ?? null,
  };
  const x = Extension.create(api);
  return { x, api, deck, calls, repo, get doc() {
    return doc;
  } };
}
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("the table extension", () => {
  it("reads only a plain-deck doc as a plain deck (scene-secrets is no longer a name for one)", async () => {
    const m = mount({ deckType: "scene-secrets" });
    m.x.update(m.api.scene());
    await settle();
    expect(m.deck.doc()["@patchwork"].type).toBe("scene-secrets");
    expect(m.x.looks().size).toBe(0);
    expect(m.x.hud()).toEqual([{ text: expect.stringContaining("scene-secrets"), state: "error" }]);
  });

  it("reads a deck and shows this viewer what they may see", async () => {
    const m = mount();
    m.x.update(m.api.scene());
    await settle();
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
    expect(shuffle.state("faceDown")).not.toBeNull();
    expect(shuffle.state("board")).toBeNull();
    expect(shuffle.state(null)).toBeNull();
    // no boxes: the pile is what's on the same spot (faceDown alone)
    shuffle.run("faceDown");
    expect(m.calls.toasts.at(-1)[0]).toMatch(/nothing here to shuffle/);
  });

  it("the seat picker over the table: sit, and the seat's camera", () => {
    const m = mount({ viewer: "carol" });
    m.api.change((d) => {
      d.traits[SEATS] = seats(null, "bob");
      d.traits[SEATS].p1.camera = { position: [0, 1, 1], target: [0, 0, 0] };
    });
    m.x.update(m.api.scene());
    const select = m.calls.overlay.querySelector(".tabletop-seat");
    // bob's seat is his, but he isn't here
    expect([...select.options].map((o) => o.textContent)).toEqual(["Watching", "Player 1", "Player 2 (away)"]);
    m.calls.peers = { s1: { viewer: "bob", keys: {} } };
    m.calls.presenceWatch();
    expect([...select.options].map((o) => o.textContent)).toEqual(["Watching", "Player 1", "Player 2 (taken)"]);
    select.value = "p1";
    select.dispatchEvent(new Event("change"));
    expect(m.doc.traits[SEATS].p1.player).toBe("carol");
    expect(m.calls.camera).toEqual({ position: [0, 1, 1], target: [0, 0, 0] });
    // taking a seat from someone who is here asks first
    const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    select.value = "p2";
    select.dispatchEvent(new Event("change"));
    expect(confirm).toHaveBeenCalledOnce();
    expect(m.doc.traits[SEATS].p2.player).toBe("bob");
    expect(select.value).toBe("p1");
    confirm.mockRestore();
  });

  it("lays out a deck dropped on the table when its provider can", async () => {
    const placement = vi.fn(() => ({ name: "Secret deck", count: 3, look: { sourceUrl: "automerge:back", name: "Card" }, bounds: { min: [0, 0, 0], max: [0.05, 0.001, 0.08] } }));
    const bind = vi.fn();
    const registry = {
      filter: (fn) => [{ id: "sd", supportedDatatypes: ["secure-deck"] }].filter(fn),
      load: async () => ({ module: { createResolver: () => ({ update() {}, looks: () => new Map() }), placement, bind } }),
    };
    const m = mount({ registries: { "tabletop:deck": registry } });
    // the drop is the module's, called before the extension runs, with a small context
    const ctx = { ...m.api, notify: m.api.notify };
    const url = "automerge:2SecureSecureSecureSecure9";
    expect(await Extension.drop(ctx, { url, doc: { "@patchwork": { type: "secure-deck" } }, handle: {} })).toBe(true);
    const cards = Object.values(m.doc.objects).filter((o) => o.traits?.[HIDDEN]?.by === url);
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => Math.abs(c.transform.rotation[2] - Math.PI) < 1e-9)).toBe(true);
    expect(bind).toHaveBeenCalledOnce();
    // not a deck: left to the scene
    expect(m.calls.selected).toMatch(/^g/);
    expect(await Extension.drop(ctx, { url: "automerge:2Other", doc: { "@patchwork": { type: "file" } }, handle: {} })).toBe(false);
  });
});
