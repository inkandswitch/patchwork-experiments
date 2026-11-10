// The Naval study view: drop hulls (camber hulls, GLB files) and rig designs
// in, and read them side by side: particulars, stability, resistance,
// balance and performance, every figure with its envelope badge, its
// provenance and (on hover) its method and source, and its difference from
// the baseline. A "What the screen can't tell you" panel lists every figure
// outside its method's range or unavailable, and what no screen here does.
//
// Each subject is resolved on the main thread (study/subjects.js: its docs
// at their heads, the hull read at real size) and screened in a worker
// (study/screen.js through statics-job.js), one runner per subject, so a
// newer screen of a subject supersedes an older one still running. A
// followed subject (heads null) is screened again when its docs change;
// a pinned one never changes. Nothing derived is written to the doc.
//
// Numbers reach the page only through formatFigure (study/figures.js).

import css from "./report.css?inline";
import { normalizeStudy, addSubject, removeSubject, setBaseline, setHeads, STUDY_VERSION } from "./doc.js";
import { subjectFor, resolveSubject } from "./subjects.js";
import { compare } from "./compare.js";
import { formatFigure, reviveFigure } from "./figures.js";
import { METHOD_VERSION } from "./screen.js";
import { createStaticsRunner } from "../statics-runner.js";
import { parseAutomergeUrl, parsePatchworkDrop, hasPatchworkDrop } from "../link/dnd.js";

export const FOLLOW_DEBOUNCE_MS = 300;
const RETRY_MS = 2000;
const RETRY_MAX = 6;
const UNITS_KEY = "naval-study:units";
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

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const BADGE_TEXT = { inside: "in range", near: "near", far: "far" };
const shortHeads = (h) => (Array.isArray(h) && h.length ? h.map((x) => String(x).slice(0, 7)).join(",") : "");

