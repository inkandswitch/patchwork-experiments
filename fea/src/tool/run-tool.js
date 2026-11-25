// A run opened on its own: what it was asked, how it went, what it found.
// (Its results on the part are in the study it came from, and in a scene.)
// While it hasn't ended, its task is followed too: what the run doc can't
// say (cancelled before it started, a machine that stopped) is read from it
// (shownRun), and Cancel is said to it.

import css from "./styles.css?inline";
import { isTerminal } from "../protocol.js";
import { figures, inputs, statusLine } from "../results.js";
import { cancelRun, shownRun } from "../task-runs.js";
import { watch } from "../task-client.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default function RunTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "fea";
  element.append(style, root);
  const open = (url, toolId) => element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url, toolId }, bubbles: true, composed: true }));
  const repo = handle.repo ?? window.repo;
  let task = null; // the run's task as followed ({ state, error })
  let cancelAsked = false;
  const first = handle.doc();
  const unwatch =
    first?.server && !isTerminal(first.status)
      ? watch(
          repo,
          first.server,
          handle.url,
          (view) => {
            task = { state: view.state, error: view.error, runs: view.runs };
            render();
          },
          first.task ? { from: first.task } : {},
        )
      : () => {};
  const render = () => {
    const raw = handle.doc() ?? {};
    const shown = shownRun(raw, task);
    const run = { ...raw, status: shown.status, error: shown.error };
    const going = !isTerminal(run.status);
    const note = task?.state === "stopping" || (cancelAsked && going) ? "cancelling…" : shown.note;
    let group = null;
    const rows = figures(run)
      .map((r) => `${r.group !== group ? `<tr class="group"><td colspan="2">${esc((group = r.group))}</td></tr>` : ""}<tr title="${esc(r.title)}"><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`)
      .join("");
    const stages = (run.stages ?? [])
      .map((s) => `<li data-state="${s.status}"><span class="dot" data-state="${s.status === "running" ? "solving" : s.status === "done" ? "done" : s.status === "failed" ? "failed" : "idle"}"></span>${esc(s.label)}${s.note ? ` <span class="hint">${esc(s.note)}</span>` : ""}${s.status === "running" && s.tail ? `<pre class="tail">${esc(s.tail)}</pre>` : ""}</li>`)
      .join("");
    root.innerHTML = `<div class="page">
      <h3 class="title">${esc(run.title ?? "FEA run")}</h3>
      <div class="chip"><span class="dot" data-state="${esc(run.status ?? "idle")}"></span>${esc(statusLine(run))}${note ? ` · ${esc(note)}` : ""}</div>
      ${run.study ? `<div class="hint">From a study: <a href="#" data-act="study">open it</a> to see the results on the part.</div>` : ""}
      ${going && note !== "cancelling…" ? `<div class="cluster"><button data-act="cancel">Cancel</button></div>` : ""}
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
    if (el.dataset.act === "cancel") {
      cancelAsked = true;
      render();
      // a cancel that cancels nothing (the queue no longer lists it) shows Cancel again
      cancelRun(repo, handle.doc(), handle.url).then(
        (stopped) => {
          if (!stopped) cancelAsked = false;
          render();
        },
        () => {
          cancelAsked = false;
          render();
        },
      );
    }
  };
  root.addEventListener("click", click);
  render();
  handle.on("change", render);
  const clock = setInterval(render, 5000);
  return () => {
    unwatch();
    clearInterval(clock);
    handle.off("change", render);
    root.remove();
    style.remove();
  };
}
