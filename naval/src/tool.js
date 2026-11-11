// The Rig tool: fields for the hull, rig, sails and loading on the left, the
// profile drawing and the Numbers panel on the right. The doc holds only the
// authored design (SI); every figure is recomputed from it on each change.
// The unit system (m / ft) is per viewer, kept in localStorage.
//
// A linked hull is read here (link/hull-link.js) and followed: an edit of
// the hull's doc reads it again. Only the hull itself links (real size): a
// scene render is refused with "link the hull itself". The heeled statics (a
// Chartroom table) are built in a worker once the hull has been still for
// STATICS_IDLE_MS, so editing the rig never waits on them.
//
// The performance polar (naval/vpp.js) runs in a second worker once the
// design has been still for STATICS_IDLE_MS; until it is back, the last
// polar is shown dimmed. The reference point and the helm verdict are
// computed on every render.
//
// The drawing's handles (handles.js) drag the mast, rake, I, P, E, BAS, the
// forestay tack, the headsail's clew and the keel's and rudder's corners.
// A drag writes through handle.change at most once an animation frame, holds
// the drawing's viewBox still until it ends, and reads the geometry it
// started from, so the drawing re-laying itself out never feeds back.

import css from "./rig.css?inline";
import { normalize, setPath, pathKey, getPath } from "./doc.js";
import { computeNumbers, hullFormFor, designKey } from "./numbers.js";
import { profileSvg } from "./profile.js";
import { handlePoints, dragWrites } from "./handles.js";
import { BULB_CP } from "./naval/foils.js";
import { FIELD_GROUPS, fieldText, fieldEstimated, numbersHtml, glanceHtml, HEADSAIL_OPTIONS } from "./panels.js";
import { parseQuantity } from "./naval/units.js";
import { jOf } from "./naval/sailplan.js";
import { acquireHull, hullPathChip } from "./link/hull-link.js";
import { parseAutomergeUrl, parsePatchworkDrop, hasPatchworkDrop } from "./link/dnd.js";
import { DEFAULT_FRAME } from "./naval/hull-frame.js";
import { createStaticsRunner } from "./statics-runner.js";
import { staticsJobFor, ownTableFor } from "./rig-build.js";
import { FIXTURES, fixtureDoc } from "./fixtures/index.js";
import { firstGuess, FIRST_GUESS_KEYS, targetLead } from "./firstguess.js";
import { mastForHelm, mastForLead, scaleToSAD } from "./helpers.js";
import { formatQuantity, formatText } from "./naval/units.js";
import { validate as validateContract, errorText } from "../contract/v1/validate.js";

export const STATICS_IDLE_MS = 150;
/** A press must move this far (screen px) before it is a drag. */
export const DRAG_SLOP_PX = 3;
const LINK_DEBOUNCE_MS = 300;
const LINK_RETRY_MS = 1000;
const LINK_RETRY_MAX_MS = 30_000;