export default function NavalStudyTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "naval-study";
  root.innerHTML = `
    <header class="study-bar cluster">
      <h2 class="study-title"></h2>
      <span class="chip" title="Every figure is recomputed from the subjects' documents with this method version; nothing derived is stored">methods v${METHOD_VERSION}</span>
      <div class="units cluster" role="group" aria-label="Units">
        <button type="button" data-units="metric">m</button>
        <button type="button" data-units="imperial">ft</button>
      </div>
      <button type="button" data-act="export" title="The study, every subject's resolved versions and every figure with its method, source, envelope and provenance, as JSON">Export JSON</button>
    </header>
    <form class="study-add cluster" autocomplete="off">
      <input type="text" name="url" spellcheck="false" placeholder="paste or drop a hull (camber, GLB) or a rig design: automerge:…" aria-label="Add a hull or design">
      <button type="submit">Add</button>
      <span class="add-status" role="status"></span>
    </form>
    <ol class="study-subjects"></ol>
    <ul class="study-warnings" role="status"></ul>
    <div class="study-compare"></div>
    <section class="study-cant" aria-labelledby="cant-title">
      <h3 id="cant-title">What the screen can't tell you</h3>
      <ul class="cant-figures"></ul>
      <ul class="cant-always"></ul>
    </section>`;
  element.append(style, root);
  const $ = (s) => root.querySelector(s);

  let units = readUnits();
  let dead = false;
  const findRepo = () => globalThis.repo ?? handle.repo ?? null;
  /** subject id → { key, state, result, error, chip, used, warnings, runner, offs, timer, retry, tries, seq } */
  const subjects = new Map();
  let last = null; // the last comparison drawn, for Export

  const say = (text, tone = "") => {
    const st = $(".add-status");
    st.textContent = text;
    st.dataset.tone = tone;
  };

  // ── subjects: resolve, screen, follow
  function sync() {
    const doc = normalizeStudy(handle.doc());
    const ids = new Set(doc.subjects.map((s) => s.id));
    for (const [id, s] of subjects) if (!ids.has(id)) dispose(id, s);
    for (const sub of doc.subjects) {
      const key = JSON.stringify({ hull: sub.hull, design: sub.design, label: sub.label });
      const s = subjects.get(sub.id);
      if (s && s.key === key) continue;
      if (s) unwatch(s);
      const next = s ?? { runner: createStaticsRunner({ name: `naval-study-${sub.id}` }), seq: 0, tries: 0 };
      Object.assign(next, { key, state: "pending", result: null, error: null, chip: "", used: null, warnings: [], offs: [], tries: 0 });
      subjects.set(sub.id, next);
      screen(sub.id, sub);
    }
    return doc;
  }

  function unwatch(s) {
    for (const off of s.offs ?? []) off();
    s.offs = [];
    clearTimeout(s.timer);
    clearTimeout(s.retry);
  }
  function dispose(id, s) {
    unwatch(s);
    s.seq++;
    s.runner.dispose();
    subjects.delete(id);
  }

  async function screen(id, sub) {
    const s = subjects.get(id);
    if (!s || dead) return;
    const seq = ++s.seq;
    clearTimeout(s.retry);
    const r = await resolveSubject(sub, { repo: findRepo() }).catch((err) => ({ ok: false, error: String(err?.message ?? err), transient: true, live: [] }));
    if (dead || seq !== s.seq) return;
    // follow the live docs this resolve read: an edit screens the subject again.
    // Watched afresh each time, since which docs are live can change between
    // resolves (a hull that wasn't here yet, a design linked to another hull).
    for (const off of s.offs) off();
    s.offs = [];
    for (const h of new Set(r.live ?? [])) {
      const onChange = () => {
        clearTimeout(s.timer);
        s.timer = setTimeout(() => {
          const cur = normalizeStudy(handle.doc()).subjects.find((x) => x.id === id);
          if (cur) screen(id, cur);
        }, FOLLOW_DEBOUNCE_MS);
      };
      h.on?.("change", onChange);
      s.offs.push(() => h.off?.("change", onChange));
    }
    if (!r.ok) {
      Object.assign(s, { state: "error", error: r.error, result: null });
      if (r.transient && s.tries++ < RETRY_MAX) s.retry = setTimeout(() => !dead && screen(id, sub), RETRY_MS * s.tries);
      return render();
    }
    Object.assign(s, { chip: r.chip, used: r.used, warnings: r.warnings });
    if (s.state !== "ready") render();
    let result;
    try {
      result = await s.runner.run(r.job);
    } catch (err) {
      if (err?.name === "AbortError" || dead || seq !== s.seq) return;
      Object.assign(s, { state: "error", error: String(err?.message ?? err), result: null });
      return render();
    }
    if (dead || seq !== s.seq) return;
    if (!result?.ok) {
      Object.assign(s, { state: "error", error: result?.why ?? "can't be screened", result: null });
      return render();
    }
    // the worker's figures crossed structuredClone as plain data: each is checked again here
    const figures = {};
    for (const [k, f] of Object.entries(result?.figures ?? {})) figures[k] = reviveFigure(f);
    Object.assign(s, { state: "ready", result: { ...result, figures }, error: null, tries: 0 });
    render();
  }

  // ── adding a subject: a dropped or pasted doc
  async function addUrl(text) {
    const url = parseAutomergeUrl(text);
    if (!url) return say("That isn't a document link.", "error");
    if (handle.url && url === handle.url) return say("A study can't be its own subject.", "error");
    const repo = findRepo();
    if (!repo?.find) return say("No repo here to find that document in.", "error");
    say("Reading…");
    let doc;
    try {
      doc = (await repo.find(url))?.doc?.();
    } catch (err) {
      return say(`Couldn't open it (${err?.message ?? err}).`, "error");
    }
    if (dead) return;
    const r = subjectFor(doc, url);
    if (!r.ok) return say(`Not added: ${r.error}.`, "error");
    handle.change((d) => {
      if (d.version == null) d.version = STUDY_VERSION;
      addSubject(d, r.subject);
    });
    say(`Added “${r.subject.label}”.`);
    $(".study-add input").value = "";
  }

  async function pin(id, on) {
    const sub = normalizeStudy(handle.doc()).subjects.find((x) => x.id === id);
    if (!sub) return;
    if (!on) return handle.change((d) => (setHeads(d, id, "hull", null), setHeads(d, id, "design", null)));
    const repo = findRepo();
    const heads = {};
    for (const which of ["hull", "design"]) {
      if (!sub[which]) continue;
      try {
        const h = await repo.find(sub[which].url);
        heads[which] = h.heads?.() ?? null;
      } catch {
        heads[which] = null;
      }
    }
    if (dead) return;
    if (Object.values(heads).some((h) => !Array.isArray(h) || !h.length)) return say("Can't pin: this host doesn't give the documents' versions.", "error");
    handle.change((d) => {
      for (const [which, h] of Object.entries(heads)) setHeads(d, id, which, [...h].map(String));
    });
  }

  // ── drawing
  function cellHtml(cell, col) {
    if (!cell.figure) return `<td class="cell missing" data-subject="${esc(col.id)}" title="${esc(cell.missing)}"><span class="v">—</span></td>`;
    const f = formatFigure(cell.figure, units);
    const d = cell.delta ? formatFigure(cell.delta, units, { signed: true }) : null;
    return `<td class="cell" data-subject="${esc(col.id)}" data-envelope="${f.badge}" data-provenance="${f.provenance}" title="${esc(f.title)}">
      <span class="v">${esc(f.text)}</span><span class="badge" data-envelope="${f.badge}">${BADGE_TEXT[f.badge]}</span>${f.mark ? `<span class="prov">${esc(f.mark)}</span>` : ""}
      ${d ? `<div class="delta" data-envelope="${d.badge}" title="${esc(d.title)}">Δ ${esc(d.text)}</div>` : ""}</td>`;
  }

  function render() {
    if (dead) return;
    const doc = normalizeStudy(handle.doc());
    root.dataset.units = units;
    for (const b of root.querySelectorAll("[data-units]")) b.setAttribute("aria-pressed", String(b.dataset.units === units));
    $(".study-title").textContent = doc.title;

    // the subjects
    const ol = $(".study-subjects");
    ol.innerHTML = doc.subjects.length
      ? doc.subjects
          .map((sub) => {
            const s = subjects.get(sub.id);
            const pinned = !!(sub.hull?.heads || sub.design?.heads);
            const what = [sub.design ? "rig design" : null, sub.hull ? "hull" : "synthetic hull"].filter(Boolean).join(" on ");
            const status = s?.state === "error" ? `<span class="status" data-tone="error">${esc(s.error)}</span>` : s?.state === "pending" ? `<span class="status">screening…</span>` : `<span class="status">${esc(s?.chip ?? "")}</span>`;
            return `<li class="subject cluster" data-subject="${esc(sub.id)}" data-state="${esc(s?.state ?? "pending")}">
              <label class="baseline" title="Every other subject's Δ is against the baseline"><input type="radio" name="baseline" value="${esc(sub.id)}" ${doc.baseline === sub.id ? "checked" : ""}> baseline</label>
              <strong class="label">${esc(sub.label)}</strong><span class="what">${esc(what)}</span>
              <span class="heads" title="${pinned ? "Pinned: this subject reads its documents at these versions" : "Following the latest versions"}">${pinned ? `pinned ${esc(shortHeads(sub.design?.heads ?? sub.hull?.heads))}` : "latest"}</span>
              <button type="button" data-act="${pinned ? "follow" : "pin"}">${pinned ? "Follow latest" : "Pin this version"}</button>
              <button type="button" data-act="remove" aria-label="Remove ${esc(sub.label)}">Remove</button>
              ${status}</li>`;
          })
          .join("")
      : `<li class="empty">No subjects yet: drop camber hulls, GLB files or rig designs here, or paste a link above.</li>`;

    const warn = [];
    for (const sub of doc.subjects) for (const w of subjects.get(sub.id)?.warnings ?? []) warn.push(`${sub.label}: ${w}`);
    $(".study-warnings").innerHTML = warn.map((w) => `<li>${esc(w)}</li>`).join("");

    // the comparison
    const columns = doc.subjects.map((sub) => {
      const s = subjects.get(sub.id);
      return { id: sub.id, label: sub.label, kind: s?.result?.kind ?? (sub.design ? "design" : "hull"), state: s?.state ?? "pending", result: s?.result ?? null, error: s?.error ?? null };
    });
    const c = compare(columns, doc.baseline);
    last = { doc, c };
    const head = `<thead><tr><th scope="col">Figure</th>${c.columns.map((col) => `<th scope="col" data-subject="${esc(col.id)}" ${col.baseline ? 'data-baseline=""' : ""}>${esc(col.label)}${col.baseline ? ' <span class="base-tag">baseline</span>' : ""}</th>`).join("")}</tr></thead>`;
    const body = c.groups
      .map(
        (g) =>
          `<tbody data-group="${esc(g.id)}"><tr class="group"><th colspan="${c.columns.length + 1}" scope="rowgroup">${esc(g.title)}</th></tr>` +
          g.rows.map((row) => `<tr data-row="${esc(row.id)}"><th scope="row">${esc(row.label)}</th>${row.cells.map((cell, i) => cellHtml(cell, c.columns[i])).join("")}</tr>`).join("") +
          "</tbody>",
      )
      .join("");
    $(".study-compare").innerHTML = c.columns.length ? `<div class="table-scroll"><table class="compare">${head}${body}</table></div>` : "";

    // what the screen can't tell you
    $(".cant-figures").innerHTML = c.cantTell.length
      ? c.cantTell.map((x) => `<li data-envelope="${esc(x.envelope)}"><span class="badge" data-envelope="${esc(x.envelope === "unavailable" ? "far" : x.envelope)}">${esc(x.envelope === "unavailable" ? "n/a" : BADGE_TEXT[x.envelope])}</span> <strong>${esc(x.subject)}</strong>, ${esc(x.row)}: ${esc(x.reason)}</li>`).join("")
      : `<li class="none">Every screened figure is inside its method's fitted range.</li>`;
    $(".cant-always").innerHTML = c.notScreened.map((t) => `<li>${esc(t)}</li>`).join("");
  }

  // ── Export JSON: the study, the versions read, every figure as it stands
  function exportJson() {
    if (!last) return;
    const { doc, c } = last;
    const report = {
      format: "naval-study-report",
      version: 1,
      methodVersion: METHOD_VERSION,
      study: { url: handle.url ?? null, ...doc },
      subjects: doc.subjects.map((sub) => {
        const s = subjects.get(sub.id);
        return { id: sub.id, label: sub.label, state: s?.state ?? "pending", read: s?.used ?? null, hull: s?.chip ?? null, warnings: s?.warnings ?? [], error: s?.error ?? null };
      }),
      groups: c.groups.map((g) => ({ id: g.id, title: g.title, rows: g.rows.map((r) => ({ id: r.id, label: r.label, unit: r.unit, cells: r.cells.map((x, i) => ({ subject: c.columns[i].id, figure: x.figure, delta: x.delta, missing: x.missing ?? null })) })) })),
      cantTell: c.cantTell,
      notScreened: c.notScreened,
    };
    const name = `${(doc.title || "study").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "study"}.naval-study.json`;
    const text = `${JSON.stringify(report, null, 2)}\n`;
    root.dispatchEvent(new CustomEvent("naval-study-export", { detail: report, bubbles: true }));
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
      say(`Exported “${name}”.`);
    } catch {
      say("Built the report (this host blocked the download).");
    }
  }

  // ── events
  const onClick = (e) => {
    const t = e.target.closest("button, input[type=radio]");
    if (!t || !root.contains(t)) return;
    if (t.dataset.units) {
      units = t.dataset.units;
      writeUnits(units);
      return render();
    }
    if (t.dataset.act === "export") return exportJson();
    const id = t.closest("[data-subject]")?.dataset.subject;
    if (!id) return;
    if (t.dataset.act === "remove") return handle.change((d) => removeSubject(d, id));
    if (t.dataset.act === "pin") return pin(id, true);
    if (t.dataset.act === "follow") return pin(id, false);
  };
  const onBaseline = (e) => {
    if (e.target?.name !== "baseline") return;
    const id = e.target.value;
    handle.change((d) => setBaseline(d, id));
  };
  const onSubmit = (e) => {
    e.preventDefault();
    addUrl($(".study-add input").value);
  };
  const onDragOver = (e) => {
    if (!hasPatchworkDrop(e.dataTransfer)) return;
    e.preventDefault();
    root.setAttribute("data-dropping", "");
  };
  const onDragLeave = () => root.removeAttribute("data-dropping");
  const onDrop = async (e) => {
    root.removeAttribute("data-dropping");
    const items = parsePatchworkDrop(e.dataTransfer);
    if (!items.length) return;
    e.preventDefault();
    for (const it of items) await addUrl(it.url);
  };
  const onChange = () => {
    sync();
    render();
  };
  root.addEventListener("click", onClick);
  root.addEventListener("change", onBaseline);
  $(".study-add").addEventListener("submit", onSubmit);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("dragleave", onDragLeave);
  root.addEventListener("drop", onDrop);
  handle.on("change", onChange);
  sync();
  render();

  return () => {
    dead = true;
    handle.off("change", onChange);
    for (const [id, s] of subjects) dispose(id, s);
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onBaseline);
    root.removeEventListener("dragover", onDragOver);
    root.removeEventListener("dragleave", onDragLeave);
    root.removeEventListener("drop", onDrop);
    root.remove();
    style.remove();
  };
}
