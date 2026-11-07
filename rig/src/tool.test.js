import { describe, it, expect, beforeEach, afterEach } from "vitest";
import RigTool from "./tool.js";
import { normalize } from "./doc.js";
import { RigDesignDatatype } from "./datatype.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Just enough DocHandle: doc(), change(fn), on/off("change"). */
function fakeHandle(initial, extra = {}) {
  let doc = initial;
  const listeners = new Set();
  return {
    ...extra,
    doc: () => doc,
    change(fn) {
      const next = structuredClone(doc);
      fn(next);
      doc = next;
      for (const l of listeners) l({ doc });
    },
    on(ev, fn) {
      if (ev === "change") listeners.add(fn);
    },
    off(ev, fn) {
      if (ev === "change") listeners.delete(fn);
    },
    listeners,
  };
}
const seeded = () => {
  const d = {};
  RigDesignDatatype.init(d);
  return d;
};
const commit = (input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

let element;
let cleanup;
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {}
  element = document.createElement("div");
  document.body.append(element);
});
afterEach(() => {
  cleanup?.();
  cleanup = null;
  element.remove();
});

const readout = (id) => element.querySelector(`[data-readout="${id}"]`);

describe("rig tool", () => {
  it("mounts the fields, the drawing and the numbers, and cleans up", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    expect(element.querySelector(".rig-design .profile-svg polygon[data-sail=main]")).toBeTruthy();
    expect(element.querySelector('[data-field="rig.P"] input')).toBeTruthy();
    expect(Number(readout("saDesigner").dataset.value)).toBeCloseTo(55, 9);
    expect(readout("saD").querySelector(".band")).toBeTruthy();
    expect(h.listeners.size).toBe(1);
    cleanup();
    cleanup = null;
    expect(h.listeners.size).toBe(0);
    expect(element.querySelector(".rig-design")).toBeNull();
  });

  it("a field takes '41 ft', stores metres, and the numbers move", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    const before = Number(readout("saD").dataset.value);
    commit(element.querySelector('[data-field="rig.P"] input'), "50 ft");
    expect(h.doc().rig.P).toBeCloseTo(15.24, 12);
    expect(Number(readout("saD").dataset.value)).toBeGreaterThan(before);
  });

  it("typing J moves the mast; an estimated field loses its mark when typed", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    expect(element.querySelector('[data-field="rig.I"]').hasAttribute("data-estimated")).toBe(true);
    commit(element.querySelector('[data-field="J"] input'), "5.2");
    expect(h.doc().rig.mast.aftOfStem).toBeCloseTo(5.2, 12);
    commit(element.querySelector('[data-field="rig.I"] input'), "11 m");
    expect(h.doc().prov["rig.I"]).toBeUndefined();
    expect(element.querySelector('[data-field="rig.I"]').hasAttribute("data-estimated")).toBe(false);
  });

  it("refuses a wrong unit without writing", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    const input = element.querySelector('[data-field="rig.E"] input');
    commit(input, "4 kg");
    expect(input.hasAttribute("data-invalid")).toBe(true);
    expect(h.doc().rig.E).toBe(4.5);
  });

  it("switches to feet per viewer, and to a cat rig without a foretriangle", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    element.querySelector('button[data-units="imperial"]').click();
    expect(element.querySelector('[data-field="rig.P"] input').value).toBe("42.65 ft");
    const type = element.querySelector('[data-field="rig.type"] select');
    type.value = "cat";
    type.dispatchEvent(new Event("change", { bubbles: true }));
    expect(h.doc().rig.type).toBe("cat");
    expect(element.querySelector('[data-field="rig.I"]')).toBeNull();
    expect(readout("foretriangle")).toBeNull();
    type.value = "cutter";
    type.dispatchEvent(new Event("change", { bubbles: true }));
    expect(h.doc().rig.staysail.I2).toBeGreaterThan(0);
    expect(element.querySelector('polygon[data-sail="staysail"]')).toBeTruthy();
  });

  it("warns that a hull under 2 m is a model", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    commit(element.querySelector('[data-field="hull.dims.loa"] input'), "1 m");
    expect(element.querySelector(".rig-warnings").textContent).toMatch(/model, not a boat/);
  });
});

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const until = async (cond, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("the hull under the rig", () => {
  it("with no link, draws a synthetic hull from the dims, its lateral profile, and the hull as floated", async () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    expect(element.querySelector("polygon.hull.mesh")).toBeTruthy();
    expect(element.querySelector('polygon[data-part="lateral-profile"]')).toBeTruthy();
    expect(element.querySelector('[data-chip="hull"]').textContent).toMatch(/synthetic/);
    expect(Number(readout("lwlFloat").dataset.value)).toBeCloseTo(10.5, 6);
    expect(readout("lwlFloat").dataset.prov).toBe("synthetic");
    // the statics follow, off the drag path
    await until(() => readout("gzMax"));
    expect(readout("gzMax").dataset.prov).toBe("table");
    expect(element.querySelector(".gz-chart path.gz-line")).toBeTruthy();
    // a new displacement refloats it: the hull sinks, LWL and Tc grow
    const tc0 = Number(readout("tcFloat").dataset.value);
    h.change((d) => {
      d.loading.displacement = { from: "given", kg: 9000 };
    });
    expect(Number(readout("tcFloat").dataset.value)).toBeGreaterThan(tc0);
  });

  it("links a camber hull's scene render, reads it at its own size, and unlinks", async () => {
    const GLB = new Uint8Array(readFileSync(here("./test/fixtures/camber/narrow-transom.glb")));
    const R = "automerge:rend111111111111111111111";
    const F = "automerge:g1b1111111111111111111111";
    const docs = {
      [R]: { "@patchwork": { type: "scene-render" }, title: "Narrow transom (12 m)", parent: "automerge:hu11111111111111111111111", glbUrl: F, status: "idle" },
      [F]: { "@patchwork": { type: "file" }, name: "Hull.glb", extension: "glb", content: GLB },
    };
    const repo = { find: async (u) => ({ url: u, doc: () => docs[u], on() {}, off() {} }) };
    const h = fakeHandle(seeded(), { repo, url: "automerge:self1111111111111111111111" });
    cleanup = RigTool(h, element);
    const input = element.querySelector('[data-field="hull.link"] input');
    input.value = R;
    element.querySelector('[data-act="link"]').click();
    expect(h.doc().hull.link).toEqual({ url: R, frame: { bow: "+X", up: "+Y" } });
    expect(element.querySelector(".rig-warnings").textContent).toMatch(/Reading the linked hull/);
    await until(() => readout("lwlFloat")?.dataset.prov === "mesh");
    expect(element.querySelector('[data-chip="hull"]').textContent).toMatch(/scene render “Narrow transom \(12 m\)”/);
    expect(Number(readout("lwlFloat").dataset.value)).toBeCloseTo(9.908, 2);
    expect(readout("dL").dataset.prov).toBe("mesh");
    expect(element.querySelector('[data-field="hull.link.frame.bow"] select')).toBeTruthy();
    expect(element.querySelector('[data-field="hull.dims.lwl"]')).toBeNull();
    // the rig stands on the mesh's stem: J is unchanged, the mast is J aft of it
    const stemX = Math.max(...[...element.querySelectorAll("polygon.hull.mesh")].flatMap((p) => p.getAttribute("points").split(" ").map((xy) => Number(xy.split(",")[0]))));
    expect(stemX).toBeGreaterThan(11.8);
    expect(element.querySelector(".rig-warnings").textContent).not.toMatch(/model/);
    // a chosen frame survives pressing Link again on the same hull
    h.change((d) => (d.hull.link.frame = { bow: "-X", up: "+Z" }));
    const writes0 = h.doc().hull.link;
    element.querySelector('[data-field="hull.link"] input').value = R;
    element.querySelector('[data-act="link"]').click();
    expect(h.doc().hull.link).toEqual(writes0);
    expect(h.doc().hull.link.frame).toEqual({ bow: "-X", up: "+Z" });
    element.querySelector('[data-act="unlink"]').click();
    expect(h.doc().hull.link).toBeNull();
    expect(readout("lwlFloat").dataset.prov).toBe("synthetic");
  });
});

