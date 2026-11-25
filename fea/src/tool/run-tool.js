// A run opened on its own: what it was asked, how it went, what it found.
// (Its results on the part are in the study it came from, and in a scene.)

import css from "./styles.css?inline";
import { isTerminal } from "../protocol.js";
import { figures, inputs, statusLine } from "../results.js";
import { requestStop } from "../protocol.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default function RunTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "fea";
  element.append(style, root);
  const open = (url, toolId) => element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url, toolId }, bubbles: true, composed: true }));
  const render = () => {
    const run = handle.doc() ?? {};
    const going = !isTerminal(run.status);
    let group = null;
    const rows = figures(run)
      .map((r) => `${r.group !== group ? `<tr class="group"><td colspan="2">${esc((group = r.group))}</td></tr>` : ""}<tr title="${esc(r.title)}"><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`)
      .join("");
    const stages = (run.stages ?? [])
      .map((s) => `<li data-state="${s.status}"><span class="dot" data-state="${s.status === "running" ? "solving" : s.status === "done" ? "done" : s.status === "failed" ? "failed" : "idle"}"></span>${esc(s.label)}${s.note ? ` <span class="hint">${esc(s.note)}</span>` : ""}${s.status === "running" && s.tail ? `<pre class="tail">${esc(s.tail)}</pre>` : ""}</li>`)
      .join("");
    root.innerHTML = `<div class="page">
      <h3 class="title">${esc(run.title ?? "FEA run")}</h3>
      <div class="chip"><span class="dot" data-state="${esc(run.status ?? "idle")}"></span>${esc(statusLine(run))}</div>
      ${run.study ? `<div class="hint">From a study: <a href="#" data-act="study">open it</a> to see the results on the part.</div>` : ""}
      ${going ? `<div class="cluster"><button data-act="cancel">Cancel</button></div>` : ""}
      ${run.error ? `<div class="warn">${esc(run.error)}</div>` : ""}
      ${(run.notes ?? []).map((n) => `<div class="warn">${esc(n)}</div>`).join("")}
      <section><h2>How it went</h2><ol class="stages">${stages}</ol></section>
      ${rows ? `<section><h2>What it found</h2><table class="figures wide">${rows}</table></section>` : ""}
      <section><h2>What was asked</h2><table class="figures wide">${inputs(run).map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join("")}</table></section>
      ${run.recipe?.deck ? `<section><h2>The solver's input</h2><pre class="tail">${esc(run.recipe.deck)}</pre><div class="hint">Its long lists are cut short here. The whole file, the mesh and CalculiX's own results are on the server, in its runs folder.</div></section>` : ""}
    </div>`;
  };
  const click = (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    ev.preventDefault();
    if (el.dataset.act === "study") open(handle.doc().study, "fea-study");
    if (el.dataset.act === "cancel") handle.change((d) => requestStop(d));
  };
  root.addEventListener("click", click);
  render();
  handle.on("change", render);
  const clock = setInterval(render, 5000);
  return () => {
    clearInterval(clock);
    handle.off("change", render);
    root.remove();
    style.remove();
  };
}
