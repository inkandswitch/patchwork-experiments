// The study's panel: what the part is, what it is made of, how it is held
// and loaded, how finely it is meshed, where it runs; then its runs and what
// they found. It talks to a 3D view through a small interface (`stage`), so
// the same panel sits beside the study's own viewport (study-tool.js) and
// over a scene's stage (../scene/edit.js).
//
// Every control calls ../study-model.js, the same functions an agent's tools
// call. The panel keeps nothing of its own in the document: which item is
// being picked for, which tab is open and how results are drawn are this
// viewer's alone.
//
// The server is a task queue: who serves it is heard (task-client.js's
// `served`), not read. A run that hasn't ended has its task followed too
// (`watch`): what its run doc can't say (cancelled before it started, a
// machine that stopped) is read from both (shownRun).
//
//   stage = {
//     view,                            a part view (../view/part-view.js)
//     onPick(fn), onHover(fn),         a face clicked, a face under the pointer (or null)
//     frame(), invalidate(),
//     setLegend(legend, note),
//     setHint(text),                   a line said in the view (what the pointer is over)
//     animate(fn | null) }

import { normalizeSetup, setupProblems, readiness, listOf, meshEstimate, elementSize, describeLoad, SUPPORT_KINDS, LOAD_KINDS, ANALYSES, MESH_PRESETS, MAX_MODES } from "../setup.js";
import { MATERIALS } from "../materials.js";
import { unitsOf, convert, pretty, prettyUnit, num, format, DIMENSIONS } from "../units.js";
import { describeFace } from "../part/faces.js";
import { decodePart } from "../part/kept.js";
import { placeOf, setupGlyphs } from "../draw/glyphs.js";
import { resultGeometry, fieldChoices, modesOf } from "../draw/result.js";
import { isTerminal, decodeLayer } from "../protocol.js";
import { queueCounts, servedBy, aheadOf, shownRun, findWhenThere } from "../task-runs.js";
import { served, watch } from "../task-client.js";
import { BEAT_MS } from "../task-rules.js";
import { internalize } from "../segments.js";
import { figures, inputs, headline, statusLine, duration } from "../results.js";
import { hasPatchworkDrop, parsePatchworkDrop, parseAutomergeUrl } from "../dnd.js";
import * as model from "../study-model.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LAST_SERVER = "fea:last-server";

const DIRECTIONS = [
  { id: "down", label: "Down (−y)", v: [0, -1, 0] },
  { id: "up", label: "Up (+y)", v: [0, 1, 0] },
  { id: "+x", label: "Along +x", v: [1, 0, 0] },
  { id: "-x", label: "Along −x", v: [-1, 0, 0] },
  { id: "+z", label: "Along +z", v: [0, 0, 1] },
  { id: "-z", label: "Along −z", v: [0, 0, -1] },
];