describe("dragging on the drawing", () => {
  // a 20 px/m drawing at the origin: client = (svg − viewBox origin) · 20
  const PX = 20;
  let restore;
  beforeEach(() => {
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.classList?.contains("profile-svg")) {
        const vb = this.getAttribute("viewBox").split(" ").map(Number);
        return { left: 0, top: 0, width: vb[2] * PX, height: vb[3] * PX, right: vb[2] * PX, bottom: vb[3] * PX, x: 0, y: 0 };
      }
      return orig.call(this);
    };
    restore = () => (Element.prototype.getBoundingClientRect = orig);
  });
  afterEach(() => restore());

  const vbOf = () => element.querySelector(".profile-svg").getAttribute("viewBox").split(" ").map(Number);
  const client = (vb, [x, z]) => ({ clientX: (x - vb[0]) * PX, clientY: (-z - vb[1]) * PX });
  const ev = (type, o) => new (globalThis.PointerEvent ?? MouseEvent)(type, { bubbles: true, cancelable: true, pointerId: 1, ...o });
  /** Drag a handle by (dx, dz) metres, in `steps` moves. */
  function dragBy(id, dx, dz, steps = 3, mods = {}) {
    const el = element.querySelector(`[data-handle="${id}"]`);
    const vb = vbOf();
    const at = [Number(el.getAttribute("cx")), -Number(el.getAttribute("cy"))];
    el.dispatchEvent(ev("pointerdown", { ...client(vb, at), ...mods }));
    for (let i = 1; i <= steps; i++) window.dispatchEvent(ev("pointermove", { ...client(vb, [at[0] + (dx * i) / steps, at[1] + (dz * i) / steps]), ...mods }));
    window.dispatchEvent(ev("pointerup", { ...client(vb, [at[0] + dx, at[1] + dz]), ...mods }));
  }
  const num = (id) => Number(readout(id).dataset.value);

  it("draws handles for the rig and both foils", () => {
    cleanup = RigTool(fakeHandle(seeded()), element);
    const ids = [...element.querySelectorAll("[data-handle]")].map((e) => e.dataset.handle);
    for (const id of ["mast", "rake", "hounds", "head", "gooseneck", "clew", "tack", "jibClew", "keel.rootLE", "keel.rootTE", "keel.tipLE", "keel.tipTE", "rudder.rootLE", "rudder.tipTE"]) expect(ids).toContain(id);
    for (const m of ["clr-lead", "clr-whole", "hc", "cg", "cb", "lead"]) expect(element.querySelector(`[data-mark="${m}"]`), m).toBeTruthy();
    expect(element.querySelector('polygon[data-part="keel"]')).toBeTruthy();
    expect(element.querySelector('[data-part="rudder-stock"]')).toBeTruthy();
  });

  it("no handle's circle covers another's, so a press lands on the handle it's aimed at", () => {
    // the browser probe found the gooseneck (BAS 0.2 m above the partners) drawn over the mast's handle: a press on
    // the mast dragged BAS. Dispatching on the element (as these tests do) can't see that; the circles' spacing can.
    for (const edit of [null, (d) => (d.rig.BAS = 0)]) {
      const doc = seeded();
      if (edit) edit(doc);
      cleanup?.();
      cleanup = RigTool(fakeHandle(doc), element);
      const cs = [...element.querySelectorAll("[data-handle]")].map((e) => ({ id: e.dataset.handle, x: +e.getAttribute("cx"), y: +e.getAttribute("cy"), r: +e.getAttribute("r") }));
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) expect(Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y), `${cs[i].id} / ${cs[j].id}`).toBeGreaterThanOrEqual(2 * cs[i].r);
    }
    // the gooseneck, drawn off its point, still drags its own point: BAS up by the pointer's travel
    const h = fakeHandle(seeded());
    cleanup();
    cleanup = RigTool(h, element);
    const bas0 = normalize(h.doc()).rig.BAS;
    dragBy("gooseneck", 0, 0.3);
    expect(normalize(h.doc()).rig.BAS).toBeCloseTo(bas0 + 0.3, 3);
    expect(normalize(h.doc()).rig.mast.aftOfStem).toBe(normalize(seeded()).rig.mast.aftOfStem);
  });

  it("the mast handle moves the rig: mast and tack together, J, LP and the sail area kept", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    const d0 = normalize(h.doc());
    const sa0 = num("saActual");
    dragBy("mast", -0.8, 0);
    const d1 = normalize(h.doc());
    expect(d1.rig.mast.aftOfStem).toBeCloseTo(d0.rig.mast.aftOfStem + 0.8, 9);
    expect(d1.rig.forestayAftOfStem).toBeCloseTo(d0.rig.forestayAftOfStem + 0.8, 9);
    expect(d1.rig.headsail.LP).toBe(d0.rig.headsail.LP);
    expect(num("saActual")).toBeCloseTo(sa0, 9);
  });

  it("Alt-drag moves the mast alone: J changes and the headsail keeps its LP % (and its est. mark)", () => {
    const doc = seeded();
    doc.prov = { ...(doc.prov ?? {}), "rig.headsail.LP": "estimated" };
    const h = fakeHandle(doc);
    cleanup = RigTool(h, element);
    const d0 = normalize(h.doc());
    const pct0 = d0.rig.headsail.LP / (d0.rig.mast.aftOfStem - d0.rig.forestayAftOfStem);
    dragBy("mast", -1.5, 0, 3, { altKey: true });
    const d1 = normalize(h.doc());
    expect(d1.rig.forestayAftOfStem).toBe(d0.rig.forestayAftOfStem);
    const pct1 = d1.rig.headsail.LP / (d1.rig.mast.aftOfStem - d1.rig.forestayAftOfStem);
    expect(pct1).toBeCloseTo(pct0, 3);
    expect(h.doc().prov["rig.headsail.LP"]).toBe("estimated");
  });

  it("a press and release without moving writes nothing and keeps every est. mark", () => {
    const h = fakeHandle(seeded());
    let changes = 0;
    const change = h.change;
    h.change = (fn) => {
      changes++;
      change(fn);
    };
    cleanup = RigTool(h, element);
    const prov0 = JSON.stringify(h.doc().prov ?? {});
    const ids = [...new Set([...element.querySelectorAll(".handle[data-handle]")].map((e) => e.dataset.handle))];
    for (const id of ids) dragBy(id, 0, 0, 1);
    expect(changes).toBe(0);
    expect(JSON.stringify(h.doc().prov ?? {})).toBe(prov0);
  });

  it("the mast alone 1 m forward: aftOfStem −1, and the CE and lead move by the hand-computed amounts", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    const d0 = normalize(h.doc());
    const ce0 = num("ceDesignerAft");
    const lead0 = num("lead");
    const clr0 = num("clrLeAft");
    const vb0 = vbOf();
    dragBy("mast", 1, 0, 3, { shiftKey: true });
    const d1 = normalize(h.doc());
    expect(d1.rig.mast.aftOfStem).toBeCloseTo(d0.rig.mast.aftOfStem - 1, 9);
    expect(d1.prov["rig.mast.aftOfStem"]).toBeUndefined();
    // designer's CE aft of stem, by hand: main triangle at a + E/3 (area ½PE), foretriangle at (f + 2a)/3 (area ½I(a − f))
    const ceAft = (a) => {
      const { P, E, I, forestayAftOfStem: f } = d0.rig;
      const Am = 0.5 * P * E, Af = 0.5 * I * (a - f);
      return (Am * (a + E / 3) + (Af * (f + 2 * a)) / 3) / (Am + Af);
    };
    const handCe = ceAft(d1.rig.mast.aftOfStem);
    console.log(`mast +1 m: CE aft ${ce0.toFixed(4)} → ${num("ceDesignerAft").toFixed(4)} (hand ${ceAft(d0.rig.mast.aftOfStem).toFixed(4)} → ${handCe.toFixed(4)}); lead ${(lead0 * 100).toFixed(3)}% → ${(num("lead") * 100).toFixed(3)}%`);
    expect(ce0).toBeCloseTo(ceAft(d0.rig.mast.aftOfStem), 9);
    expect(num("ceDesignerAft")).toBeCloseTo(handCe, 9);
    // the CLR doesn't move, so the lead moves by ΔCE/LWL
    expect(num("clrLeAft")).toBeCloseTo(clr0, 12);
    expect(num("lead") - lead0).toBeCloseTo((ce0 - handCe) / num("lwlFloat"), 9);
    expect(num("lead")).toBeGreaterThan(lead0); // mast forward raises the lead
    // the drag is over
    expect(element.querySelector(".rig-design").hasAttribute("data-dragging")).toBe(false);
    void vb0;
  });

  it("the keel's tip down 0.3 m: span +0.3 and a steeper lift slope; its root aft: the CLR follows", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    const span0 = normalize(h.doc()).appendages.keel.span;
    const slope0 = num("keelSlope");
    dragBy("keel.tipLE", 0, -0.3);
    const k = normalize(h.doc()).appendages.keel;
    expect(k.span).toBeCloseTo(span0 + 0.3, 9);
    expect(h.doc().prov["appendages.keel.span"]).toBeUndefined();
    expect(num("keelSlope")).toBeGreaterThan(slope0);
    const clr0 = num("clrLeAft");
    dragBy("keel.rootLE", -0.5, 0);
    expect(normalize(h.doc()).appendages.keel.aftOfStem).toBeCloseTo(k.aftOfStem + 0.5, 9);
    // the root follows the canoe body's underside, which has a little rocker: 1 mm
    expect(num("clrLeAft")).toBeCloseTo(clr0 + 0.5, 3);
  });

  it("I, P, E and LP follow their handles", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    const r0 = normalize(h.doc()).rig;
    dragBy("head", 0, 0.5);
    dragBy("clew", -0.4, 0);
    dragBy("hounds", 0, -0.25);
    const r = normalize(h.doc()).rig;
    expect(r.P).toBeCloseTo(r0.P + 0.5, 9);
    expect(r.E).toBeCloseTo(r0.E + 0.4, 9);
    expect(r.I).toBeCloseTo(r0.I - 0.25, 3);
  });

  it("writes at most once a frame while dragging", async () => {
    const h = fakeHandle(seeded());
    let changes = 0;
    const change = h.change;
    h.change = (fn) => {
      changes++;
      change(fn);
    };
    cleanup = RigTool(h, element);
    const el = element.querySelector('[data-handle="mast"]');
    const vb = vbOf();
    const at = [Number(el.getAttribute("cx")), -Number(el.getAttribute("cy"))];
    el.dispatchEvent(ev("pointerdown", client(vb, at)));
    for (let i = 1; i <= 20; i++) window.dispatchEvent(ev("pointermove", client(vb, [at[0] + i * 0.01, at[1]])));
    expect(changes).toBe(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(changes).toBe(1);
    window.dispatchEvent(ev("pointerup", client(vb, [at[0] + 0.2, at[1]])));
    expect(changes).toBe(2);
  });
});

