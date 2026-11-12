// The die's 2D panel, mounted on a fake handle with no scene anywhere: the
// (handle, element) → cleanup contract, what it shows, that every control
// writes the doc, and that its Roll is drawn by lots between everyone who
// has the die open (panel-lots.js), alone and together.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import Tool, { PANEL_AIR_MS, PANEL_GRACE_MS, faceOfDraw, facePicture, rollsOf, showingFace } from "./tool.js";
import { KEPT_ROLLS, PRESETS, dieOf } from "./die.js";
import { COMMIT_MS, OPEN_MS, commitOf, freshNonce, newRound, seedOf } from "./lots.js";
import { GONE_MS, HERE } from "./panel-lots.js";
import { faceOfSeed, seedFromLots } from "./roll.js";
import { SYMBOLS, dieMarks } from "./marks.js";
import { solid } from "./solids.js";
import { fakeRepo } from "./test/fakes.js";

/** One die doc, and a handle on it per panel: each panel's ephemeral messages reach every other panel's, at once. */
function sharedDie(preset = "d6", more = {}) {
  const h = fakeRepo().add({ "@patchwork": { type: "die" }, ...PRESETS[preset].make(), ...more });
  const peers = [];
  const peer = () => {
    const eph = new Set();
    const p = {
      url: h.url,
      doc: () => h.doc(),
      change: (fn) => h.change(fn),
      on: (ev, fn) => (ev === "ephemeral-message" ? eph.add(fn) : h.on(ev, fn)),
      off: (ev, fn) => (ev === "ephemeral-message" ? eph.delete(fn) : h.off(ev, fn)),
      broadcast: (message) => {
        for (const q of peers) if (q !== p) for (const fn of [...q.eph]) fn({ message: structuredClone(message) });
      },
      eph,
    };
    peers.push(p);
    return p;
  };
  return { h, peer, peers };
}

