// The die's 2D panel, mounted on a fake handle with no scene anywhere: the
// (handle, element) → cleanup contract, what it shows, and that every control
// writes the doc.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import Tool, { facePicture, showingFace } from "./tool.js";
import { KEPT_ROLLS, PRESETS, dieOf } from "./die.js";
import { SYMBOLS, dieMarks } from "./marks.js";
import { solid } from "./solids.js";
import { fakeRepo } from "./test/fakes.js";

function mount(preset = "d6", more = {}) {
  const handle = fakeRepo().add({ "@patchwork": { type: "die" }, ...PRESETS[preset].make(), ...more });
  const host = document.createElement("div");
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
const seedIs = (seed) => vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((arr) => ((arr[0] = seed), arr));

afterEach(() => {
  vi.restoreAllMocks();
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

  it("Roll lands the face its seed says, for every face of a d20 and of a plus/minus die, and shows it", () => {
    for (const id of ["d20", "plus-minus", "coin"]) {
      const t = mount(id);
      const die = dieOf(t.doc());
      for (let seed = 0; seed < die.faces.length; seed++) {
        seedIs(seed + die.faces.length * 3);
        t.$("button.roll").click();
        expect(t.doc().rolls.at(-1)).toMatchObject({ face: seed, how: "rolled" });
        expect(t.$(".die-table .reads").textContent).toBe(`Shows ${die.faces[seed].label}`);
        expect(t.$(".die-table .reads").dataset.face).toBe(String(seed));
        expect(t.$$(".die-face[data-showing]").map((e) => e.dataset.face)).toEqual([String(seed)]);
        vi.restoreAllMocks();
      }
      t.cleanup();
    }
  });

  it("keeps the last few, oldest first, each as it was called, rolled or turned", () => {
    const t = mount("d6");
    for (let seed = 0; seed < KEPT_ROLLS + 3; seed++) {
      seedIs(seed);
      t.$("button.roll").click();
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
