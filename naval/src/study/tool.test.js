// The study view in happy-dom (no Worker: the screen runs on the main thread
// after a yield, as statics-runner.js falls back).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import NavalStudyTool from "./tool.js";
import { NavalStudyDatatype } from "./datatype.js";
import { FIXTURES, fixtureDoc } from "../fixtures/index.js";
import { getRegistry, resetRegistries } from "../test/patchwork-plugins-stub.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

function fakeHandle(initial, extra = {}) {
  let doc = initial;
  const listeners = new Set();
  return {
    ...extra,
    doc: () => doc,
    heads: () => ["study-head"],
    change(fn) {
      const next = structuredClone(doc);
      fn(next);
      doc = next;
      for (const l of listeners) l({ doc });
    },
    on: (ev, fn) => ev === "change" && listeners.add(fn),
    off: (ev, fn) => ev === "change" && listeners.delete(fn),
  };
}
const until = async (f, ms = 20_000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

const urls = { cat: "automerge:cat11111111111111111111111", j24: "automerge:j2411111111111111111111111", render: "automerge:rend111111111111111111111" };
const docs = {
  [urls.cat]: { "@patchwork": { type: "rig-design" }, ...fixtureDoc(FIXTURES.find((f) => f.id === "catalina-30").fixture) },
  [urls.j24]: { "@patchwork": { type: "rig-design" }, ...fixtureDoc(FIXTURES.find((f) => f.id === "j24").fixture) },
  [urls.render]: { "@patchwork": { type: "scene-render" }, title: "Hull", parent: "automerge:x", params: { size: "length", lengthMeters: 12 } },
};
const fakeDoc = (u, heads) => ({ url: u, doc: () => docs[u], heads: () => heads, on() {}, off() {}, view: (h) => fakeDoc(u, h) });
const repo = { find: async (u) => fakeDoc(u, [`${u.slice(10, 14)}-h`]) };

let element, cleanup;
beforeEach(() => {
  resetRegistries();
  element = document.createElement("div");
  document.body.append(element);
});
afterEach(() => {
  cleanup?.();
  cleanup = null;
  element.remove();
});

describe("naval study view", () => {
  it("adds two designs, screens them, and shows the comparison with badges, Δ and the can't-tell panel; refuses a render", async () => {
    const d = { "@patchwork": { type: "naval-study" } };
    NavalStudyDatatype.init(d);
    const h = fakeHandle(d, { repo, url: "automerge:self1111111111111111111111" });
    cleanup = NavalStudyTool(h, element);
    expect(element.querySelector(".empty")).toBeTruthy();
    const add = async (u) => {
      element.querySelector(".study-add input").value = u;
      element.querySelector(".study-add").dispatchEvent(new Event("submit", { cancelable: true }));
      await until(() => !/Reading/.test(element.querySelector(".add-status").textContent));
    };
    await add(urls.render);
    expect(element.querySelector(".add-status").textContent).toMatch(/link the hull itself/);
    expect(h.doc().subjects).toHaveLength(0);
    await add(urls.cat);
    await add(urls.j24);
    expect(h.doc().subjects.map((s) => s.label)).toEqual(["Catalina 30 (standard rig)", "J/24"]);
    expect(h.doc().baseline).toBe("s1");
    await until(() => element.querySelectorAll('.subject[data-state="ready"]').length === 2);
    const cells = [...element.querySelectorAll('tr[data-row="lwl"] td.cell')];
    expect(cells).toHaveLength(2);
    expect(cells[0].querySelector(".v").textContent).toMatch(/^7\.6\d m$/);
    // a particular: nothing grades it, and its badge says so rather than "in range"
    expect(cells[0].querySelector(".badge").dataset.envelope).toBe("ungraded");
    expect(cells[0].querySelector(".badge").textContent).toBe("not graded");
    expect(cells[0].title).toMatch(/Source:/);
    // the lead shows where it sits on its design band (the Catalina's model lead is above its 5–9%)
    const lead = element.querySelector('tr[data-row="lead"] td.cell');
    expect(lead.querySelector(".band").dataset.band).toBe("above");
    expect(lead.querySelector(".band").textContent).toBe("above band");
    expect(lead.querySelector(".badge").textContent).toBe("not graded");
    expect(lead.title).toMatch(/Design band: lead 5–9% of LWL/);
    expect(cells[0].querySelector(".delta")).toBeNull(); // the baseline
    expect(cells[1].querySelector(".delta").textContent).toMatch(/^Δ [−+]/);
    // DSYHS extrapolation shows: a near/far badge on resistance, listed in the panel
    const r35 = element.querySelector('tr[data-row="r35"] td.cell .badge');
    expect(["near", "far"]).toContain(r35.dataset.envelope);
    expect(element.querySelector(".cant-figures").textContent).toMatch(/R at Fn 0\.35/);
    expect(element.querySelector(".cant-always").textContent).toMatch(/STIX/);
    // baseline switch: the Δ moves to the other column
    const radio = element.querySelector('input[name="baseline"][value="s2"]');
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    expect(h.doc().baseline).toBe("s2");
    const after = [...element.querySelectorAll('tr[data-row="lwl"] td.cell')];
    expect(after[0].querySelector(".delta")).toBeTruthy();
    expect(after[1].querySelector(".delta")).toBeNull();
    // pin, then export
    element.querySelector('.subject[data-subject="s1"] [data-act="pin"]').click();
    await until(() => h.doc().subjects[0].design.heads);
    expect(h.doc().subjects[0].design.heads).toEqual(["cat1-h"]);
    // pinning changes what the subject reads: it is screened again, at those heads
    await until(() => element.querySelectorAll('.subject[data-state="ready"]').length === 2);
    expect(element.querySelector('.subject[data-subject="s1"] .heads').textContent).toBe("pinned design cat1-h");
    expect(h.doc().subjects[0]).toMatchObject({ hull: null, design: { heads: ["cat1-h"], hullHeads: null } }); // a synthetic hull: nothing more to pin
    let report = null;
    element.addEventListener("naval-study-export", (e) => (report = e.detail));
    element.querySelector('[data-act="export"]').click();
    expect(report).toMatchObject({ format: "naval-study-report", version: 1 });
    expect(report.groups[0].rows[0].cells[0].figure).toMatchObject({ unit: "length", provenance: expect.any(String) });
    element.querySelector('.subject[data-subject="s2"] [data-act="remove"]').click();
    expect(h.doc().subjects.map((s) => s.id)).toEqual(["s1"]);
    expect(h.doc().baseline).toBe("s1");
  }, 60_000);

  it("follows the docs it last read: a followed design linked to a hull later has that hull's edits screened too", async () => {
    const GLB = new Uint8Array(readFileSync(here("../test/fixtures/camber/narrow-transom.glb")));
    const DESIGN = "automerge:des11111111111111111111111";
    const HULL = "automerge:hu11111111111111111111111";
    const sloop = fixtureDoc(FIXTURES.find((f) => f.id === "sloop-12m").fixture);
    const store = { [DESIGN]: { "@patchwork": { type: "rig-design" }, ...sloop }, [HULL]: { "@patchwork": { type: "camber-hull" }, title: "Narrow transom" } };
    const listeners = { [DESIGN]: new Set(), [HULL]: new Set() };
    const emit = (u) => [...listeners[u]].forEach((l) => l());
    const live = (u) => ({ url: u, doc: () => store[u], heads: () => ["h"], on: (ev, fn) => ev === "change" && listeners[u].add(fn), off: (ev, fn) => ev === "change" && listeners[u].delete(fn) });
    let builds = 0;
    getRegistry("scene:source").register({ id: "camber-hull-surface", name: "Camber hull", supportedDatatypes: ["camber-hull"], params: [], load: async () => ({ build: async () => (builds++, { glb: GLB }) }) });
    const d = { "@patchwork": { type: "naval-study" } };
    NavalStudyDatatype.init(d);
    const h = fakeHandle(d, { repo: { find: async (u) => live(u) }, url: "automerge:self1111111111111111111111" });
    cleanup = NavalStudyTool(h, element);
    const status = () => element.querySelector('.subject[data-subject="s1"] .status')?.textContent ?? "";
    element.querySelector(".study-add input").value = DESIGN;
    element.querySelector(".study-add").dispatchEvent(new Event("submit", { cancelable: true }));
    // the design has no hull yet: it stands on its synthetic hull, and only the design is followed
    await until(() => /synthetic hull/.test(status()));
    expect(listeners[DESIGN].size).toBe(1);
    expect(listeners[HULL].size).toBe(0);
    expect(builds).toBe(0);
    // the designer links a hull: the design's change screens it again, on that hull, which is now followed too
    store[DESIGN] = { ...store[DESIGN], hull: { ...store[DESIGN].hull, link: { url: HULL, frame: { bow: "+X", up: "+Y" } } } };
    emit(DESIGN);
    await until(() => /built by Camber hull/.test(status()));
    expect(builds).toBe(1);
    expect(listeners[DESIGN].size).toBe(1);
    expect(listeners[HULL].size).toBe(1);
    // an edit of the hull alone screens the subject again
    emit(HULL);
    await until(() => builds === 2);
    // the study holds no copy of the link: only the design
    expect(h.doc().subjects[0]).toMatchObject({ hull: null, design: { url: DESIGN, heads: null } });
    expect(element.querySelector(".study-warnings").textContent).toBe("");
    // pinning pins both documents the figures were read from: the design and the hull it links
    element.querySelector('.subject[data-subject="s1"] [data-act="pin"]').click();
    expect(h.doc().subjects[0]).toMatchObject({ hull: null, design: { heads: ["h"], hullHeads: ["h"] } });
    expect(element.querySelector('.subject[data-subject="s1"] .heads').textContent).toBe("pinned design h, hull h");
    // and following again clears both
    await until(() => element.querySelector('.subject[data-subject="s1"] [data-act="follow"]'));
    element.querySelector('.subject[data-subject="s1"] [data-act="follow"]').click();
    expect(h.doc().subjects[0].design).toMatchObject({ heads: null, hullHeads: null });
    expect(element.querySelector('.subject[data-subject="s1"] .heads').textContent).toBe("latest");
    await until(() => listeners[HULL].size === 1 && /built by Camber hull/.test(status()));
    // and nothing is left listening once the subject goes
    element.querySelector('.subject[data-subject="s1"] [data-act="remove"]').click();
    expect(listeners[DESIGN].size + listeners[HULL].size).toBe(0);
  }, 60_000);
});