describe("keel, rudder, loading and stability fields", () => {
  it("a fin-bulb keel gets a bulb sized for the ballast; the winds take knots", async () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    const kind = element.querySelector('[data-field="appendages.keel.kind"] select');
    kind.value = "fin-bulb";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    const k = normalize(h.doc()).appendages.keel;
    expect(k.bulb.length).toBeGreaterThan(0);
    expect(h.doc().loading.ballast.at).toBe("bulb");
    expect(element.querySelector('[data-field="appendages.keel.bulb.length"]').hasAttribute("data-estimated")).toBe(true);
    expect(element.querySelector('ellipse[data-part="bulb"]')).toBeTruthy();
    commit(element.querySelector('[data-field="conditions.aws"] input'), "10, 15 kn");
    expect(h.doc().conditions.aws).toEqual([10 * 0.5144444444444445, 15 * 0.5144444444444445].map((v) => expect.closeTo(v, 12)));
    await until(() => readout("heel15"));
    expect(readout("heel10")).toBeTruthy();
    expect(element.querySelector(".stability-chart path.rm-line")).toBeTruthy();
    expect(element.querySelectorAll(".stability-chart path.hm-line")).toHaveLength(2);
    expect(readout("reefWind")).toBeTruthy();
  });
});

describe("performance", () => {
  it("reads the helm at the reference point now, and draws the polar and its table when the worker is done", async () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    // synchronous: the reference point and the helm verdict
    const helm = readout("helm");
    expect(helm).toBeTruthy();
    expect(Number.isFinite(Number(helm.dataset.value))).toBe(true);
    expect(helm.querySelector(".band").textContent).toMatch(/helm/);
    expect(Number(readout("refSpeed").dataset.value)).toBeGreaterThan(0);
    // then the polar (on the main thread here: no Worker in the test environment)
    await until(() => element.querySelector(".polar-chart svg path.polar-line"), 60_000);
    const dots = element.querySelectorAll(".polar-chart circle.polar-dot");
    expect(dots.length).toBeGreaterThan(20);
    for (const d of element.querySelectorAll(".polar-chart circle.polar-dot[data-hollow]")) expect(d.querySelector("title").textContent).toMatch(/\. \S/);
    expect(element.querySelector(".polar-table tbody tr th").textContent).toBe("Beat VMG");
    expect(element.querySelector('[data-group="performance"]').hasAttribute("data-stale")).toBe(false);
    // a change dims the polar until it is recomputed
    commit(element.querySelector('[data-field="rig.mast.aftOfStem"] input'), "5.3");
    expect(element.querySelector('[data-group="performance"]').hasAttribute("data-stale")).toBe(true);
    expect(element.querySelector(".polar-chart")).toBeTruthy();
  }, 90_000);

  it("takes true winds, angles and the reference point as typed", () => {
    const h = fakeHandle(seeded());
    cleanup = RigTool(h, element);
    commit(element.querySelector('[data-field="conditions.tws"] input'), "8, 14 kn");
    expect(h.doc().conditions.tws.map((v) => v / 0.5144444444444445)).toEqual([expect.closeTo(8, 9), expect.closeTo(14, 9)]);
    commit(element.querySelector('[data-field="conditions.twa"] input'), "90, 45, 135°");
    expect(h.doc().conditions.twa).toEqual([45, 90, 135]);
    commit(element.querySelector('[data-field="conditions.twa"] input'), "200");
    expect(element.querySelector('[data-field="conditions.twa"] input').hasAttribute("data-invalid")).toBe(true);
    commit(element.querySelector('[data-field="conditions.reference.twa"] input'), "60");
    expect(h.doc().conditions.reference.twa).toBe(60);
    expect(readout("helm").querySelector("dt").textContent).toMatch(/60°/);
  });
});

