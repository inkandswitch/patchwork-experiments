// A daemon's inbox: is it alive, what is it running, what waits, what it did.

import css from "./styles.css?inline";
import { daemonOnline, queueView } from "../protocol.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const since = (ms) => {
  const s = Math.max(0, ms / 1000);
  return s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
};

export default function ServerTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "fea";
  element.append(style, root);
  const repo = handle.repo ?? window.repo;
  const titles = new Map();
  const titleOf = (url) => {
    if (!titles.has(url)) {
      titles.set(url, null);
      repo.find(url).then(
        (h) => {
          titles.set(url, h.doc()?.title ?? "a run");
          render();
        },
        () => titles.set(url, "a run that isn't here"),
      );
    }
    return titles.get(url) ?? "…";
  };
  const render = () => {
    const s = handle.doc() ?? {};
    const d = s.daemon ?? {};
    const online = daemonOnline(s, Date.now());
    const q = queueView(s);
    const handled = Object.entries(s.handled ?? {}).sort((a, b) => b[1].at - a[1].at).slice(0, 30);
    const reqs = s.requests ?? {};
    const run = (url) => `<a href="#" data-run="${esc(url)}">${esc(titleOf(url))}</a>`;
    root.innerHTML = `<div class="page">
      <h3 class="title">${esc(s.title ?? "FEA server")}</h3>
      <span class="chip"><span class="dot" data-state="${online ? "online" : "idle"}"></span>${online ? "online" : "not running"}</span>
      <table class="figures wide">
        <tr><td>Machine</td><td>${esc(d.host ?? "–")} (${esc(d.platform ?? "–")})</td></tr>
        <tr><td>Solver</td><td>CalculiX ${esc(d.calculix ?? "–")}</td></tr>
        <tr><td>Mesher</td><td>gmsh ${esc(d.gmsh ?? "–")}</td></tr>
        <tr><td>Cores a run</td><td>${d.cores ?? "–"}</td></tr>
        <tr><td>Runs at once</td><td>${d.jobs ?? 1}</td></tr>
        <tr><td>Largest mesh</td><td>${d.maxNodes ? `${d.maxNodes.toLocaleString("en")} nodes` : "–"}</td></tr>
        <tr><td>Up for</td><td>${online && d.startedAt ? since(Date.now() - d.startedAt) : "–"}</td></tr>
        <tr><td>Last heard from</td><td>${d.heartbeat ? new Date(d.heartbeat).toLocaleString() : "–"}</td></tr>
      </table>
      <section><h2>Running</h2>${q.active.length ? q.active.map((r) => `<div>${run(r.run)} <span class="hint">for ${since(Date.now() - r.since)}</span></div>`).join("") : `<div class="hint">nothing</div>`}</section>
      <section><h2>Waiting</h2>${q.waiting.length ? `<ol>${q.waiting.map((r) => `<li>${run(r.run)}${r.by ? ` <span class="hint">for ${esc(r.by)}</span>` : ""}</li>`).join("")}</ol>` : `<div class="hint">nothing</div>`}</section>
      <section><h2>Done</h2>${handled.length ? `<table class="figures wide">${handled.map(([id, h]) => `<tr><td>${reqs[id]?.run ? run(reqs[id].run) : esc(id)}</td><td>${esc(h.status)}, ${new Date(h.at).toLocaleString()}</td></tr>`).join("")}</table>` : `<div class="hint">nothing yet</div>`}</section>
      <div class="hint">To send it runs, paste this document's link into a study's Server box.</div>
    </div>`;
  };
  const click = (ev) => {
    const a = ev.target.closest("[data-run]");
    if (!a) return;
    ev.preventDefault();
    element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: a.dataset.run, toolId: "fea-run" }, bubbles: true, composed: true }));
  };
  root.addEventListener("click", click);
  render();
  handle.on("change", render);
  const clock = setInterval(render, 15_000);
  return () => {
    handle.off("change", render);
    clearInterval(clock);
    root.remove();
    style.remove();
  };
}