const UNITS_KEY = "rig-design:units";
const readUnits = () => {
  try {
    return localStorage.getItem(UNITS_KEY) === "imperial" ? "imperial" : "metric";
  } catch {
    return "metric";
  }
};
const writeUnits = (u) => {
  try {
    localStorage.setItem(UNITS_KEY, u);
  } catch {
    // per-viewer convenience only
  }
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default function RigTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "rig-design";
  root.innerHTML = `
    <header class="rig-bar cluster">
      <h2 class="rig-title"></h2>
      <span class="chip" data-chip="hull">Hull: principal dimensions</span>
      <div class="units cluster" role="group" aria-label="Units">
        <button type="button" data-units="metric">m</button>
        <button type="button" data-units="imperial">ft</button>
      </div>
    </header>
    <div class="rig-actions cluster" role="group" aria-label="Start and helpers">
      <select data-act="new-from" aria-label="New from…" title="Replaces this rig's design in one change; the doc's history keeps the old one">
        <option value="">New from…</option>
        <option value="first-guess">First guess from this hull</option>
        <optgroup label="Published boats">${FIXTURES.map((f) => `<option value="fixture:${f.id}">${esc(f.label)}</option>`).join("")}</optgroup>
      </select>
      <form class="helper cluster" data-helper="helm" title="Move the rig (mast and forestay tack together) so the rudder angle that balances yaw at the reference point is this (+ weather)">
        <label>Helm <input name="target" value="3" inputmode="decimal" size="4"> °</label><button type="submit">Move rig</button>
      </form>
      <form class="helper cluster" data-helper="lead" title="Move the rig (mast and forestay tack together) so the designer's CE leads the extended-keel CLR by this % of LWL">
        <label>Lead <input name="target" value="5" inputmode="decimal" size="4"> %</label><button type="submit">Move rig</button>
      </form>
      <form class="helper cluster" data-helper="sad" title="Scale I, J, P and E together (the mast moves with J) to this designer's SA/D">
        <label>SA/D <input name="target" value="17" inputmode="decimal" size="4"></label><button type="submit">Scale rig</button>
      </form>
      <button type="button" data-act="export-contract" title="The contract (contract/v1): frame, hull, loading, foils, sails, resistance, hardpoints, loads and the predicted polar, as JSON. Builds the hydrostatic table and the polar first, about a second.">Export contract JSON</button>
      <p class="helper-status" role="status"></p>
    </div>
    <ul class="rig-warnings" role="status"></ul>
    <div class="rig-body">
      <form class="rig-fields flow" autocomplete="off"></form>
      <div class="rig-main flow">
        <figure class="rig-profile"></figure>
        <div class="rig-glance" role="status" aria-live="off"></div>
        <div class="rig-numbers"></div>
      </div>
    </div>`;
  element.append(style, root);

  const $ = (sel) => root.querySelector(sel);
  const form = $(".rig-fields");
  let units = readUnits();
  let structure = "";
  /** @type {Map<string, { f: object, input: HTMLInputElement|HTMLSelectElement, row: HTMLElement }>} */
  const inputs = new Map();

  const fieldId = (f) => f.key ?? pathKey(f.path);

  function write(fn) {
    handle.change((d) => fn(d));
  }

  let committed = null;

  function commit(f, input) {
    committed = input;
    const doc = normalize(handle.doc());
    const text = input.value;
    const fail = (msg) => {
      committed = null;
      input.setAttribute("data-invalid", "");
      input.title = msg;
    };
    input.removeAttribute("data-invalid");
    input.title = "";
    if (f.kind === "select") {
      write((d) => setPath(d, f.path, text));
      return;
    }
    if (f.kind === "headsail") {
      if (text === "none") write((d) => setPath(d, f.path, null));
      else if (doc.rig.headsail) write((d) => setPath(d, [...f.path, "kind"], text));
      else
        write((d) => {
          setPath(d, f.path, { kind: text, LP: Math.max(0.1, jOf(doc.rig)), clewHeight: null, furl: 0 });
          d.prov = d.prov ?? {};
          d.prov["rig.headsail.LP"] = "estimated";
        });
      return;
    }
    if (f.kind === "speeds") {
      const parts = text.replace(/\b(kn|kt|kts|knots)\s*$/i, "").split(/[,\s]+/).filter(Boolean);
      const vals = [];
      for (const p of parts) {
        const r = parseQuantity(p, "speed", units);
        if (!r.ok || !(r.value > 0)) return fail(`"${p}" is not a wind speed`);
        vals.push(r.value);
      }
      if (!vals.length) return fail("give at least one wind speed");
      write((d) => setPath(d, f.path, vals.sort((a, b) => a - b)));
      return;
    }
    if (f.kind === "angles") {
      const parts = text.replace(/°/g, " ").split(/[,\s]+/).filter(Boolean);
      const vals = [];
      for (const p of parts) {
        const v = Number(p);
        if (!(v > 0 && v <= 180)) return fail(`"${p}" is not a true wind angle: give degrees, 1 to 180`);
        vals.push(v);
      }
      if (!vals.length) return fail("give at least one angle");
      write((d) => setPath(d, f.path, [...new Set(vals)].sort((a, b) => a - b)));
      return;
    }
    if (f.kind === "reefs") {
      const parts = text.split(/[,\s]+/).filter(Boolean);
      const vals = [];
      for (const p of parts) {
        const r = parseQuantity(p, "percent", units);
        if (!r.ok || !(r.value > 0 && r.value < 1)) return fail(`"${p}" is not a reef: give a % of P between 0 and 100`);
        vals.push(r.value);
      }
      write((d) => setPath(d, f.path, vals.sort((a, b) => a - b)));
      return;
    }
    if (f.kind === "opt" && !text.trim()) {
      write((d) => setPath(d, f.path, null));
      return;
    }
    const r = parseQuantity(text, f.dim, units);
    if (!r.ok) return fail(r.error);
    let v = r.value;
    if (f.integer) v = Math.max(0, Math.round(v));
    if (f.kind === "J") {
      if (!(v > 0)) return fail("J must be more than zero");
      write((d) => setPath(d, ["rig", "mast", "aftOfStem"], doc.rig.forestayAftOfStem + v));
      return;
    }
    write((d) => setPath(d, f.path, v));
  }

  /** A keel kind; a fin-bulb keel with no bulb gets one sized to hold the ballast in lead (estimated). */
  function onKeelKind(doc, kind) {
    write((d) => {
      setPath(d, ["appendages", "keel", "kind"], kind);
      if (kind === "fin-bulb" && !(doc.appendages.keel.bulb?.length > 0 && doc.appendages.keel.bulb?.diameter > 0)) {
        const V = Math.max(0.01, doc.loading.ballast.kg / 11340); // lead
        const D = Math.cbrt(V / (BULB_CP * (Math.PI / 4) * 4.5)); // length 4.5 diameters
        setPath(d, ["appendages", "keel", "bulb"], { length: +(4.5 * D).toFixed(3), diameter: +D.toFixed(3) });
        setPath(d, ["loading", "ballast", "at"], "bulb");
        d.prov = d.prov ?? {};
        d.prov["appendages.keel.bulb.length"] = "estimated";
        d.prov["appendages.keel.bulb.diameter"] = "estimated";
      }
    });
  }

  function onTypeChange(doc, type) {
    write((d) => {
      setPath(d, ["rig", "type"], type);
      if (type === "cutter" && !doc.rig.staysail) {
        const J = jOf(doc.rig) || 0.3 * doc.hull.dims.lwl;
        setPath(d, ["rig", "staysail"], { I2: 0.8 * doc.rig.I, J2: 0.5 * J, LP2: 0.45 * J, clewHeight: null });
        d.prov = d.prov ?? {};
        for (const k of ["I2", "J2", "LP2"]) d.prov[`rig.staysail.${k}`] = "estimated";
      }
    });
  }

  function buildForm(doc) {
    inputs.clear();
    form.innerHTML = "";
    for (const g of FIELD_GROUPS) {
      const fs = document.createElement("fieldset");
      fs.className = "field-group flow";
      fs.dataset.group = g.id;
      fs.innerHTML = `<legend>${esc(g.title)}</legend>${g.note ? `<p class="hint">${esc(g.note)}</p>` : ""}`;
      for (const f of g.fields) {
        if (f.show && !f.show(doc)) continue;
        const id = fieldId(f);
        if (f.kind === "link") {
          fs.append(linkRow(f, id));
          continue;
        }
        const row = document.createElement("label");
        row.className = "field";
        row.dataset.field = id;
        let input;
        if (f.kind === "select" || f.kind === "headsail") {
          input = document.createElement("select");
          const options = f.kind === "headsail" ? HEADSAIL_OPTIONS : f.options;
          input.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
          input.addEventListener("change", () => {
            if (f.path && pathKey(f.path) === "rig.type") onTypeChange(normalize(handle.doc()), input.value);
            else if (f.path && pathKey(f.path) === "appendages.keel.kind") onKeelKind(normalize(handle.doc()), input.value);
            else commit(f, input);
          });
        } else {
          input = document.createElement("input");
          input.type = "text";
          input.inputMode = "decimal";
          input.spellcheck = false;
          if (f.kind === "opt") input.placeholder = "auto";
          input.addEventListener("change", () => commit(f, input));
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(f, input);
            }
          });
        }
        input.name = id;
        row.innerHTML = `<span class="field-label">${esc(f.label)}<span class="est" hidden>est.</span></span>`;
        row.append(input);
        if (f.hint) {
          const hint = document.createElement("span");
          hint.className = "hint";
          hint.textContent = f.hint;
          row.append(hint);
        }
        fs.append(row);
        inputs.set(id, { f, input, row });
      }
      form.append(fs);
    }
  }

  // ── the linked hull
  const findRepo = () => globalThis.repo ?? handle.repo ?? null;
  const linked = { url: null, handle: null, off: null, timer: 0, retry: 0, failures: 0, seq: 0, status: "none", mesh: null, error: null, chip: "", path: null };
  let dead = false;

  function linkRow(f, id) {
    const row = document.createElement("div");
    row.className = "hull-link field";
    row.dataset.field = id;
    row.innerHTML = `<span class="field-label">${esc(f.label)}</span>
      <div class="cluster"><input type="text" name="${id}" spellcheck="false" placeholder="paste or drop a hull: automerge:…"><button type="button" data-act="link">Link</button><button type="button" data-act="unlink">Unlink</button></div>
      <span class="link-status" role="status"></span>`;
    const input = row.querySelector("input");
    const go = () => linkTo(input.value);
    row.querySelector('[data-act="link"]').addEventListener("click", go);
    row.querySelector('[data-act="unlink"]').addEventListener("click", () => write((d) => setPath(d, ["hull", "link"], null)));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        go();
      }
    });
    inputs.set(id, { f, input, row });
    return row;
  }

  function linkTo(text) {
    const url = parseAutomergeUrl(text);
    const row = inputs.get("hull.link");
    if (!url) {
      if (row) {
        row.input.setAttribute("data-invalid", "");
        row.input.title = "not a document link";
      }
      return false;
    }
    if (handle.url && url === handle.url) return false;
    row?.input.removeAttribute("data-invalid");
    // the same hull again (Link pressed, Enter in the field, dropped twice): keep the frame the designer chose
    if (normalize(handle.doc()).hull.link?.url === url) return true;
    write((d) => setPath(d, ["hull", "link"], { url, frame: { ...DEFAULT_FRAME } }));
    return true;
  }

  function disconnect() {
    linked.off?.();
    clearTimeout(linked.timer);
    clearTimeout(linked.retry);
    Object.assign(linked, { url: null, handle: null, off: null, timer: 0, retry: 0, failures: 0, seq: linked.seq + 1, status: "none", mesh: null, error: null, chip: "", path: null });
  }

  function syncLink(doc) {
    const url = doc.hull.link?.url ?? null;
    if (!url) {
      if (linked.url) disconnect();
      return;
    }
    if (url !== linked.url) {
      disconnect();
      linked.url = url;
      linked.status = "loading";
      fetchHull();
    }
  }

  async function fetchHull() {
    const url = linked.url;
    if (!url) return;
    const seq = ++linked.seq;
    clearTimeout(linked.retry);
    let r;
    try {
      r = await acquireHull({ url, repo: findRepo(), handle: linked.handle, selfUrl: handle.url });
    } catch (err) {
      r = { ok: false, error: String(err?.message ?? err), transient: true };
    }
    if (dead || seq !== linked.seq) return;
    if (r.handle && !linked.handle) {
      linked.handle = r.handle;
      const onChange = () => {
        clearTimeout(linked.timer);
        linked.timer = setTimeout(fetchHull, LINK_DEBOUNCE_MS);
      };
      r.handle.on?.("change", onChange);
      linked.off = () => r.handle.off?.("change", onChange);
    }
    if (r.ok || r.transient === false) linked.failures = 0;
    else {
      const wait = Math.min(LINK_RETRY_MAX_MS, LINK_RETRY_MS * 2 ** linked.failures++);
      linked.retry = setTimeout(() => !dead && fetchHull(), wait);
    }
    linked.status = r.ok ? "ready" : linked.mesh ? "ready" : "error";
    if (r.ok) [linked.mesh, linked.path] = [r.mesh, r.path];
    linked.error = r.ok ? null : r.error;
    linked.chip = r.ok ? hullPathChip(r) : linked.chip;
    render();
  }

  // ── the statics, in the worker after the hull is still
  const runner = createStaticsRunner();
  // the table only: the righting curve is read off it on every render (analysis.js), with the mass model's G
  const statics = { form: null, status: "none", table: null, source: null, error: null, timer: 0 };

  function scheduleStatics(form) {
    if (form === statics.form) return;
    clearTimeout(statics.timer);
    Object.assign(statics, { form, status: form ? "computing" : "none", table: null, source: null, error: null });
    if (!form) return;
    // a Chartroom table carried by the linked hull is the authority, when it checks out
    const own = ownTableFor(doc0(), linked, form);
    if (own) {
      Object.assign(statics, { status: "ready", table: own, source: "chartroom" });
      return;
    }
    statics.timer = setTimeout(async () => {
      try {
        const table = await runner.run(staticsJobFor(form));
        if (dead || statics.form !== form) return;
        Object.assign(statics, { status: "ready", table, source: "mesh" });
      } catch (err) {
        if (dead || statics.form !== form || err?.name === "AbortError") return;
        Object.assign(statics, { status: "error", error: String(err?.message ?? err) });
      }
      render();
    }, STATICS_IDLE_MS);
  }

  const doc0 = () => normalize(handle.doc());

  // ── the polar, in its own worker after the design is still
  const polarRunner = createStaticsRunner({ name: "rig-polar" });
  const polar = { key: "", status: "none", result: null, error: null, timer: 0 };

  function schedulePolar(design) {
    const key = designKey(design);
    if (key === polar.key) return;
    clearTimeout(polar.timer);
    polar.key = key;
    if (!key) {
      Object.assign(polar, { status: "none", result: null, error: null });
      return;
    }
    polar.status = "computing";
    polar.timer = setTimeout(async () => {
      try {
        const result = await polarRunner.run({ type: "polar", design });
        if (dead || polar.key !== key) return;
        Object.assign(polar, { status: "ready", result, error: null });
      } catch (err) {
        if (dead || polar.key !== key || err?.name === "AbortError") return;
        Object.assign(polar, { status: "error", error: String(err?.message ?? err) });
      }
      render();
    }, STATICS_IDLE_MS);
  }

  // ── dragging the drawing's handles
  /** @type {ReturnType<typeof computeNumbers>|null} */
  let last = null;
  /** @type {{ id: string, n0: object, ref: number[], p0: number[], c0: number[], moved: boolean, vb: number[], pending: [string[], number, object?][]|null, frame: number, pointerId: number }|null} */
  let drag = null;
  const raf = (f) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(f) : setTimeout(f, 16));
  const caf = (h) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(h) : clearTimeout(h));

  /** A pointer's position in the drawing's frame [x, z], through the held viewBox. */
  function toWorld(e, vb) {
    const svg = $(".profile-svg");
    const rect = svg?.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    const k = Math.min(rect.width / vb[2], rect.height / vb[3]);
    const ox = rect.left + (rect.width - vb[2] * k) / 2;
    const oy = rect.top + (rect.height - vb[3] * k) / 2;
    return [vb[0] + (e.clientX - ox) / k, -(vb[1] + (e.clientY - oy) / k)];
  }

  // a value within half the handles' rounding of where the drag started is no change
  const same = (path, v, v0) => Number.isFinite(v0) && Math.abs(v - v0) < (/Deg$/.test(path[path.length - 1]) ? 0.005 : 0.0005);

  function flush() {
    if (!drag?.pending) return;
    const doc0 = drag.n0.doc;
    const writes = drag.pending.filter(([path, v]) => !same(path, v, getPath(doc0, path)));
    drag.pending = null;
    if (!writes.length) return;
    write((d) => {
      for (const [path, v, o] of writes) {
        const key = pathKey(path);
        const wasEstimated = d.prov?.[key] === "estimated";
        setPath(d, path, v);
        // a value that follows from the one moved (LP kept as a % of J) stays as estimated as it was
        if (o?.keepProv && wasEstimated) d.prov[key] = "estimated";
      }
    });
  }

  function onPointerDown(e) {
    const el = e.target.closest?.("[data-handle]");
    if (!el || !last || drag) return;
    const id = el.getAttribute("data-handle");
    const hp = handlePoints(last).find((h) => h.id === id);
    const vb = $(".profile-svg").getAttribute("viewBox").split(/\s+/).map(Number);
    const p0 = toWorld(e, vb);
    if (!hp || !p0) return;
    e.preventDefault();
    drag = { id, n0: last, ref: hp.ref, p0, c0: [e.clientX, e.clientY], moved: false, vb, pending: null, frame: 0, pointerId: e.pointerId };
    root.setAttribute("data-dragging", id);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    render();
  }

  function onPointerMove(e) {
    if (!drag || (e.pointerId != null && drag.pointerId != null && e.pointerId !== drag.pointerId)) return;
    // a press that hasn't moved a few pixels is a click: it writes nothing
    if (!drag.moved) {
      if (!(Math.hypot(e.clientX - drag.c0[0], e.clientY - drag.c0[1]) >= DRAG_SLOP_PX)) return;
      drag.moved = true;
    }
    const p = toWorld(e, drag.vb);
    if (!p) return;
    const to = [drag.ref[0] + p[0] - drag.p0[0], drag.ref[1] + p[1] - drag.p0[1]];
    drag.pending = dragWrites(drag.id, drag.n0, to, { alone: !!(e.altKey || e.shiftKey) });
    if (!drag.frame)
      drag.frame = raf(() => {
        if (!drag) return;
        drag.frame = 0;
        flush();
      });
  }

  function endDrag() {
    if (!drag) return;
    caf(drag.frame);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    root.removeAttribute("data-dragging");
  }

  function onPointerUp(e) {
    if (!drag) return;
    if (e.type === "pointerup") onPointerMove(e);
    flush();
    endDrag();
    drag = null;
    render();
  }

  let leadKey = "";
  function render() {
    if (dead) return;
    const doc = normalize(handle.doc());
    syncLink(doc);
    const key = [doc.rig.type, doc.rig.headsail ? "hs" : "-", doc.rig.staysail ? "st" : "-", doc.hull.link ? "L" : "-", doc.loading.displacement.from, doc.appendages.keel.kind, units].join("|");
    if (key !== structure) {
      structure = key;
      buildForm(doc);
    }
    root.dataset.units = units;
    for (const b of root.querySelectorAll("[data-units]")) b.setAttribute("aria-pressed", String(b.dataset.units === units));
    $(".rig-title").textContent = doc.title;

    for (const { f, input, row } of inputs.values()) {
      if (f.kind === "link") {
        if (document.activeElement !== input) input.value = fieldText(doc, f, units);
        row.querySelector('[data-act="unlink"]').hidden = !doc.hull.link;
        const st = row.querySelector(".link-status");
        const text = !doc.hull.link
          ? "none: the principal dimensions build a synthetic hull"
          : linked.status === "ready"
            ? `${linked.chip}${linked.error ? ` (last read failed: ${linked.error})` : ""}`
            : linked.status === "pending"
              ? "not built yet"
              : linked.status === "error"
                ? linked.error ?? "can't be read"
                : "reading…";
        st.textContent = text;
        st.dataset.tone = doc.hull.link && linked.status === "error" ? "error" : "";
        continue;
      }
      // a field being typed in keeps its text, unless it was just committed (then it is shown as stored)
      if (document.activeElement !== input || input.tagName === "SELECT" || committed === input) input.value = fieldText(doc, f, units);
      const est = fieldEstimated(doc, f);
      row.querySelector(".est").hidden = !est;
      if (est) row.setAttribute("data-estimated", "");
      else row.removeAttribute("data-estimated");
    }

    committed = null;

    const { form: hullForm } = hullFormFor(doc, linked);
    scheduleStatics(hullForm?.ok ? hullForm : null);
    // mid-drag: the sails' trim is borrowed and only the drawing and the strip are redrawn (one frame's budget)
    const dragging = !!drag?.moved;
    const n = computeNumbers(doc, { linked, statics, polar, dragging });
    schedulePolar(n.design);
    $('[data-chip="hull"]').textContent = n.form
      ? `Hull: ${n.form.kind === "synthetic" ? "synthetic, from principal dimensions" : linked.chip || "linked"}`
      : doc.hull.link
        ? "Hull: linked (box until it is read)"
        : "Hull: box outline";
    $(".rig-warnings").innerHTML = n.warnings.map((w) => `<li>${esc(formatText(w, units))}</li>`).join("");
    last = n;
    const fig = $(".rig-profile");
    const w = fig.clientWidth;
    // the svg is 4:3 and at most 60% of the viewport high
    const box = w > 0 ? [w, Math.min((w * 3) / 4, 0.6 * (globalThis.innerHeight || Infinity))] : undefined;
    fig.innerHTML = profileSvg(n, { handles: true, viewBox: drag?.vb, active: drag?.id, box });
    $(".rig-glance").innerHTML = glanceHtml(n, units);
    const numbers = $(".rig-numbers");
    if (dragging) numbers.setAttribute("data-stale", "");
    else {
      numbers.removeAttribute("data-stale");
      numbers.innerHTML = numbersHtml(n, units);
    }
    // the Lead helper's target: the middle of this rig's and keel's band
    if (key !== leadKey) {
      leadKey = key;
      const t = targetLead(doc.rig.type, doc.appendages.keel.kind);
      const input = $('form[data-helper="lead"] input');
      if (t != null && document.activeElement !== input) input.value = String(+(t * 100).toFixed(1));
    }
  }

  const onUnits = (e) => {
    const b = e.target.closest?.("[data-units]");
    if (!b || b.tagName !== "BUTTON") return;
    units = b.dataset.units === "imperial" ? "imperial" : "metric";
    writeUnits(units);
    render();
  };
  root.addEventListener("click", onUnits);

  // ── "New from…" and the 1-D helpers: each writes one change
  const status = $(".helper-status");
  const say = (text, tone = "") => {
    status.textContent = text;
    status.dataset.tone = tone;
  };
  const len = (m) => formatQuantity(m, "length", units);
  const newFrom = $('[data-act="new-from"]');
  const onNewFrom = () => {
    const v = newFrom.value;
    newFrom.value = "";
    if (!v) return;
    if (v === "first-guess") {
      const g = firstGuess(normalize(handle.doc()), { linked, statics });
      if (!g.ok) return say(`No first guess: ${g.why}.`, "error");
      write((d) => {
        for (const k of FIRST_GUESS_KEYS) d[k] = JSON.parse(JSON.stringify(g.doc[k]));
      });
      const r = g.report;
      say(
        `First guess: ${r.type === "cat" ? "a cat rig" : `a ${r.type} sloop`}, SA/D ${r.saD}, draft ${len(r.draftOverallM)}, keel by the fleet's rule; ${r.targetLead == null ? `lead ${(100 * r.lead).toFixed(1)}%` : `the mast placed for a lead of ${(100 * r.lead).toFixed(1)}%${r.tackAftOfStemM > 5e-4 ? `, the forestay's tack ${len(r.tackAftOfStemM)} aft of the stem` : ""}`}${r.helm ? `; ${r.helm}` : ""}. Every value is a rule of thumb, marked est.`,
      );
      return;
    }
    const f = FIXTURES.find((x) => `fixture:${x.id}` === v);
    if (!f) return;
    const next = normalize(fixtureDoc(f.fixture));
    write((d) => {
      for (const [k, val] of Object.entries(next)) d[k] = JSON.parse(JSON.stringify(val));
    });
    say(`Now ${f.label}, from its published figures; est. marks the values no source gave.`);
  };
  newFrom.addEventListener("change", onNewFrom);

  const onHelper = (e) => {
    const formEl = e.target.closest?.("form[data-helper]");
    if (!formEl) return;
    e.preventDefault();
    const kind = formEl.dataset.helper;
    const text = formEl.querySelector("input").value.replace(/[°%]/g, "").trim();
    const t = Number(text);
    if (!Number.isFinite(t)) return say(`"${text}" isn't a number.`, "error");
    const doc = normalize(handle.doc());
    const ctx = { linked, statics };
    const r = kind === "helm" ? mastForHelm(doc, ctx, t) : kind === "lead" ? mastForLead(doc, ctx, t / 100) : scaleToSAD(doc, ctx, t);
    if (!r.ok) return say(`Nothing moved: ${r.why}.`, "error");
    write((d) => {
      for (const [path, v] of r.writes) setPath(d, path, v);
    });
    if (kind === "sad") say(`Rig scaled ×${r.scale.toFixed(3)}: SA/D ${r.from.toFixed(2)} → ${r.value.toFixed(2)}. J scaled too, so the mast moved.`);
    else {
      const dx = r.x - r.from;
      const what = kind === "helm" ? `helm ${r.value >= 0 ? "weather" : "lee"} ${Math.abs(r.value).toFixed(1)}°` : `lead ${(100 * r.value).toFixed(1)}%`;
      const tack = r.writes.find(([p]) => p[1] === "forestayAftOfStem")?.[1];
      const rigWord = tack != null ? "Rig moved (mast and forestay tack together, J and the sail area kept)" : "Mast moved";
      say(
        `${rigWord} ${Math.abs(dx) < 5e-4 ? "nowhere" : `${len(Math.abs(dx))} ${dx > 0 ? "aft" : "forward"}`}: mast ${len(r.x)} aft of the stem${tack != null ? `, tack ${tack < 0 ? `${len(-tack)} out on a bowsprit` : `${len(tack)} aft of the stem`}` : ""}; ${what}.`,
      );
    }
  };
  // ── "Export contract JSON": the contract the scene source carries, built the same way (rig-build.js) in a worker
  let exportRunner = null;
  const exportBtn = $('[data-act="export-contract"]');
  const headsOf = (h) => {
    try {
      const v = h?.heads?.();
      return Array.isArray(v) ? [...v] : null;
    } catch {
      return null;
    }
  };
  async function exportContract() {
    const doc = normalize(handle.doc());
    if (doc.hull.link && linked.status !== "ready") return say("Not exported: the linked hull isn't read yet.", "error");
    exportBtn.disabled = true;
    say("Building the contract: the hydrostatic table and the polar…");
    exportRunner ??= createStaticsRunner({ name: "rig-export" });
    try {
      const r = await exportRunner.run({
        type: "contract",
        doc: JSON.parse(JSON.stringify(doc)),
        linked: doc.hull.link ? { status: "ready", mesh: linked.mesh, chip: linked.chip } : null,
        source: {
          rigDoc: handle.url ?? null,
          rigHeads: headsOf(handle),
          hull: doc.hull.link ? { path: linked.path, heads: headsOf(linked.handle), glbKey: null } : {},
        },
      });
      if (dead) return;
      if (!r.ok) return say(`Not exported: ${r.why}.`, "error");
      const c = r.contract;
      const v = validateContract(c);
      const name = `${(doc.title || "rig").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "rig"}.rig-contract.json`;
      const saved = download(name, `${JSON.stringify(c, null, 2)}\n`);
      const pts = c.predicted.points;
      const flagged = pts.filter((p) => p.hollow).length;
      say(
        `${saved ? `Exported “${name}”` : "Built the contract (this host blocked the download)"}: ${pts.length} predicted points${flagged ? `, ${flagged} in doubt` : ""}, helm ${c.predicted.helm?.text ?? "not computed"}.${v.ok ? "" : ` It doesn't validate: ${errorText(v)}`}`,
        v.ok ? "" : "error",
      );
      root.dispatchEvent(new CustomEvent("rig-contract", { detail: c, bubbles: true }));
    } catch (err) {
      if (err?.name === "AbortError" || dead) return;
      say(`Not exported: ${err?.message ?? err}.`, "error");
    } finally {
      exportBtn.disabled = false;
    }
  }
  function download(name, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.hidden = true;
      root.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } catch {
      return false;
    }
  }
  const onExport = () => exportContract();
  exportBtn.addEventListener("click", onExport);

  const actions = $(".rig-actions");
  actions.addEventListener("submit", onHelper);
  const figure = $(".rig-profile");
  figure.addEventListener("pointerdown", onPointerDown);
  form.addEventListener("submit", (e) => e.preventDefault());
  const onDragOver = (e) => {
    if (!hasPatchworkDrop(e.dataTransfer)) return;
    e.preventDefault();
    form.setAttribute("data-dropping", "");
  };
  const onDragLeave = () => form.removeAttribute("data-dropping");
  const onDrop = (e) => {
    form.removeAttribute("data-dropping");
    const items = parsePatchworkDrop(e.dataTransfer);
    if (!items.length) return;
    e.preventDefault();
    linkTo(items[0].url);
  };
  form.addEventListener("dragover", onDragOver);
  form.addEventListener("dragleave", onDragLeave);
  form.addEventListener("drop", onDrop);
  const onChange = () => render();

  render();
  handle.on("change", onChange);
  // the drawing's text and handles keep a least on-screen size, so a new width redraws it
  let lastWidth = figure.clientWidth;
  const resize =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          const w = figure.clientWidth;
          if (Math.abs(w - lastWidth) < 1) return;
          lastWidth = w;
          render();
        })
      : null;
  resize?.observe(figure);

  return () => {
    dead = true;
    resize?.disconnect();
    endDrag();
    drag = null;
    figure.removeEventListener("pointerdown", onPointerDown);
    handle.off("change", onChange);
    disconnect();
    clearTimeout(statics.timer);
    runner.dispose();
    clearTimeout(polar.timer);
    polarRunner.dispose();
    form.removeEventListener("dragover", onDragOver);
    form.removeEventListener("dragleave", onDragLeave);
    form.removeEventListener("drop", onDrop);
    root.removeEventListener("click", onUnits);
    newFrom.removeEventListener("change", onNewFrom);
    actions.removeEventListener("submit", onHelper);
    exportBtn.removeEventListener("click", onExport);
    exportRunner?.dispose();
    root.remove();
    style.remove();
  };
}