async function whoAmI(repo) {
  try {
    const contact = window.accountDocHandle?.doc()?.contactUrl;
    if (!contact) return null;
    return (await repo.find(contact)).doc()?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {HTMLElement} host
 * @param {{ repo: object, handle: object, stage: object, element?: HTMLElement }} o
 *   element: where `patchwork:open-document` is dispatched from (the tool's own element)
 * @returns {{ dispose(): void, state(): object }}
 */
export function mountStudyPanel(host, { repo, handle, stage, element = host }) {
  const root = document.createElement("div");
  root.className = "panel";
  root.innerHTML = `
    <input class="title" aria-label="Title" data-key="title">
    <div class="tabs" role="tablist">
      <button role="tab" data-act="tab" data-tab="setup">Setup</button>
      <button role="tab" data-act="tab" data-tab="results">Results <span class="tab-sum"></span></button>
    </div>
    <div class="tab-panel" data-tab="setup">
      <section data-s="part"></section>
      <section data-s="material"></section>
      <section data-s="supports"></section>
      <section data-s="loads"></section>
      <section data-s="mesh"></section>
      <section data-s="server"></section>
      <section data-s="run"></section>
    </div>
    <div class="tab-panel" data-tab="results" hidden>
      <section data-s="runs"></section>
      <section data-s="show"></section>
      <section data-s="figures"></section>
    </div>`;
  host.append(root);
  const $ = (sel) => root.querySelector(sel);
  const section = (name) => $(`section[data-s="${name}"]`);

  const local = {
    tab: "setup",
    active: null, // { what: "support" | "load", id }: clicks on the part add and remove its faces
    picked: null, // a face clicked with nothing active
    hover: null,
    part: null, // the kept part, decoded
    partFor: null, // the kept url `part` is of
    partError: null,
    reading: false,
    changed: null, // has the model changed since it was read
    said: null, // the last action's refusal or news, shown under the part
    server: null, // the server's handle (a task queue)
    serverFor: null,
    serverSince: 0, // when this viewer began listening for who serves it
    pools: [], // the machines heard serving it
    unhear: null, // stops listening
    runs: new Map(), // url → handle
    tasks: new Map(), // run url → its task as followed ({ state, error }), while the run hasn't ended
    unwatch: new Map(), // run url → stops following its task
    results: new Map(), // run url → Promise<{ part, layer }>
    show: { field: null, deform: "auto", sway: false },
    spelled: new Set(), // loads whose direction is shown as its three numbers ("Other…")
    by: null,
    disposed: false,
  };
  whoAmI(repo).then((name) => (local.by = name));
  const ctx = () => ({ repo, handle, by: local.by });

  // ---------------------------------------------------------------- data

  const study = () => handle.doc() ?? {};
  const setupOf = () => normalizeSetup(study().setup);
  /** A run as a person sees it: its doc, with the status its task gives it (shownRun) and a note beside it. */
  const runOf = (url) => {
    const raw = local.runs.get(url)?.doc() ?? null;
    if (!raw) return null;
    const s = shownRun(raw, local.tasks.get(url) ?? null);
    return s.status === raw.status && s.error === (raw.error ?? null) && !s.note ? raw : { ...raw, status: s.status, error: s.error, note: s.note };
  };
  const selectedRun = () => {
    const s = study();
    const url = s.selected && (s.runs ?? []).includes(s.selected) ? s.selected : (s.runs ?? []).at(-1);
    return url ? { url, run: runOf(url) } : null;
  };
  const showingResults = () => local.tab === "results" && selectedRun()?.run?.status === "done";

  function loadPart() {
    const kept = study().part?.kept ?? null;
    if (kept === local.partFor) return;
    local.partFor = kept;
    local.part = null;
    local.partError = null;
    local.changed = null;
    if (!kept) return render();
    model.keptPart(repo, study()).then(
      (part) => {
        if (local.partFor !== kept || local.disposed) return;
        local.part = part;
        render();
        model.partChanged(repo, study()).then((changed) => {
          if (local.partFor !== kept || local.disposed) return;
          local.changed = changed;
          render();
        });
      },
      (err) => {
        if (local.partFor !== kept) return;
        local.partError = String(err?.message ?? err);
        render();
      },
    );
  }

  function loadServer() {
    const url = study().server ?? null;
    if (url === local.serverFor) return;
    local.server?.off("change", render);
    local.unhear?.();
    local.unhear = null;
    local.serverFor = url;
    local.server = null;
    local.pools = [];
    local.serverSince = Date.now();
    if (!url) return;
    // who serves it: heard, not read (each machine says so every couple of seconds)
    local.unhear = served(repo, url, (pools) => {
      if (local.serverFor !== url) return;
      local.pools = pools;
      render();
    });
    findWhenThere(repo, url, { tries: 4 }).then(
      (h) => {
        if (local.serverFor !== url || local.disposed) return;
        local.server = h;
        h.on("change", render);
        try {
          localStorage.setItem(LAST_SERVER, url);
        } catch {
          /* no storage here */
        }
        render();
      },
      () => {},
    );
  }

  /** Follows a run's task while the run hasn't ended: what its run doc can't say is read from it. */
  function followTask(url, run) {
    if (local.unwatch.has(url) || !run?.server || isTerminal(run.status)) return;
    local.unwatch.set(
      url,
      watch(
        repo,
        run.server,
        url,
        (view) => {
          local.tasks.set(url, { state: view.state, error: view.error, runs: view.runs });
          render();
        },
        run.task ? { from: run.task } : {},
      ),
    );
  }

  function loadRuns() {
    const urls = new Set(study().runs ?? []);
    for (const [url, h] of local.runs)
      if (!urls.has(url)) {
        h.off("change", render);
        local.runs.delete(url);
        local.unwatch.get(url)?.();
        local.unwatch.delete(url);
        local.tasks.delete(url);
      }
    for (const url of urls) {
      if (local.runs.has(url)) continue;
      local.runs.set(url, { doc: () => null, off() {}, on() {} });
      findWhenThere(repo, url, { tries: 6 }).then(
        (h) => {
          if (local.disposed || !(study().runs ?? []).includes(url)) return;
          local.runs.set(url, h);
          h.on("change", render);
          followTask(url, h.doc());
          render();
        },
        () => {},
      );
    }
  }

  /** A finished run's part and results, read once. */
  function resultsOf(url, run) {
    if (!local.results.has(url)) {
      const p = (async () => {
        const part = decodePart(await internalize(repo, run.part));
        const layer = decodeLayer(await internalize(repo, (await findWhenThere(repo, run.layers.skin, { tries: 5 })).doc()));
        if (!layer) throw new Error("the run's results haven't arrived");
        return { part, layer };
      })();
      local.results.set(url, p);
      p.catch(() => local.results.delete(url));
    }
    return local.results.get(url);
  }

  // ---------------------------------------------------------------- the 3D view

  let drawn = { key: null };
  let framed = null;
  /** Look at the part when a new one first shows; never again for the same one (the camera is the viewer's). */
  const frameOnce = (key) => {
    if (framed === key) return;
    framed = key;
    stage.frame();
  };
  function draw() {
    const sel = selectedRun();
    if (showingResults()) {
      const key = `result|${sel.url}|${local.show.field}|${local.show.deform}`;
      if (drawn.key === key) return;
      drawn = { key };
      resultsOf(sel.url, sel.run).then(
        ({ part, layer }) => {
          if (drawn.key !== key || local.disposed) return;
          const g = resultGeometry(layer, { field: local.show.field, deform: local.show.deform, diagonal: part.diagonal });
          stage.view.setPart(part);
          stage.view.setTints({ supports: new Set(), loads: new Set(), active: new Set(), hover: null, picked: null });
          stage.view.setResult(g);
          stage.view.setMarks(setupGlyphs(part, normalizeSetup(sel.run.setup)));
          // a mode's shape has no size of its own, so there is no "really" to compare with
          const modal = sel.run.summary?.kind === "modal";
          const note = modal ? (g.scale ? "a mode's shape, drawn large enough to see" : "") : g.scale && g.scale !== 1 ? `drawn moved ${num(g.scale, 2)}× what it really moves` : g.scale === 1 ? "drawn as it really moves" : "";
          stage.setLegend(g.legend, note);
          sway();
          frameOnce(local.partFor ?? sel.url);
          stage.invalidate();
          // the form's field menu follows what the layer has
          if (local.show.field !== g.field) {
            local.show.field = g.field;
            drawn.key = `result|${sel.url}|${g.field}|${local.show.deform}`;
            render();
          }
        },
        (err) => {
          if (drawn.key !== key) return;
          stage.setLegend(null, `the results couldn't be read: ${err?.message ?? err}`);
        },
      );
      return;
    }
    const setup = setupOf();
    const key = `part|${local.partFor}|${!!local.part}`;
    if (drawn.key !== key) {
      drawn = { key };
      stage.animate(null);
      stage.view.setPart(local.part);
      stage.view.setResult(null);
      stage.setLegend(null, "");
    }
    if (!local.part) return stage.invalidate();
    const faces = (map) => new Set(listOf(map).flatMap((x) => x.faces ?? []));
    const act = local.active ? (local.active.what === "support" ? setup.supports : setup.loads)[local.active.id] : null;
    stage.view.setTints({ supports: faces(setup.supports), loads: faces(setup.loads), active: new Set(act?.faces ?? []), hover: local.hover, picked: local.picked });
    stage.view.setMarks(setupGlyphs(local.part, setup));
    frameOnce(local.partFor);
    stage.invalidate();
  }

  function sway() {
    const sel = selectedRun();
    if (!local.show.sway || !showingResults()) return stage.animate(null);
    const modal = sel.run.summary?.kind === "modal";
    // a mode swings both ways; a static result goes from rest to loaded and back
    stage.animate((t) => stage.view.sway(modal ? Math.sin((2 * Math.PI * t) / 1.6) : (1 - Math.cos((2 * Math.PI * t) / 2.4)) / 2));
  }

  /** Say, in the view, what the pointer is over, or what a click there will do. */
  function hint() {
    if (showingResults() || !local.part) return stage.setHint?.("");
    const act = local.active ? (local.active.what === "support" ? setupOf().supports : setupOf().loads)[local.active.id] : null;
    if (local.hover != null) {
      const on = act?.faces?.includes(local.hover);
      return stage.setHint?.(`${faceLine(local.hover)}${act ? ` · click to ${on ? "take it off" : "put it on"} “${act.name}”` : ""}`);
    }
    stage.setHint?.(act ? `Click the faces “${act.name}” is on` : "");
  }
  stage.onHover((hit) => {
    const face = hit?.face ?? null;
    if (showingResults() || face === local.hover) return;
    local.hover = face;
    draw();
    hint();
  });
  stage.onPick((hit) => {
    if (showingResults() || !local.part) return;
    const face = hit?.face ?? null;
    if (local.active) {
      if (face == null) return;
      say(model.toggleFace(ctx(), local.part, local.active.what, local.active.id, face));
    } else {
      local.picked = face === local.picked ? null : face;
      render();
    }
  });

  // ---------------------------------------------------------------- words

  const lengthUnit = () => (local.part ? prettyUnit(Math.max(...[0, 1, 2].map((k) => local.part.box.max[k] - local.part.box.min[k])), "length") : "mm");
  const len = (x) => pretty(x, "length", { unit: lengthUnit() });
  const faceLine = (id) => {
    const f = local.part?.faces.find((x) => x.id === id);
    return f ? `Face ${id}: ${describeFace(f, len)}, ${pretty(f.area, "area")}` : `Face ${id}`;
  };
  function say(result, good = null) {
    local.said = result?.ok === false ? { bad: true, text: result.error } : good ? { bad: false, text: good } : null;
    render();
    return result;
  }

  // ---------------------------------------------------------------- sections

  /** A value with its unit: a number field and a unit menu. `act` (default: its key) names what a change does, `id` whose it is. */
  const quantity = (q, dimension, key, { act = key, id = null, extra = "" } = {}) => {
    const whose = id ? ` data-id="${id}"` : "";
    return `<span class="pair"><input type="number" step="any" data-key="${key}" data-act="${act}"${whose} value="${q?.value ?? ""}" ${extra}><select data-key="${key}-unit" data-act="${act}-unit"${whose}>${unitsOf(dimension)
      .map((u) => `<option value="${esc(u)}"${q?.unit === u ? " selected" : ""}>${esc(u)}</option>`)
      .join("")}</select></span>`;
  };

  function partHtml() {
    const s = study();
    const p = s.part;
    const head = `<h2>Part</h2>`;
    const link = `<div class="cluster"><input type="text" class="part-url" data-key="part-url" data-act="part-url" placeholder="Drop a model here, or paste its link"></div>`;
    const said = local.said ? `<div class="${local.said.bad ? "warn" : "hint"}">${esc(local.said.text)}</div>` : "";
    if (local.reading) return `${head}<div class="hint">reading the model…</div>`;
    if (!p) return `${head}<div class="drop part-drop"><div class="hint">The solid to analyse: an OpenSCAD or CAD model, an STL or GLB file, or an object's render from a scene.</div>${link}</div>${said}`;
    const part = local.part;
    const dims = part ? [0, 1, 2].map((k) => part.box.max[k] - part.box.min[k]) : null;
    const density = DIMENSIONS.density.units[setupOf().material.density.unit] * setupOf().material.density.value;
    const rows = part
      ? `<table class="figures">
          <tr><td>Size</td><td>${dims.map((d) => num(d / DIMENSIONS.length.units[lengthUnit()], 4)).join(" × ")} ${lengthUnit()} <span class="hint">(x, y, z)</span></td></tr>
          <tr><td>Volume</td><td>${part.solid ? pretty(part.volume, "volume") : "–"}</td></tr>
          <tr><td>Mass</td><td>${part.solid ? pretty(part.volume * density, "mass") : "–"}</td></tr>
          <tr><td>Faces</td><td>${part.faces.length}, of ${(part.tris.length / 3).toLocaleString("en")} triangles</td></tr>
        </table>`
      : local.partError
        ? `<div class="warn">${esc(local.partError)}</div>`
        : `<div class="hint">loading…</div>`;
    const problems = part ? [...part.problems.map((x) => `<div class="warn">It can't be meshed: ${esc(x)}.</div>`), ...part.notes.map((x) => `<div class="hint">${esc(x)}.</div>`)].join("") : "";
    const changed = local.changed === true ? `<div class="warn">The model has changed since it was read.</div>` : "";
    return `${head}
      <div class="drop part-drop">
        <div class="chip part-chip"><a href="#" data-act="open-part" title="Open the model">${esc(p.title ?? "part")}</a><span class="hint">${esc(p.how ?? "")}, read ${new Date(p.readAt).toLocaleString()}</span></div>
        ${rows}${problems}${changed}
        <div class="cluster"><button data-act="reread" ${local.changed === true ? "data-primary" : ""} title="Read the model again and split it into faces afresh. Supports and loads move onto the faces that are still alike">Read again</button><button data-act="unlink">Unlink</button></div>
        <details class="other-part"><summary>Another model</summary>${link}</details>
      </div>${said}
      ${local.picked != null && !local.active ? `<div class="picked"><div>${esc(faceLine(local.picked))}</div><div class="cluster"><button data-act="fix-picked">Fix it</button><button data-act="force-picked">Push on it</button><button data-act="pressure-picked">Pressure on it</button></div></div>` : ""}`;
  }

  function materialHtml() {
    const setup = setupOf();
    const m = setup.material;
    const listed = MATERIALS.find((x) => x.name === m.name);
    const options = MATERIALS.map((x) => `<option value="${x.id}"${listed?.id === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("");
    const analysis = ANALYSES.map((a) => `<option value="${a.id}"${setup.analysis === a.id ? " selected" : ""}>${esc(a.label)}</option>`).join("");
    return `<h2>Material</h2>
      <label class="field"><span>Material</span><select data-key="material" data-act="material">${listed ? "" : `<option value="" selected>${esc(m.name)}</option>`}${options}</select></label>
      ${listed?.note ? `<div class="hint">${esc(listed.note)}</div>` : ""}
      <label class="field" title="Young's modulus: how stiff it is"><span>Stiffness E</span>${quantity(m.E, "pressure", "E", { extra: 'min="0"' })}</label>
      <label class="field" title="How much it thins when stretched: 0.3 for most metals, near 0.5 for rubber"><span>Poisson's ratio</span><input type="number" step="0.01" min="-0.99" max="0.499" data-key="nu" data-act="nu" value="${m.nu}"></label>
      <label class="field"><span>Density</span>${quantity(m.density, "density", "density", { extra: 'min="0"' })}</label>
      <label class="field" title="The stress at which it stops springing back. The safety factor is measured against it. Empty: none"><span>Yield strength</span>${quantity(m.yield ?? { value: "", unit: "MPa" }, "pressure", "yield", { extra: 'min="0" placeholder="none"' })}</label>
      <h2 class="gap">Analysis</h2>
      <label class="field"><span>Kind</span><select data-key="analysis" data-act="analysis">${analysis}</select></label>
      ${setup.analysis === "modal" ? `<label class="field"><span>Modes</span><input type="number" step="1" min="1" max="${MAX_MODES}" data-key="modes" data-act="modes" value="${setup.modes}"></label>` : ""}`;
  }

  const facesHtml = (what, item) => {
    const on = local.active?.what === what && local.active.id === item.id;
    const n = item.faces.length;
    const chips = on
      ? `<div class="face-chips">${item.faces.map((f) => `<span class="chip" title="${esc(faceLine(f))}">Face ${f}<button class="x" data-act="drop-face" data-what="${what}" data-id="${item.id}" data-face="${f}" aria-label="Take face ${f} off">×</button></span>`).join("")}${n ? "" : `<span class="hint">click faces on the part</span>`}</div>`
      : "";
    return `<div class="cluster"><button data-act="pick" data-what="${what}" data-id="${item.id}" aria-pressed="${on}" ${on ? "data-primary" : ""} title="Click faces on the part to add them, again to take them off">${on ? "Done" : n ? `${n} face${n === 1 ? "" : "s"}` : "Pick faces"}</button>${!on && !n ? `<span class="warn-inline">no faces yet</span>` : ""}</div>${chips}`;
  };

  function supportsHtml() {
    const setup = setupOf();
    const items = listOf(setup.supports)
      .map(
        (s) => `<div class="item" data-what="support" data-id="${s.id}">
          <div class="item-head"><input type="text" class="name" data-key="s-name-${s.id}" data-act="support-name" data-id="${s.id}" value="${esc(s.name)}" aria-label="Name"><button class="x" data-act="remove-support" data-id="${s.id}" aria-label="Remove ${esc(s.name)}" title="Remove">×</button></div>
          <label class="field"><span>Kind</span><select data-key="s-kind-${s.id}" data-act="support-kind" data-id="${s.id}">${SUPPORT_KINDS.map((k) => `<option value="${k.id}"${s.kind === k.id ? " selected" : ""} title="${esc(k.blurb)}">${k.label}</option>`).join("")}</select></label>
          <div class="hint">${esc(SUPPORT_KINDS.find((k) => k.id === s.kind).blurb)}.</div>
          ${facesHtml("support", s)}
        </div>`,
      )
      .join("");
    return `<h2>Supports <span class="hint">how it is held</span></h2>${items || `<div class="hint">Nothing holds it yet.</div>`}
      <div class="cluster adders">${SUPPORT_KINDS.map((k) => `<button data-act="add-support" data-kind="${k.id}" title="${esc(k.blurb)}">+ ${k.label}</button>`).join("")}</div>`;
  }

  function directionHtml(load) {
    const u = load.direction;
    const l = Math.hypot(...u) || 1;
    const v = u.map((x) => x / l);
    const same = (a) => Math.hypot(a[0] - v[0], a[1] - v[1], a[2] - v[2]) < 1e-6;
    const place = load.faces && local.part ? placeOf(local.part, load.faces) : null;
    const into = place?.normal ? place.normal.map((x) => -x) : null;
    let current = local.spelled.has(load.id) ? "custom" : (DIRECTIONS.find((d) => same(d.v))?.id ?? null);
    if (!current && into && same(into)) current = "in";
    if (!current && into && same(into.map((x) => -x))) current = "out";
    current ??= "custom";
    const options = [...DIRECTIONS.map((d) => [d.id, d.label]), ...(load.kind === "force" ? [["in", "Into the face"], ["out", "Away from the face"]] : []), ["custom", "Other…"]];
    const custom = current === "custom" ? `<label class="field"><span>x, y, z</span><span class="pair">${[0, 1, 2].map((k) => `<input type="number" step="any" data-key="l-dir${k}-${load.id}" data-act="load-dir-part" data-id="${load.id}" data-k="${k}" value="${Number(v[k].toFixed(6))}">`).join("")}</span></label>` : "";
    return `<label class="field"><span>Direction</span><select data-key="l-dir-${load.id}" data-act="load-dir" data-id="${load.id}">${options.map(([id, label]) => `<option value="${id}"${current === id ? " selected" : ""}>${label}</option>`).join("")}</select></label>${custom}`;
  }

  function loadsHtml() {
    const setup = setupOf();
    const items = listOf(setup.loads)
      .map((l) => {
        const body =
          l.kind === "pressure"
            ? `<label class="field" title="Positive pushes in; negative pulls"><span>Pressure</span>${quantity(l.pressure, "pressure", `l-pressure-${l.id}`, { act: "load-pressure", id: l.id })}</label>${facesHtml("load", l)}`
            : l.kind === "gravity"
              ? `<label class="field"><span>Acceleration</span>${quantity(l.acceleration, "acceleration", `l-acc-${l.id}`, { act: "load-acc", id: l.id, extra: 'min="0"' })}</label>${directionHtml(l)}`
              : `<label class="field" title="The total over all its faces"><span>Force</span>${quantity(l.magnitude, "force", `l-mag-${l.id}`, { act: "load-mag", id: l.id, extra: 'min="0"' })}</label>${directionHtml(l)}${facesHtml("load", l)}`;
        return `<div class="item" data-what="load" data-id="${l.id}">
          <div class="item-head"><input type="text" class="name" data-key="l-name-${l.id}" data-act="load-name" data-id="${l.id}" value="${esc(l.name)}" aria-label="Name"><span class="kind">${LOAD_KINDS.find((k) => k.id === l.kind).label}</span><button class="x" data-act="remove-load" data-id="${l.id}" aria-label="Remove ${esc(l.name)}" title="Remove">×</button></div>
          ${body}
        </div>`;
      })
      .join("");
    return `<h2>Loads <span class="hint">what pushes on it</span></h2>${items || `<div class="hint">Nothing pushes on it yet.</div>`}
      <div class="cluster adders">${LOAD_KINDS.map((k) => `<button data-act="add-load" data-kind="${k.id}" title="${esc(k.blurb)}">+ ${k.label}</button>`).join("")}</div>`;
  }

  function meshHtml() {
    const setup = setupOf();
    const preset = typeof setup.mesh.size === "string";
    const est = local.part?.solid ? meshEstimate(setup, local.part) : null;
    return `<h2>Mesh</h2>
      <label class="field"><span>Element size</span><select data-key="mesh-size" data-act="mesh-size">${MESH_PRESETS.map((p) => `<option value="${p}"${setup.mesh.size === p ? " selected" : ""}>${p[0].toUpperCase()}${p.slice(1)}</option>`).join("")}<option value="custom"${preset ? "" : " selected"}>A length…</option></select></label>
      ${preset ? "" : `<label class="field"><span>Length</span>${quantity(setup.mesh.size, "length", "mesh-length", { extra: 'min="0"' })}</label>`}
      <label class="field" title="Ten-node elements bend properly and are what stress should be read from. Four-node ones are stiff and rough: for a quick look only"><span>Elements</span><select data-key="mesh-order" data-act="mesh-order"><option value="2"${setup.mesh.order === 2 ? " selected" : ""}>Ten-node (accurate)</option><option value="1"${setup.mesh.order === 1 ? " selected" : ""}>Four-node (rough)</option></select></label>
      ${est ? `<div class="hint">About ${est.nodes.toLocaleString("en")} nodes at ${pretty(est.size, "length")}${preset ? ` (${setup.mesh.size} for this part)` : ""}.</div>` : ""}`;
  }

  function serverHtml() {
    const url = study().server;
    const doc = local.server?.doc();
    let remembered = null;
    try {
      remembered = localStorage.getItem(LAST_SERVER);
    } catch {
      remembered = null;
    }
    if (!url)
      return `<h2>Server</h2><div class="hint">Where it runs: a machine with gmsh and CalculiX serving a queue (daemon/start.sh in this package starts it and prints the queue's link).</div>
        <div class="cluster"><input type="text" data-key="server-url" data-act="server-url" placeholder="Paste the queue's link">${remembered ? `<button data-act="server-last" title="The server this browser last used">Use the last one</button>` : ""}</div>`;
    if (!doc) return `<h2>Server</h2><div class="hint">loading…</div><div class="cluster"><button data-act="server-forget">Change</button></div>`;
    const by = servedBy(local.pools);
    const q = queueCounts(doc, local.pools);
    return `<h2>Server</h2>
      <div class="chip"><span class="dot" data-state="${by ? "online" : "idle"}"></span><a href="#" data-act="open-server">${esc(doc.title ?? "FEA server")}</a><span class="hint">${by ? `served by ${esc(by)}${q.running ? `, running ${q.running}` : ""}${q.waiting ? `, ${q.waiting} waiting` : ""}` : listening() ? "listening…" : "not running"}</span></div>
      ${by || listening() ? "" : `<div class="warn">Nobody is serving it. Start it (daemon/start.sh) on its machine.</div>`}
      <div class="cluster"><button data-act="server-forget">Change</button></div>`;
  }

  /** Whether it's too soon to say nobody serves the queue: a machine says so every couple of seconds. */
  const listening = () => !local.pools.length && Date.now() - local.serverSince < BEAT_MS + 500;

  function runHtml() {
    const setup = setupOf();
    const changed = setupProblems(study().setup);
    const ready = readiness(setup, local.part);
    const blocking = [...ready.blocking];
    if (study().part && !local.part && !local.partError) blocking.length = 0;
    if (!study().server) blocking.push("choose a server");
    else if (local.server && !local.pools.length && !listening()) blocking.push("the server isn't running: nobody is heard serving its queue");
    const why = blocking.length ? `<ul class="why">${blocking.map((b) => `<li>${esc(b[0].toUpperCase() + b.slice(1))}.</li>`).join("")}</ul>` : "";
    const warnings = ready.warnings.map((w) => `<div class="hint">${esc(w[0].toUpperCase() + w.slice(1))}.</div>`).join("");
    const fixed = changed.length ? `<div class="warn">${changed.map((c) => esc(c[0].toUpperCase() + c.slice(1))).join(". ")}.</div>` : "";
    return `<div class="launch"><button class="run" data-act="run" data-primary ${blocking.length ? "disabled" : ""}>Run</button>${why}${warnings}${fixed}<div class="run-said"></div></div>`;
  }

  function runsHtml() {
    const urls = [...(study().runs ?? [])].reverse();
    if (!urls.length) return `<h2>Runs</h2><div class="hint">No runs yet. Set the study up and press Run.</div>`;
    const sel = selectedRun()?.url;
    const now = Date.now();
    const rows = urls
      .map((url) => {
        const run = runOf(url);
        const h = headline(run);
        const going = run && !isTerminal(run.status);
        const found = run?.status !== "done" ? "" : run.summary?.kind === "modal" ? ` · first mode ${h.frequency}` : ` · ${h.stress} · moves ${h.displacement}${h.safety === "–" ? "" : ` · safety ${h.safety}`}`;
        return `<li data-act="select-run" data-url="${url}" data-state="${run?.status ?? "loading"}" aria-selected="${url === sel}" tabindex="0" role="option">
          <span class="dot" data-state="${run?.status ?? "idle"}"></span>
          <div class="run-name"><div class="run-title" title="${esc(run?.title ?? "")}">${esc(run?.title ?? "loading…")}</div><div class="hint">${run ? esc(statusLine(run, now) + found + (run.note ? ` · ${run.note}` : "") + waitingAhead(url, run)) : ""}</div></div>
          ${going ? `<button data-act="stop-run" data-url="${url}">Cancel</button>` : `<button class="x" data-act="forget-run" data-url="${url}" title="Take it off this list" aria-label="Take this run off the list">×</button>`}</li>`;
      })
      .join("");
    return `<h2>Runs</h2><ul class="runs" role="listbox" aria-label="Runs">${rows}</ul>`;
  }

  /** A run waiting in the queue: how many were asked for before it. */
  function waitingAhead(url, run) {
    if (run.status !== "queued" || run.note || !local.server || study().server !== run.server) return "";
    const ahead = aheadOf(local.server.doc(), url);
    return ahead ? ` · ${ahead} ahead of it` : "";
  }

  function showHtml() {
    const sel = selectedRun();
    const run = sel?.run;
    if (!run) return "";
    if (run.status !== "done") {
      const stages = (run.stages ?? [])
        .map((s) => `<li data-state="${s.status}"><span class="dot" data-state="${s.status === "running" ? "solving" : s.status === "done" ? "done" : s.status === "failed" ? "failed" : "idle"}"></span>${esc(s.label)}${s.note ? ` <span class="hint">${esc(s.note)}</span>` : ""}${s.status === "running" && s.tail ? `<pre class="tail">${esc(s.tail)}</pre>` : ""}</li>`)
        .join("");
      return `<h2>${esc(run.title)}</h2><ol class="stages">${stages}</ol>${run.error ? `<div class="warn">${esc(run.error)}</div>` : ""}`;
    }
    const layer = local.layerFields?.url === sel.url ? local.layerFields : null;
    const choices = layer?.choices ?? [];
    const modal = run.summary?.kind === "modal";
    return `<h2>Shown on the part</h2>
      <label class="field"><span>Colour by</span><select data-key="show-field" data-act="show-field">${choices.map((c) => `<option value="${c.id}"${local.show.field === c.id ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
      ${modal ? "" : `<label class="field"><span>Drawn moved</span><select data-key="show-deform" data-act="show-deform"><option value="auto"${local.show.deform === "auto" ? " selected" : ""}>Exaggerated, to be seen</option><option value="true"${local.show.deform === "true" ? " selected" : ""}>As it really moves</option><option value="none"${local.show.deform === "none" ? " selected" : ""}>Not at all</option></select></label>`}
      <label class="field"><span>Moving</span><input type="checkbox" data-key="show-sway" data-act="show-sway"${local.show.sway ? " checked" : ""}></label>`;
  }

  function figuresHtml() {
    const sel = selectedRun();
    const run = sel?.run;
    if (!run || run.status !== "done") return "";
    const notes = (run.notes ?? []).map((n) => `<div class="warn">${esc(n)}</div>`).join("");
    let group = null;
    const rows = figures(run)
      .map((r) => {
        const head = r.group !== group ? `<tr class="group"><td colspan="2">${esc((group = r.group))}</td></tr>` : "";
        const mode = r.group === "Modes" ? Number(r.label.replace("Mode ", "")) : null;
        return `${head}<tr${mode ? ` data-act="show-mode" data-mode="${mode}" tabindex="0" aria-selected="${local.show.field === `m${mode}`}"` : ""} title="${esc(r.title)}"><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`;
      })
      .join("");
    const asked = inputs(run).map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join("");
    return `${notes}<table class="figures wide">${rows}</table>
      <details><summary>What was asked</summary><table class="figures wide">${asked}</table></details>
      ${run.recipe?.deck ? `<details><summary>The solver's input</summary><pre class="tail">${esc(run.recipe.deck)}</pre><div class="hint">Its long lists are cut short here; the whole file, the mesh and CalculiX's own results are on the server, in its runs folder.</div></details>` : ""}
      <div class="cluster"><a href="#" data-act="open-run" data-url="${sel.url}">Open this run on its own</a></div>`;
  }

  // ---------------------------------------------------------------- render

  const keys = new Map();
  /** Replace a section's contents if they changed, keeping the focus and what is being typed. */
  function swap(name, html) {
    if (keys.get(name) === html) return;
    keys.set(name, html);
    const el = section(name);
    const focused = el.contains(document.activeElement) ? document.activeElement : null;
    const key = focused?.dataset.key ?? null;
    const typing = focused && "value" in focused && focused.type !== "checkbox" && focused.tagName !== "SELECT" ? { value: focused.value, start: focused.selectionStart, end: focused.selectionEnd } : null;
    el.innerHTML = html;
    if (!key) return;
    const again = el.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!again) return;
    again.focus({ preventScroll: true });
    if (typing) {
      again.value = typing.value;
      try {
        again.setSelectionRange(typing.start, typing.end);
      } catch {
        /* a number field has no selection to set */
      }
    }
  }

  function render() {
    if (local.disposed) return;
    loadPart();
    loadServer();
    loadRuns();
    const s = study();
    const title = $(".title");
    if (document.activeElement !== title) title.value = s.title ?? "";
    for (const tab of root.querySelectorAll('[role="tab"]')) tab.setAttribute("aria-selected", String(tab.dataset.tab === local.tab));
    for (const p of root.querySelectorAll(".tab-panel")) p.hidden = p.dataset.tab !== local.tab;
    const going = [...local.runs.keys()].filter((url) => {
      const run = runOf(url);
      return run && !isTerminal(run.status);
    }).length;
    $(".tab-sum").textContent = going ? `${going} running` : (s.runs ?? []).length ? String(s.runs.length) : "";
    // an item that has gone can't be picked for
    if (local.active && !(local.active.what === "support" ? setupOf().supports : setupOf().loads)[local.active.id]) local.active = null;
    if (local.tab === "setup") {
      swap("part", partHtml());
      swap("material", materialHtml());
      swap("supports", supportsHtml());
      swap("loads", loadsHtml());
      swap("mesh", meshHtml());
      swap("server", serverHtml());
      swap("run", runHtml());
    } else {
      const sel = selectedRun();
      // which fields the selected run's results have, for the menu (read once they are in)
      if (sel?.run?.status === "done" && local.layerFields?.url !== sel.url) {
        local.layerFields = { url: sel.url, choices: [] };
        resultsOf(sel.url, sel.run).then(({ layer }) => {
          if (local.layerFields?.url !== sel.url) return;
          local.layerFields = { url: sel.url, choices: fieldChoices(layer), modes: modesOf(layer) };
          if (!local.layerFields.choices.some((c) => c.id === local.show.field)) local.show.field = local.layerFields.choices[0].id;
          render();
        }, () => {});
      }
      swap("runs", runsHtml());
      swap("show", showHtml());
      swap("figures", figuresHtml());
    }
    draw();
    hint();
  }

  // ---------------------------------------------------------------- actions

  const open = (url, toolId) => element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: toolId ? { url, toolId } : { url }, bubbles: true, composed: true }));

  async function link(url) {
    local.reading = true;
    local.said = null;
    render();
    let r;
    try {
      r = await model.linkPart(ctx(), url);
    } catch (err) {
      r = { ok: false, error: `couldn't read the model (${err?.message ?? err})` };
    }
    local.reading = false;
    local.picked = null;
    local.active = null;
    if (!r.ok) return say(r);
    const lost = r.lost.length ? ` ${r.lost.map((l) => `“${l.name}” lost ${l.faces} face${l.faces === 1 ? "" : "s"}`).join("; ")}: pick ${r.lost.length === 1 && r.lost[0].faces === 1 ? "it" : "them"} again.` : "";
    say(r, `Read ${r.part.faces.length} faces.${r.carried ? ` ${r.carried} support${r.carried === 1 ? "" : "s"} and load${r.carried === 1 ? "" : "s"} kept their faces.` : ""}${lost}`);
  }

  const number = (el) => (el.value.trim() === "" ? null : Number(el.value));
  const unitOf = (key) => root.querySelector(`[data-key="${CSS.escape(key)}-unit"]`)?.value;
  const valueOf = (key) => {
    const el = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
    return el ? number(el) : null;
  };
  /** A quantity field changed: its value as typed, or (its unit chosen) the same quantity in the new unit. */
  function quantityChange(key, dimension, before, isUnit) {
    if (isUnit) return before ? convert(before, unitOf(key), dimension) : null;
    const value = valueOf(key);
    return value == null ? null : { value, unit: unitOf(key) };
  }

  function onChange(ev) {
    const el = ev.target;
    const act = el.dataset.act;
    if (!act) return;
    const setup = setupOf();
    const id = el.dataset.id;
    const part = local.part;
    const isUnit = act.endsWith("-unit");
    const base = isUnit ? act.slice(0, -5) : act;
    switch (base) {
      case "part-url": {
        const url = parseAutomergeUrl(el.value);
        if (url) link(url);
        else if (el.value.trim()) say({ ok: false, error: "that isn't a document's link" });
        return;
      }
      case "material":
        return el.value ? say(model.setMaterial(ctx(), { id: el.value })) : null;
      case "E":
      case "density": {
        const q = quantityChange(base, base === "E" ? "pressure" : "density", setup.material[base], isUnit);
        return q ? say(model.setMaterial(ctx(), { [base]: q })) : render();
      }
      case "yield": {
        const q = quantityChange("yield", "pressure", setup.material.yield, isUnit);
        if (isUnit && !setup.material.yield) return;
        return say(model.setMaterial(ctx(), { yield: q }));
      }
      case "nu":
        return say(model.setMaterial(ctx(), { nu: number(el) }));
      case "analysis":
        return say(model.setAnalysis(ctx(), el.value));
      case "modes":
        return say(model.setModes(ctx(), number(el)));
      case "support-name":
        return say(model.updateSupport(ctx(), part, id, { name: el.value }));
      case "support-kind":
        return say(model.updateSupport(ctx(), part, id, { kind: el.value }));
      case "load-name":
        return say(model.updateLoad(ctx(), part, id, { name: el.value }));
      case "load-mag": {
        const q = quantityChange(`l-mag-${id}`, "force", setup.loads[id]?.magnitude, isUnit);
        return q ? say(model.updateLoad(ctx(), part, id, { magnitude: q })) : render();
      }
      case "load-pressure": {
        const q = quantityChange(`l-pressure-${id}`, "pressure", setup.loads[id]?.pressure, isUnit);
        return q ? say(model.updateLoad(ctx(), part, id, { pressure: q })) : render();
      }
      case "load-acc": {
        const q = quantityChange(`l-acc-${id}`, "acceleration", setup.loads[id]?.acceleration, isUnit);
        return q ? say(model.updateLoad(ctx(), part, id, { acceleration: q })) : render();
      }
      case "load-dir": {
        const load = setup.loads[id];
        if (!load) return;
        const preset = DIRECTIONS.find((d) => d.id === el.value);
        if (el.value === "custom") {
          // its three numbers, to change: nothing is written until one is
          local.spelled.add(id);
          return render();
        }
        local.spelled.delete(id);
        if (preset) return say(model.updateLoad(ctx(), part, id, { direction: preset.v }));
        const place = part ? placeOf(part, load.faces ?? []) : null;
        if (!place?.normal) return say({ ok: false, error: "pick the load's faces first (and faces that face one way): then it can point into them" });
        return say(model.updateLoad(ctx(), part, id, { direction: place.normal.map((x) => (el.value === "in" ? -x : x)) }));
      }
      case "load-dir-part": {
        const v = [0, 1, 2].map((k) => valueOf(`l-dir${k}-${id}`) ?? 0);
        return say(model.updateLoad(ctx(), part, id, { direction: v }));
      }
      case "mesh-size":
        if (el.value !== "custom") return say(model.setMesh(ctx(), { size: el.value }));
        // a length to start from: what the preset came to, rounded, in the part's unit
        return say(model.setMesh(ctx(), { size: part ? { value: Number((elementSize(setup, part) / DIMENSIONS.length.units[lengthUnit()]).toPrecision(2)), unit: lengthUnit() } : { value: 2, unit: "mm" } }));
      case "mesh-length": {
        const q = quantityChange("mesh-length", "length", typeof setup.mesh.size === "string" ? null : setup.mesh.size, isUnit);
        return q ? say(model.setMesh(ctx(), { size: q })) : render();
      }
      case "mesh-order":
        return say(model.setMesh(ctx(), { order: Number(el.value) }));
      case "server-url": {
        const url = parseAutomergeUrl(el.value);
        if (!url) return el.value.trim() ? say({ ok: false, error: "that isn't a document's link" }) : null;
        return model.setServer(ctx(), url).then((r) => say(r));
      }
      case "show-field":
        local.show.field = el.value;
        return render();
      case "show-deform":
        local.show.deform = el.value;
        return render();
      case "show-sway":
        local.show.sway = el.checked;
        sway();
        if (!local.show.sway) stage.view.sway(1);
        stage.invalidate();
        return;
    }
  }

  function onClick(ev) {
    const el = ev.target.closest("[data-act]");
    if (!el || !root.contains(el)) return;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "SELECT") return; // theirs is the change event
    if (tag === "A") ev.preventDefault();
    const act = el.dataset.act;
    const part = local.part;
    const id = el.dataset.id;
    switch (act) {
      case "tab":
        local.tab = el.dataset.tab;
        local.active = null;
        drawn = { key: null };
        return render();
      case "open-part":
        return open(study().part.url);
      case "open-server":
        return open(study().server);
      case "open-run":
        return open(el.dataset.url, "fea-run");
      case "reread":
        return link(null);
      case "unlink":
        local.active = null;
        local.picked = null;
        return say(model.unlinkPart(ctx()));
      case "add-support": {
        const r = model.addSupport(ctx(), part, { kind: el.dataset.kind });
        if (r.ok) local.active = { what: "support", id: r.id };
        return say(r);
      }
      case "add-load": {
        const r = model.addLoad(ctx(), part, { kind: el.dataset.kind });
        if (r.ok && el.dataset.kind !== "gravity") local.active = { what: "load", id: r.id };
        return say(r);
      }
      case "fix-picked":
      case "force-picked":
      case "pressure-picked": {
        const face = local.picked;
        const f = part?.faces.find((x) => x.id === face);
        if (!f) return;
        let r;
        if (act === "fix-picked") r = model.addSupport(ctx(), part, { kind: "fixed", faces: [face] });
        else if (act === "pressure-picked") r = model.addLoad(ctx(), part, { kind: "pressure", faces: [face] });
        else {
          // a push goes into the face where the face has a direction; else down
          const n = Math.hypot(...f.normal) > 0.5 ? f.normal.map((x) => -x) : [0, -1, 0];
          r = model.addLoad(ctx(), part, { kind: "force", faces: [face], direction: n });
        }
        local.picked = null;
        return say(r);
      }
      case "pick":
        local.active = local.active?.id === id ? null : { what: el.dataset.what, id };
        local.picked = null;
        return render();
      case "drop-face": {
        const what = el.dataset.what;
        return say(model.toggleFace(ctx(), part, what, id, Number(el.dataset.face)));
      }
      case "remove-support":
        return say(model.removeSupport(ctx(), id));
      case "remove-load":
        return say(model.removeLoad(ctx(), id));
      case "server-forget":
        return model.setServer(ctx(), null).then((r) => say(r));
      case "server-last": {
        let url = null;
        try {
          url = localStorage.getItem(LAST_SERVER);
        } catch {
          url = null;
        }
        return url ? model.setServer(ctx(), url).then((r) => say(r)) : null;
      }
      case "run": {
        el.disabled = true;
        // the machines this panel already hears serving the queue: listening afresh would hold the click up to a beat
        const heard = local.pools.length && local.serverFor === study().server ? local.pools : null;
        return model.runStudy({ ...ctx(), ...(heard ? { hear: async () => heard } : {}) }).then((r) => {
          if (r.ok) {
            local.tab = "results";
            local.active = null;
            drawn = { key: null };
            render();
          } else {
            render();
            const out = $(".run-said");
            if (out) out.innerHTML = `<div class="warn">${esc(r.error)}</div>`;
          }
        });
      }
      case "select-run":
        if (ev.target.closest("button")) return;
        drawn = { key: null };
        return say(model.selectRun(ctx(), el.dataset.url));
      case "stop-run":
        return model.stopRun(ctx(), el.dataset.url).then((r) => say(r));
      case "forget-run":
        return say(model.forgetRun(ctx(), el.dataset.url));
      case "show-mode":
        local.show.field = `m${el.dataset.mode}`;
        return render();
    }
  }

  const onTitle = (ev) => {
    if (ev.target.classList.contains("title")) handle.change((d) => (d.title = ev.target.value));
  };
  const onKey = (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const row = ev.target.closest("tr[data-act], li[data-act]");
    if (row && ev.target === row) {
      ev.preventDefault();
      row.click();
    }
  };
  root.addEventListener("change", onTitle);
  root.addEventListener("change", onChange);
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);

  // a document dropped on the part's box is the part
  const overDrop = (ev) => ev.target.closest?.(".part-drop");
  const onDragOver = (ev) => {
    if (!overDrop(ev) || !hasPatchworkDrop(ev.dataTransfer)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "link";
  };
  const onDrop = (ev) => {
    if (!overDrop(ev)) return;
    const dropped = parsePatchworkDrop(ev.dataTransfer);
    if (!dropped.length) return;
    ev.preventDefault();
    ev.stopPropagation();
    link(dropped[0].url);
  };
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("drop", onDrop);

  handle.on("change", render);
  // times ("done in 12 s", "online") move on their own
  const clock = setInterval(render, 5000);
  render();

  return {
    root,
    state: () => ({ tab: local.tab, active: local.active, picked: local.picked, part: local.part ? { faces: local.part.faces.length, solid: local.part.solid } : null, showing: stage.view.showing(), field: local.show.field }),
    /** For a host that has its own way to say which tab (a probe, the scene). */
    setTab(tab) {
      local.tab = tab;
      drawn = { key: null };
      render();
    },
    dispose() {
      local.disposed = true;
      clearInterval(clock);
      handle.off("change", render);
      local.server?.off("change", render);
      local.unhear?.();
      for (const stop of local.unwatch.values()) stop();
      for (const h of local.runs.values()) h.off?.("change", render);
      stage.animate(null);
      stage.setHint?.("");
      root.remove();
    },
  };
}