function mount(preset = "d6", more = {}, { handle = fakeRepo().add({ "@patchwork": { type: "die" }, ...PRESETS[preset].make(), ...more }), viewer } = {}) {
  const host = document.createElement("div");
  if (viewer) host.viewerId = viewer;
  document.body.append(host);
  const cleanup = Tool(handle, host);
  const $ = (sel) => host.querySelector(sel);
  const $$ = (sel) => [...host.querySelectorAll(sel)];
  const set = (elem, value) => {
    if (elem.type === "checkbox") elem.checked = value;
    else elem.value = value;
    elem.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const face = (i) => $(`.die-face[data-face="${i}"]`);
  return { handle, host, cleanup, $, $$, set, face, doc: () => handle.doc() };
}
/** Every byte this client draws next (its nonce, a round's id) is `b`: a listed draw, never a random one. */
const bytesAre = (b) => vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((arr) => arr.fill(b));
/** The face a round in the doc says, worked out here from its openings. */
const faceOfRound = (r, n) => faceOfSeed(seedFromLots(seedOf(r.id, Object.entries(r.opens))), n);
/** Press Roll, and let it come down. */
const roll = (t) => {
  t.$("button.roll").click();
  vi.advanceTimersByTime(PANEL_AIR_MS + 20);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("the die tool, mounted alone", () => {
  it("mounts under its own class with its styles, and cleans up everything it added", () => {
    const t = mount();
    expect(t.host.querySelector("style")).toBeTruthy();
    expect(t.$(".die-tool")).toBeTruthy();
    t.cleanup();
    expect(t.host.children).toHaveLength(0);
    // and no longer follows the doc
    t.handle.change((d) => (d.body = "#000000"));
    expect(t.host.children).toHaveLength(0);
  });

  it("its styles are all under .die-tool, and take their colours from the editor's theme through its own variables", () => {
    // (vitest hands back nothing for a ?inline stylesheet: read the file the build inlines)
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@layer package \{[\s\S]*?\n\}\n/, "");
    for (const m of rules.matchAll(/(^|\})\s*([^{}@]+)\{/g)) for (const sel of m[2].split(",")) expect(sel.trim().startsWith(".die-tool")).toBe(true);
    expect(rules).not.toMatch(/var\(--(editor|studio-primary)/);
    expect(css).toMatch(/@layer package \{[\s\S]*--die-tool-bg: var\(--editor-fill/);
    expect(rules).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("shows every face of every preset, each a picture of exactly what's drawn on it, and what it's called", () => {
    for (const id of Object.keys(PRESETS)) {
      const t = mount(id);
      const die = dieOf(t.doc());
      const s = solid(die.shape);
      const marks = dieMarks(die, s);
      expect(t.$$(".die-face")).toHaveLength(die.faces.length);
      die.faces.forEach((f, i) => {
        const card = t.face(i);
        expect(card.querySelector(".reads").textContent).toBe(f.label);
        expect(card.querySelectorAll(".die-mark")).toHaveLength(f.marks.length);
        const svg = card.querySelector(".picture svg");
        expect(svg.getAttribute("aria-label")).toBe(f.label);
        // the side's outline, then this face's ink: as many strokes and spots as the marks' art has
        const mine = marks.filter((m) => m.face === i && m.poly === (s.outcomes[i].readPoly ?? s.polys.findIndex((p) => p.verts.includes(s.outcomes[i].readVert))));
        const g = svg.querySelector(`g[data-face="${i}"]`);
        expect(g ? g.querySelectorAll("polyline, polygon").length : 0).toBe(mine.reduce((n, m) => n + m.strokes.length, 0));
        expect(g ? g.querySelectorAll("circle").length : 0).toBe(mine.reduce((n, m) => n + m.discs.length, 0));
        expect(svg.firstElementChild.getAttribute("points").split(" ")).toHaveLength(s.polys[mine[0]?.poly ?? s.outcomes[i].readPoly ?? 0].verts.length);
      });
      t.cleanup();
    }
  });

  it("a d4's picture is a side with three numbers on it: the one read at this corner, and its neighbours' faint", () => {
    const t = mount("d4");
    for (let i = 0; i < 4; i++) {
      const groups = [...t.face(i).querySelectorAll(".picture svg g")];
      expect(groups).toHaveLength(3);
      expect(groups.filter((g) => g.getAttribute("opacity") === "1").map((g) => g.dataset.face)).toEqual([String(i)]);
    }
    expect(t.$("h2:last-of-type").textContent).toMatch(/top corner/);
    // its sides are shared between faces: no colour of a face's own
    expect(t.$(".own-color")).toBeNull();
    expect(t.$(".own-ink")).toBeTruthy();
  });

  it("follows the doc: a change from elsewhere is drawn", () => {
    const t = mount();
    t.handle.change((d) => (d.faces[0] = { marks: [{ kind: "text", value: "HI" }], name: "hello" }));
    expect(t.face(0).querySelector(".reads").textContent).toBe("hello");
    t.handle.change((d) => (d.shape = "d20"));
    expect(t.$$(".die-face")).toHaveLength(20);
  });

  it("draws a doc that's hardly a die at all as a blank d6", () => {
    const handle = fakeRepo().add({ title: "?" });
    const host = document.createElement("div");
    Tool(handle, host);
    expect(host.querySelectorAll(".die-face")).toHaveLength(6);
    expect(host.querySelector(".die-table .reads").textContent).toBe("Shows blank");
  });
});

describe("changing the die", () => {
  it("shape: every shape is offered; choosing one makes it that shape's usual die at its usual size", () => {
    const t = mount();
    expect(t.$$("select.shape option").map((o) => o.value)).toEqual(["d4", "d6", "d8", "d10", "d12", "d20", "coin"]);
    t.handle.change((d) => (d.body = "#224466"));
    t.set(t.$("select.shape"), "d20");
    expect(t.doc()).toMatchObject({ shape: "d20", size: 0.02, body: "#224466", faces: PRESETS.d20.make().faces, rolls: [] });
    expect(t.$$(".die-face")).toHaveLength(20);
  });

  it("size in millimetres, body and ink colours, and turned-by-hand", () => {
    const t = mount();
    expect(t.$("input.size").value).toBe("16");
    t.set(t.$("input.size"), "22");
    expect(t.doc().size).toBeCloseTo(0.022, 12);
    t.set(t.$("input.size"), "-4");
    expect(t.doc().size).toBeCloseTo(0.022, 12);
    t.set(t.$("input.body"), "#102030");
    t.set(t.$("input.ink"), "#f0f0f0");
    expect(t.doc()).toMatchObject({ body: "#102030", ink: "#f0f0f0" });
    t.set(t.$("input.turn-only"), true);
    expect(t.doc().turnOnly).toBe(true);
    expect(t.$("button.roll").disabled).toBe(true);
  });

  it("starting again as any preset makes the doc that preset, keeping its title", () => {
    const t = mount();
    expect(t.$$("select.preset option").map((o) => o.value)).toEqual(["", ...Object.keys(PRESETS)]);
    for (const id of Object.keys(PRESETS)) {
      t.set(t.$("select.preset"), id);
      const { title, ...want } = PRESETS[id].make();
      expect(t.doc()).toMatchObject(want);
      expect(t.doc().title).toBe("d6");
    }
  });
});

describe("changing a face", () => {
  it("a mark's kind and value: a number, spots, a text, a symbol", () => {
    const t = mount();
    const row = () => t.face(2).querySelector(".die-mark");
    expect(row().querySelector("select.kind").value).toBe("pips");
    t.set(row().querySelector(".value"), "5");
    expect(t.doc().faces[2].marks).toEqual([{ kind: "pips", value: 5 }]);
    t.set(row().querySelector("select.kind"), "number");
    expect(t.doc().faces[2].marks).toEqual([{ kind: "number", value: 1 }]);
    t.set(row().querySelector(".value"), "42");
    expect(t.doc().faces[2].marks).toEqual([{ kind: "number", value: 42 }]);
    t.set(row().querySelector(".value"), "");
    expect(t.doc().faces[2].marks).toEqual([{ kind: "number", value: 42 }]);
    t.set(row().querySelector("select.kind"), "text");
    t.set(row().querySelector(".value"), "  heads and tails ");
    expect(t.doc().faces[2].marks).toEqual([{ kind: "text", value: "heads " }]);
    t.set(row().querySelector("select.kind"), "symbol");
    expect([...row().querySelectorAll("select.value option")].map((o) => o.value)).toEqual([...SYMBOLS]);
    t.set(row().querySelector("select.value"), "sword");
    expect(t.doc().faces[2].marks).toEqual([{ kind: "symbol", value: "sword" }]);
    expect(t.face(2).querySelector(".reads").textContent).toBe("sword");
    // only that face was written
    expect(t.doc().faces[0]).toEqual(PRESETS.d6.make().faces[0]);
  });

  it("more than one mark on a face, up to six, and taking one off; a face with none is blank", () => {
    const t = mount();
    for (let k = 0; k < 5; k++) t.face(1).querySelector("button.add").click();
    expect(t.doc().faces[1].marks).toHaveLength(6);
    expect(t.face(1).querySelector("button.add").disabled).toBe(true);
    expect(t.face(1).querySelectorAll(".picture svg g polyline").length).toBeGreaterThan(4);
    t.face(1).querySelectorAll("button.remove")[0].click();
    expect(t.doc().faces[1].marks.map((m) => m.kind)).toEqual(Array(5).fill("number"));
    while (t.face(1).querySelector("button.remove")) t.face(1).querySelector("button.remove").click();
    expect(t.doc().faces[1].marks).toEqual([]);
    expect(t.face(1).querySelector(".reads").textContent).toBe("blank");
  });

  it("which way its marks are turned, what it's called, and its own colours; unsetting each takes the field away", () => {
    const t = mount();
    t.set(t.face(3).querySelector("select.turn"), "90");
    expect(t.doc().faces[3].turn).toBe(90);
    t.set(t.face(3).querySelector("select.turn"), "0");
    expect("turn" in t.doc().faces[3]).toBe(false);
    t.set(t.face(3).querySelector("input.name"), " lucky ");
    expect(t.doc().faces[3].name).toBe("lucky");
    expect(t.face(3).querySelector(".reads").textContent).toBe("lucky");
    t.set(t.face(3).querySelector("input.name"), "");
    expect("name" in t.doc().faces[3]).toBe(false);
    expect(t.face(3).querySelector("input.color")).toBeNull();
    t.set(t.face(3).querySelector("input.own-color"), true);
    expect(t.doc().faces[3].color).toBe(t.doc().body);
    t.set(t.face(3).querySelector("input.color"), "#aa0000");
    expect(t.doc().faces[3].color).toBe("#aa0000");
    expect(t.face(3).querySelector(".picture svg").firstElementChild.getAttribute("fill")).toBe("#aa0000");
    t.set(t.face(3).querySelector("input.own-ink"), true);
    t.set(t.face(3).querySelector("input.ink"), "#00aa00");
    expect(t.face(3).querySelector(".picture svg g circle").getAttribute("fill")).toBe("#00aa00");
    t.set(t.face(3).querySelector("input.own-color"), false);
    t.set(t.face(3).querySelector("input.own-ink"), false);
    expect(Object.keys(t.doc().faces[3])).toEqual(["marks"]);
  });

  it("a turn other than a quarter (written elsewhere) is kept on offer", () => {
    const t = mount("d6", {});
    t.handle.change((d) => (d.faces[0].turn = 30));
    expect([...t.face(0).querySelectorAll("select.turn option")].map((o) => o.value)).toEqual(["0", "90", "180", "270", "30"]);
    expect(t.face(0).querySelector("select.turn").value).toBe("30");
  });

  it("a doc with fewer faces than its shape has is made whole by the first write to a face", () => {
    const t = mount("d6", { faces: [] });
    t.face(4).querySelector("button.add").click();
    expect(t.doc().faces).toHaveLength(6);
    expect(t.doc().faces[4].marks).toEqual([{ kind: "number", value: 1 }]);
  });
});

describe("using the die on its own", () => {
  it("as it stands it shows face 0", () => {
    const t = mount("d20");
    expect(t.$(".die-table .reads").textContent).toBe("Shows 1");
    expect(t.face(0).hasAttribute("data-showing")).toBe(true);
    expect(t.$$(".die-rolls li")).toHaveLength(0);
    expect(showingFace({}, 6)).toBe(0);
    expect(showingFace({ rolls: [{ face: 9 }] }, 6)).toBe(0);
    expect(showingFace({ rolls: [{ face: 2 }, { face: 5 }] }, 6)).toBe(5);
  });

  it("a drawn roll lands the face its seed says: the seeds 0 … n − 1 land every face of every preset once; undrawn, none", () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      const n = dieOf(p.make()).faces.length;
      const faces = Array.from({ length: n }, (_, k) => faceOfDraw({ public: true, seed: k.toString(16).padStart(8, "0") + "0".repeat(56) }, n));
      expect(faces, id).toEqual(Array.from({ length: n }, (_, k) => k));
      expect(faceOfDraw({ public: false, seed: null }, n)).toBe(null);
      expect(faceOfDraw(null, n)).toBe(null);
    }
  });

  it("Roll, alone: drawn by lots with one member, at once, and lands the face its draw's seed says, over a listed run of draws of a d20, a plus/minus die and a coin", () => {
    // (a short run: every face is reached by construction, above; each panel redraw here is a whole DOM)
    vi.useFakeTimers();
    for (const id of ["d20", "plus-minus", "coin"]) {
      const t = mount(id);
      const die = dieOf(t.doc());
      const n = die.faces.length;
      for (let b = 0; b < 6; b++) {
        bytesAre(b);
        t.$("button.roll").click();
        vi.restoreAllMocks();
        const r = t.doc().round;
        // one member, its own commit closing it: drawn already, with no deadline to wait for
        expect(r.members).toHaveLength(1);
        expect(Object.keys(r.opens)).toEqual(r.members);
        expect(r.of).toEqual(["die"]);
        // in the air a moment
        expect(t.$(".die-table .reads").textContent).toBe("Rolling…");
        expect(t.$("button.roll").disabled).toBe(true);
        vi.advanceTimersByTime(PANEL_AIR_MS + 20);
        const face = faceOfRound(r, n);
        expect(t.doc().rolls.at(-1)).toMatchObject({ face, how: "rolled", draw: r.draw, by: r.by });
        expect(t.$(".die-table .reads").textContent).toBe(`Shows ${die.faces[face].label}`);
        expect(t.$(".die-table .reads").dataset.face).toBe(String(face));
        expect(t.$$(".die-face[data-showing]").map((e) => e.dataset.face)).toEqual([String(face)]);
        expect(t.$$(".die-drawn").map((e) => e.textContent)).toEqual(["Drawn by you alone."]);
      }
      t.cleanup();
    }
  });

  it("keeps the last few, oldest first, each as it was called, rolled or turned", () => {
    vi.useFakeTimers();
    const t = mount("d6");
    for (let b = 0; b < KEPT_ROLLS + 3; b++) {
      bytesAre(b);
      roll(t);
      vi.restoreAllMocks();
    }
    expect(t.doc().rolls).toHaveLength(KEPT_ROLLS);
    const die = dieOf(t.doc());
    expect(t.$$(".die-rolls li").map((li) => li.textContent)).toEqual(t.doc().rolls.map((r) => die.faces[r.face].label));
    expect(t.$$(".die-rolls li[data-latest]")).toHaveLength(1);
    t.face(3).querySelector("button.show").click();
    expect(t.doc().rolls.at(-1)).toMatchObject({ face: 3, how: "turned" });
    expect(t.$$(".die-rolls li").at(-1).dataset.how).toBe("turned");
    expect(t.$(".die-table .reads").textContent).toBe(`Shows ${die.faces[3].label}`);
  });

  it("a die that's only turned by hand can't be rolled here either: Turn steps it to its next face", () => {
    const t = mount("doubling");
    expect(t.$("button.roll").disabled).toBe(true);
    const labels = dieOf(t.doc()).faces.map((f) => f.label);
    for (let k = 1; k <= 7; k++) {
      t.$("button.next").click();
      expect(t.$(".die-table .reads").textContent).toBe(`Shows ${labels[k % 6]}`);
      expect(t.doc().rolls.at(-1).how).toBe("turned");
    }
  });
});

describe("a face's picture", () => {
  it("fits the side it shows, y turned over for the screen", () => {
    for (const id of Object.keys(PRESETS)) {
      const die = dieOf(PRESETS[id].make());
      const s = solid(die.shape);
      die.faces.forEach((_, i) => {
        const svg = facePicture(die, s, i);
        const [x, y, w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
        const pts = [...svg.querySelectorAll("polygon, polyline")].flatMap((e) => e.getAttribute("points").split(" ").map((p) => p.split(",").map(Number)));
        for (const [px, py] of pts) {
          expect(px).toBeGreaterThanOrEqual(x);
          expect(px).toBeLessThanOrEqual(x + w);
          expect(py).toBeGreaterThanOrEqual(y);
          expect(py).toBeLessThanOrEqual(y + h);
        }
      });
    }
  });
});

describe("rolling with others who have the die open", () => {
  it("two panels on one die: each knows the other is here; a Roll in one is drawn by both, its seed the hash of both openings, and both show the same face, drawn by both", () => {
    vi.useFakeTimers();
    const d = sharedDie("d12");
    const ana = mount("d12", {}, { handle: d.peer(), viewer: "ana" });
    const ben = mount("d12", {}, { handle: d.peer(), viewer: "ben" });
    ana.$("button.roll").click();
    const r = ana.doc().round;
    expect(r.members).toEqual(["ana", "ben"]);
    expect(Object.keys(r.commits).sort()).toEqual(["ana", "ben"]);
    expect(Object.keys(r.opens).sort()).toEqual(["ana", "ben"]);
    // open to all: no keys, nothing sealed
    expect(r.keys).toEqual({});
    expect(r.sealed).toEqual({});
    // both see it tumbling until it comes down
    expect(ben.$(".die-table .reads").textContent).toBe("Rolling…");
    vi.advanceTimersByTime(PANEL_AIR_MS + 20);
    const n = 12;
    const face = faceOfRound(r, n);
    expect(ana.doc().rolls.at(-1)).toMatchObject({ face, how: "rolled", draw: r.draw, by: "ana" });
    const label = dieOf(ana.doc()).faces[face].label;
    for (const t of [ana, ben]) expect(t.$(".die-table .reads").textContent).toBe(`Shows ${label}`);
    // (the contributors in viewer order, each view naming itself)
    expect(ana.$$(".die-drawn").map((e) => e.textContent)).toEqual(["Drawn by you and someone."]);
    expect(ben.$$(".die-drawn").map((e) => e.textContent)).toEqual(["Drawn by someone and you."]);
    // written once, whoever might have
    vi.advanceTimersByTime(PANEL_GRACE_MS * 2);
    expect(ana.doc().rolls.filter((x) => x.draw === r.draw)).toHaveLength(1);
    ana.cleanup();
    ben.cleanup();
  });

  it("its asker gone once it's drawn: the other panel writes it down, after a grace, as its seed says", () => {
    vi.useFakeTimers();
    const d = sharedDie("d6");
    const ana = mount("d6", {}, { handle: d.peer(), viewer: "ana" });
    const ben = mount("d6", {}, { handle: d.peer(), viewer: "ben" });
    ana.$("button.roll").click();
    const r = ana.doc().round;
    ana.cleanup();
    vi.advanceTimersByTime(PANEL_GRACE_MS - 100);
    expect(ben.doc().rolls ?? []).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(ben.doc().rolls.at(-1)).toMatchObject({ face: faceOfRound(r, 6), how: "rolled", draw: r.draw, by: "ana" });
    ben.cleanup();
  });

  it("someone here whose panel never answers isn't waited for past the commit deadline: drawn by the roller alone, and the panel says so", () => {
    vi.useFakeTimers();
    const d = sharedDie("d6");
    const ana = mount("d6", {}, { handle: d.peer(), viewer: "ana" });
    // a panel that says it's here and then does nothing at all
    const ghost = d.peer();
    ghost.broadcast({ type: HERE, session: "sghost", viewer: "ghost" });
    ana.$("button.roll").click();
    expect(ana.doc().round.members).toEqual(["ana", "ghost"]);
    expect(ana.$(".die-table .reads").textContent).toBe("Rolling…");
    vi.advanceTimersByTime(COMMIT_MS + 600);
    const r = ana.doc().round;
    expect(r.closed).toEqual(["ana"]);
    expect(ana.doc().rolls.at(-1)).toMatchObject({ face: faceOfRound(r, 6), draw: r.draw });
    expect(ana.$$(".die-drawn").map((e) => e.textContent)).toEqual(["Drawn by you alone: nobody else took part."]);
    // and one not heard from again is gone after a while: the next roll is hers alone, at once
    vi.advanceTimersByTime(GONE_MS);
    roll(ana);
    expect(ana.doc().round.members).toEqual(["ana"]);
    ana.cleanup();
  });

  it("a roll written by hand, not as its draw says, is said to be", () => {
    vi.useFakeTimers();
    const t = mount("d6");
    roll(t);
    const last = t.doc().rolls.at(-1);
    t.handle.change((doc) => (doc.rolls.at(-1).face = (last.face + 1) % 6));
    expect(t.$$(".die-drawn").map((e) => e.textContent)).toEqual(["This roll isn't the face its draw says: it was written by hand."]);
    t.cleanup();
  });

  it("a draw written twice into the rolls (two panels at once) is one roll", () => {
    expect(rollsOf({ rolls: [{ face: 1, draw: "dA" }, { face: 1, draw: "dA" }, { face: 2 }, { face: 9 }] }, 6)).toEqual([{ face: 1, draw: "dA" }, { face: 2 }]);
  });

  it("a roll its asker throws away once it's drawn, for another, is written down anyway by whoever saw it drawn, and said to be; the asker learned it no sooner than they did", () => {
    vi.useFakeTimers();
    const d = sharedDie("d6");
    const ben = mount("d6", {}, { handle: d.peer(), viewer: "ben" });
    const ana = d.peer(); // a modified client: speaks the protocol by hand
    ana.broadcast({ type: HERE, session: "sana", viewer: "ana" });
    const thrown = [];
    for (let i = 0; i < 4; i++) {
      const id = `rgrind${i}xx`;
      const nonce = freshNonce();
      ana.change((doc) => void (doc.round = newRound({ draw: `dgrind${i}xx`, id, by: "ana", at: Date.now(), of: ["die"], sealers: [], members: ["ben"], commit: commitOf(id, "ana", nonce, "", ["die"]) })));
      vi.advanceTimersByTime(30);
      // ben committed, and waits on her opening: she learns nothing before she opens
      expect(Object.keys(ana.doc().round.commits).sort()).toEqual(["ana", "ben"]);
      expect(ana.doc().round.opens).toEqual({});
      ana.change((doc) => void (doc.round.opens.ana = nonce));
      vi.advanceTimersByTime(30);
      const r = ana.doc().round;
      expect(r.opens.ben).toBeTruthy(); // ben opened once she had: everyone knows it now
      thrown.push(faceOfRound(r, 6));
    }
    // she throws the last away too, for a fifth she writes down herself
    const id = "rkeepxxx";
    const nonce = freshNonce();
    ana.change((doc) => void (doc.round = newRound({ draw: "dkeepxxx", id, by: "ana", at: Date.now(), of: ["die"], sealers: [], members: ["ben"], commit: commitOf(id, "ana", nonce, "", ["die"]) })));
    vi.advanceTimersByTime(30);
    ana.change((doc) => void (doc.round.opens.ana = nonce));
    vi.advanceTimersByTime(30);
    const kept = faceOfRound(ana.doc().round, 6);
    ana.change((doc) => void doc.rolls.push({ face: kept, how: "rolled", at: Date.now(), draw: "dkeepxxx", by: "ana" }));
    vi.advanceTimersByTime(100);
    // every one of them is in the rolls, as drawn, the thrown-away marked so
    expect(ben.doc().rolls.map((r) => [r.face, !!r.again])).toEqual([...thrown.map((f) => [f, true]), [kept, false]]);
    const label = (f) => dieOf(ben.doc()).faces[f].label;
    expect(ben.$$(".die-drawn").map((e) => e.textContent)).toEqual(["Drawn by someone and you.", `Someone rolled again before 4 rolls came down: ${thrown.map(label).join(", ")}, as drawn.`]);
    expect(ben.$$(".die-rolls li").map((e) => e.dataset.how)).toEqual(["again", "again", "again", "again", "rolled"]);
    expect(ben.$(".die-table .reads").textContent).toBe(`Shows ${label(kept)}`);
    ben.cleanup();
  });

  it("a roll written over in its asker's name (a forger reusing the nonce it opened) isn't written down by anyone, and the asker is told", () => {
    vi.useFakeTimers();
    const d = sharedDie("d6");
    const ben = mount("d6", {}, { handle: d.peer(), viewer: "ben" });
    const cy = d.peer();
    cy.broadcast({ type: HERE, session: "scy", viewer: "cy" });
    ben.$("button.roll").click();
    const r1 = ben.doc().round;
    const nc = freshNonce();
    cy.change((doc) => void (doc.round.commits.cy = commitOf(r1.id, "cy", nc, "", ["die"])));
    vi.advanceTimersByTime(30);
    const opened = ben.doc().round.opens.ben;
    expect(opened).toBeTruthy(); // ben, the asker, opened first: cy now knows the seed, and doesn't open
    const id = "rforgexx";
    const n = freshNonce();
    const r2 = newRound({ draw: r1.draw, id, by: "ben", at: Date.now(), of: ["die"], sealers: [], members: ["cy"], commit: commitOf(id, "ben", opened, "", ["die"]) });
    r2.commits.cy = commitOf(id, "cy", n, "", ["die"]);
    r2.opens = { ben: opened, cy: n };
    cy.change((doc) => void (doc.round = r2));
    vi.advanceTimersByTime(PANEL_GRACE_MS * 3);
    expect(ben.doc().round.protests).toEqual({ ben: { of: id, why: "forged" } });
    expect(ben.doc().rolls ?? []).toEqual([]);
    expect(ben.$$(".die-drawn").map((e) => e.textContent)).toEqual(["Someone wrote the lots for that roll in your name: nothing was rolled.", "Someone wrote the lots for d6 in your name: your client refused them, and nothing lands by them."]);
    expect(ben.$(".die-table .reads").textContent).not.toBe("Rolling…");
    ben.cleanup();
  });

  it("someone who could know a roll first and doesn't open it is left out, and the roll says so", () => {
    vi.useFakeTimers();
    const d = sharedDie("d6");
    const ana = mount("d6", {}, { handle: d.peer(), viewer: "ana" });
    const ben = mount("d6", {}, { handle: d.peer(), viewer: "ben" });
    const cy = d.peer();
    cy.broadcast({ type: HERE, session: "scy", viewer: "cy" });
    ana.$("button.roll").click();
    const r1 = ana.doc().round;
    cy.change((doc) => void (doc.round.commits.cy = commitOf(r1.id, "cy", freshNonce(), "", ["die"])));
    vi.advanceTimersByTime(OPEN_MS + 1000);
    const r = ana.doc().round;
    expect(r).toMatchObject({ draw: r1.draw, members: ["ana", "ben"], excluded: ["cy"] });
    expect(ana.doc().rolls.at(-1)).toMatchObject({ draw: r1.draw, face: faceOfRound(r, 6) });
    expect(ben.$$(".die-drawn").map((e) => e.textContent)).toEqual(["Drawn by someone and you; someone didn't open their part, and it was drawn again without them."]);
    ana.cleanup();
    ben.cleanup();
  });

  it("closing a panel says goodbye: the others count it gone at once", () => {
    vi.useFakeTimers();
    const d = sharedDie("d6");
    const ana = mount("d6", {}, { handle: d.peer(), viewer: "ana" });
    const ben = mount("d6", {}, { handle: d.peer(), viewer: "ben" });
    ben.cleanup();
    roll(ana);
    expect(ana.doc().round.members).toEqual(["ana"]);
    ana.cleanup();
  });
});