describe("New from… and the helpers", () => {
  /** A handle that counts its changes. */
  const counted = () => {
    const h = fakeHandle(seeded());
    const change = h.change;
    h.changes = 0;
    h.change = (fn) => {
      h.changes++;
      change(fn);
    };
    return h;
  };
  const choose = (value) => {
    const s = element.querySelector('[data-act="new-from"]');
    s.value = value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const submit = (kind, value) => {
    const f = element.querySelector(`form[data-helper="${kind}"]`);
    f.querySelector("input").value = String(value);
    f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };
  const status = () => element.querySelector(".helper-status");

  it("lists the four published boats and the first guess", () => {
    cleanup = RigTool(fakeHandle(seeded()), element);
    const opts = [...element.querySelectorAll('[data-act="new-from"] option')].map((o) => o.value);
    expect(opts).toEqual(["", "first-guess", "fixture:sloop-12m", "fixture:catalina-30", "fixture:j24", "fixture:laser-ilca7"]);
  });

  it("New from the Catalina 30: one change, her published figures read back, her estimated fields marked", () => {
    const h = counted();
    cleanup = RigTool(h, element);
    choose("fixture:catalina-30");
    expect(h.changes).toBe(1);
    expect(h.doc().title).toBe("Catalina 30 (standard rig)");
    expect(h.doc().published).toBeUndefined();
    expect(element.querySelector(".rig-title").textContent).toBe("Catalina 30 (standard rig)");
    expect(Number(readout("saD").dataset.value)).toBeCloseTo(14.866, 2);
    expect(Number(readout("dL").dataset.value)).toBeCloseTo(291.43, 1);
    expect(element.querySelector('[data-field="hull.dims.bwl"]').hasAttribute("data-estimated")).toBe(true);
    expect(element.querySelector('[data-field="rig.P"]').hasAttribute("data-estimated")).toBe(false);
    expect(status().textContent).toMatch(/Catalina 30/);
    expect(element.querySelector('[data-act="new-from"]').value).toBe("");
  });

  it("New from the Laser: a cat rig, no foretriangle fields", () => {
    const h = counted();
    cleanup = RigTool(h, element);
    choose("fixture:laser-ilca7");
    expect(h.doc().rig.type).toBe("cat");
    expect(element.querySelector('[data-field="rig.I"]')).toBeNull();
    expect(Number(readout("saD").dataset.value)).toBeCloseTo(24.24, 1);
  });

  it("First guess from this hull: one change; the hull stays, SA/D reads 17, every guessed field says est.", () => {
    const h = counted();
    cleanup = RigTool(h, element);
    const hull = structuredClone(h.doc().hull);
    choose("first-guess");
    expect(h.changes).toBe(1);
    expect(h.doc().hull).toEqual(hull);
    expect(Number(readout("saD").dataset.value)).toBeCloseTo(17, 3);
    expect(element.querySelector('[data-field="rig.P"]').hasAttribute("data-estimated")).toBe(true);
    expect(status().textContent).toMatch(/First guess: a masthead sloop, SA\/D 17/);
  });

  it("each helper is one change, and the readouts show what it was asked for", () => {
    const h = counted();
    cleanup = RigTool(h, element);
    submit("sad", 16);
    expect(h.changes).toBe(1);
    expect(Number(readout("saD").dataset.value)).toBeCloseTo(16, 4);
    expect(status().textContent).toMatch(/SA\/D 13\.98 → 16\.00/);
    submit("lead", 4.5);
    expect(h.changes).toBe(2);
    expect(Number(readout("lead").dataset.value)).toBeCloseTo(0.045, 4);
    submit("helm", 1);
    expect(h.changes).toBe(3);
    expect(Number(readout("helm").dataset.value)).toBeCloseTo(1, 1);
    expect(status().textContent).toMatch(/Rig moved \(mast and forestay tack together, J and the sail area kept\) .* (aft|forward): mast .* aft of the stem, tack .*; helm weather 1\.0°/);
    expect(Number(readout("saD").dataset.value)).toBeCloseTo(16, 4); // the rig moved, its area didn't
  }, 60_000);

  it("a helper that can't reach its target says why and writes nothing", () => {
    const h = counted();
    cleanup = RigTool(h, element);
    submit("helm", 80);
    expect(h.changes).toBe(0);
    expect(status().dataset.tone).toBe("error");
    expect(status().textContent).toMatch(/Nothing moved: no mast position/);
    submit("sad", "x");
    expect(status().textContent).toMatch(/isn't a number/);
  }, 60_000);
});

describe("Export contract JSON", () => {
  it("builds the contract the scene source carries, validates it, offers it as a file, and writes nothing to the doc", async () => {
    const h = fakeHandle(seeded(), { url: "automerge:rig" });
    cleanup = RigTool(h, element);
    const before = JSON.stringify(h.doc());
    const created = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => (created.push(blob), "blob:rig");
    URL.revokeObjectURL ??= () => {};
    try {
      const got = new Promise((resolve) => element.addEventListener("rig-contract", (e) => resolve(e.detail), { once: true }));
      element.querySelector('[data-act="export-contract"]').click();
      const c = await got;
      expect(c.format).toBe("patchwork-rig");
      expect(c.source.rigDoc).toBe("automerge:rig");
      expect(c.predicted.status).toBe("computed");
      expect(c.predicted.points.length).toBe(91);
      const status = element.querySelector(".helper-status");
      expect(status.textContent).toMatch(/Exported “12-m-sloop-stock.rig-contract.json”: 91 predicted points/);
      expect(status.dataset.tone).toBe("");
      expect(created).toHaveLength(1);
      expect(JSON.parse(await created[0].text()).name).toBe(c.name);
      expect(JSON.stringify(h.doc())).toBe(before);
      // the rudder angle it states is the one the Balance section shows, once the tool's own table is built
      for (let i = 0; i < 200 && !element.querySelector('[data-readout="rm30"]'); i++) await new Promise((r) => setTimeout(r, 20));
      expect(Number(element.querySelector('[data-readout="helm"]').dataset.value)).toBeCloseTo(c.predicted.reference.rudderDeg, 9);
    } finally {
      URL.createObjectURL = orig;
    }
  });
});
