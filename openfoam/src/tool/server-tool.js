// A daemon's inbox: is it alive, what is it running, what waits, what it did.
import css from "./styles.css?inline";
import { daemonOnline, queueView } from "../protocol.js";
import { formatDuration } from "../setup.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default function ServerTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "openfoam";
  element.append(style, root);
  const repo = handle.repo ?? window.repo;
  const titles = new Map();
  const titleOf = (url) => {
    if (!titles.has(url)) {
      titles.set(url, null);
      repo
        .find(url)
        .then((h) => {
          titles.set(url, h.doc()?.title ?? url);
          render();
        })
        .catch(() => titles.set(url, url));
    }
    return titles.get(url) ?? url.slice(0, 24) + "…";
  };
  const render = () => {
    const s = handle.doc();
    const d = s.daemon ?? {};
    const online = daemonOnline(s, Date.now());
    const q = queueView(s);
    const handled = Object.entries(s.handled ?? {}).sort((a, b) => b[1].at - a[1].at).slice(0, 30);
    const reqs = s.requests ?? {};
    root.innerHTML = `<div class="flow" style="padding:var(--studio-space-lg, 24px);max-width:760px">
      <h3>${esc(s.title ?? "OpenFOAM server")}</h3>
      <span class="chip"><span class="dot" data-state="${online ? "online" : "idle"}"></span>${online ? "online" : "offline"}</span>
      <table class="figures">
        <tr><td>Host</td><td>${esc(d.host ?? "–")}</td></tr>
        <tr><td>OpenFOAM</td><td>${esc(d.openfoam ?? "–")}</td></tr>
        <tr><td>Cores a run</td><td>${d.cores ?? "–"}</td></tr>
        <tr><td>Runs at once</td><td>${d.jobs ?? 1}</td></tr>
        <tr><td>Platform</td><td>${esc(d.platform ?? "–")}</td></tr>
        <tr><td>Up for</td><td>${online && d.startedAt ? formatDuration((Date.now() - d.startedAt) / 1000) : "–"}</td></tr>
        <tr><td>Last heard from</td><td>${d.heartbeat ? new Date(d.heartbeat).toLocaleString() : "–"}</td></tr>
      </table>
      <div class="section"><h2>Running${d.jobs > 1 ? ` (up to ${d.jobs} at once)` : ""}</h2>${q.active.length ? q.active.map((r) => `<div>${esc(titleOf(r.run))}</div>`).join("") : `<div class="hint">nothing</div>`}</div>
      <div class="section"><h2>Waiting</h2>${q.waiting.length ? `<ol>${q.waiting.map((r) => `<li>${esc(titleOf(r.run))}${r.by ? ` <span class="hint">for ${esc(r.by)}</span>` : ""}</li>`).join("")}</ol>` : `<div class="hint">nothing</div>`}</div>
      <div class="section"><h2>Done</h2>${handled.length ? `<table class="figures">${handled.map(([id, h]) => `<tr><td>${esc(reqs[id]?.run ? titleOf(reqs[id].run) : id)}</td><td>${esc(h.status)}</td><td>${new Date(h.at).toLocaleString()}</td></tr>`).join("")}</table>` : `<div class="hint">nothing yet</div>`}</div>
      <div class="hint">Paste this document's link into a case's Server field to send it runs.</div>
    </div>`;
  };
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
