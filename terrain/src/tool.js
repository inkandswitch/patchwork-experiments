// The Terrain tool: a map of the place (the burned-in heights, the docks,
// the marks and the named places), its frame and extent, a Fetch data
// button that caches the open data into the doc (the only network access in
// this package besides the template), and every source with its licence.
//
// Fetch data is work done through the task system (fetch-task.js, asked with
// doWork under a key naming this doc and what it asks for): on the person's
// own queue when one of their machines serves it, so that it finishes when
// this page closes and two pages asking are one fetch; otherwise in this
// page. A fetch already under way for this doc and frame on the person's own
// queue, asked from another tab or before a reload, is shown (watchWork)
// rather than offered again; one done in another page is not seen here.

import css from "./tool.css?inline";
import { NCEI } from "./fetch-data.js";
import { readTerrainData, dataFits } from "./store.js";
import fetchTerrainTask from "./fetch-task.js";
import { fetchRequest } from "./fetch-spec.js";
import { doWork, inSamePackage, stopWork, watchWork } from "./task-client.js";
import { shape, HEIGHT_SCALE } from "./build.js";
import { hexAt } from "./colors.js";
import { localFrame } from "./tmerc.js";
import { kindOf } from "./structures.js";
import { modelOf, buoyLook } from "./marks.js";
import { QUALITY } from "./burn.js";

// Vite sets this in the built package, whose fetch task is dist/fetch-task.js (vite.config.js)
const BUILT = import.meta.env?.PROD === true;

/**
 * Where Fetch data's code is, as an import url both this page and a pool can
 * import: the package's own file, named by the package's url and not this
 * site's, when this module was loaded from a package in automerge; the file
 * beside this one when it runs unbuilt from anywhere else (tests, a dev
 * server); null when neither can be known, and the tool then calls it itself.
 */
export function fetchTaskUrl(here = import.meta.url, built = BUILT) {
  const inPackage = inSamePackage(here, built ? "dist/fetch-task.js" : "src/fetch-task.js");
  if (inPackage || built) return inPackage;
  try {
    return new URL("./fetch-task.js", here).href;
  } catch {
    return null;
  }
}

/** Whether a fetch in this state is still under way, as far as a person can tell. */
const underWay = (state) => state === "waiting" || state === "running" || state === "stalled" || state === "stopping";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default function TerrainTool(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "terrain-tool";
  element.append(style, root);
  root.innerHTML = `
    <div class="flow">
      <input class="title" aria-label="Title">
      <div class="muted summary"></div>
      <div class="layout">
        <div class="flow">
          <div class="map"><canvas width="1025" height="1025"></canvas><div class="empty" hidden></div></div>
          <div class="muted legend"></div>
        </div>
        <div class="flow">
          <div class="panel flow">
            <h3>Data</h3>
            <div class="status"></div>
            <div class="actions"><button class="fetch">Fetch data</button> <button class="cancel" hidden>Cancel</button></div>
            <div class="muted where" hidden></div>
            <pre class="log" hidden></pre>
          </div>
          <div class="panel flow">
            <h3>Place</h3>
            <div class="fields">
              <label for="t-lat">Origin lat</label><input id="t-lat" data-k="lat" type="number" step="0.00001">
              <label for="t-lon">Origin lon</label><input id="t-lon" data-k="lon" type="number" step="0.00001">
              <label for="t-n">Nodes a side</label><select id="t-n" data-k="n"><option>257</option><option>513</option><option>1025</option></select>
              <label for="t-cell">Cell (m)</label><input id="t-cell" data-k="cell" type="number" min="2" max="64" step="1">
              <label for="t-x0">West edge x0 (m)</label><input id="t-x0" data-k="x0" type="number" step="1">
              <label for="t-z0">North edge z0 (m)</label><input id="t-z0" data-k="z0" type="number" step="1">
              <label for="t-ex">Exaggeration</label><input id="t-ex" data-k="exaggeration" type="number" min="0.1" max="10" step="0.1">
              <label for="t-osm">OpenStreetMap as of</label><input id="t-osm" class="osm-date" type="text" placeholder="now (e.g. 2026-11-09T20:32:33Z)">
            </div>
            <div class="muted frame"></div>
          </div>
          <div class="panel flow">
            <h3>Sources and licences</h3>
            <ul class="sources"></ul>
            <div class="muted attribution"></div>
          </div>
          <div class="panel flow">
            <h3>Water</h3>
            <div class="water muted"></div>
          </div>
        </div>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $("canvas");
  const ctx2d = canvas.getContext("2d");
  let dead = false;
  // the fetch this tool started: { controller, here } while it runs
  let job = null;
  // a fetch under way for this doc and frame that this tool did not start: { key, view }
  let elsewhere = null;
  const repoOf = () => handle.repo ?? element.repo ?? globalThis.repo;
  const busy = () => !!job || !!elsewhere;
  let shown = null; // the data key the map was drawn for
  let drawing = null;

  $(".title").addEventListener("change", (e) => handle.change((d) => (d.title = e.target.value)));
  for (const input of root.querySelectorAll(".fields [data-k]")) {
    input.addEventListener("change", () => {
      const k = input.dataset.k;
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      handle.change((d) => {
        if (k === "lat" || k === "lon") d.origin[k] = v;
        else if (k === "exaggeration") d.exaggeration = v;
        else d.grid[k] = v;
      });
    });
  }

  $(".osm-date").addEventListener("change", (e) => {
    const v = e.target.value.trim();
    if (v && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)) return void (e.target.value = handle.doc()?.osmDate ?? "");
    handle.change((d) => (d.osmDate = v || null));
  });

  const logEl = $(".log");
  const whereEl = $(".where");
  const log = (s, state = "") => {
    logEl.hidden = false;
    logEl.dataset.state = state;
    logEl.textContent = state === "error" ? s : logEl.textContent ? `${logEl.textContent}\n${s}` : s;
  };
  /** Shows a fetch as its task's view has it: its log, and where and how far it is. */
  const showView = (view) => {
    if (dead) return;
    const lines = view.logs.map((l) => l.message);
    logEl.hidden = !lines.length;
    logEl.dataset.state = "";
    logEl.textContent = lines.join("\n");
    const stage = view.state === "waiting" || view.state === "stalled" ? "Waiting for one of your machines to take it up…" : view.state === "stopping" ? "Stopping…" : typeof view.progress === "string" ? view.progress : "";
    // Asked of the person's queue, it is theirs to stop, not this page's; whether it finishes is up to their machines.
    const where = view.taskUrl ? "On your own machines: closing this does not stop it." : "In this page: closing it stops the fetch.";
    whereEl.hidden = !underWay(view.state);
    whereEl.textContent = [stage, where].filter(Boolean).join(" ");
  };

  $(".fetch").addEventListener("click", async () => {
    if (busy()) return;
    const controller = new AbortController();
    const mine = (job = { controller, here: true });
    logEl.textContent = "";
    logEl.hidden = true;
    whereEl.hidden = false;
    whereEl.textContent = "Starting…";
    render();
    try {
      const repo = repoOf();
      const { input, key } = fetchRequest(handle.url, handle.doc());
      const importUrl = fetchTaskUrl();
      let result;
      if (importUrl) {
        result = await doWork(repo, { importUrl, input, key }, {
          signal: controller.signal,
          onProgress: (view) => {
            mine.here = !view.taskUrl;
            mine.state = view.state;
            showView(view);
          },
        });
      } else {
        // nowhere a pool could import it from: done here, as a task done here would be
        result = await fetchTerrainTask(input, { repo, signal: controller.signal, log: (s) => log(s), progress: (stage) => !dead && (whereEl.textContent = String(stage)) });
      }
      if (!dead && !result?.stored) log(result?.message ?? "Nothing was stored.", "error");
    } catch (err) {
      // Stopped here or from another page. What was stored, if a stop came too late to prevent it, the status above says.
      if (!dead) log(controller.signal.aborted || mine.state === "cancelled" ? "Stopped." : String(err?.message ?? err), "error");
    } finally {
      if (job === mine) job = null;
      if (!dead) {
        whereEl.hidden = true;
        render();
      }
    }
  });

  $(".cancel").addEventListener("click", () => {
    if (job) job.controller.abort();
    else if (elsewhere) void stopWork(repoOf(), elsewhere.key);
  });

  // Follows the fetch asked under this doc's key now, so that one already
  // under way is shown and not asked again. The key follows the doc: a
  // changed frame is another fetch.
  let following = null; // { key, stop }
  function followKey() {
    const { key } = fetchRequest(handle.url, handle.doc());
    if (dead || following?.key === key) return;
    following?.stop();
    const mine = (following = { key, stop: () => {} });
    if (elsewhere) {
      elsewhere = null;
      render();
    }
    mine.stop = watchWork(repoOf(), key, (view) => {
      // a fetch this tool started shows itself
      if (dead || following !== mine || job) return;
      if (underWay(view.state)) {
        elsewhere = { key, view };
        showView(view);
        render();
      } else if (elsewhere) {
        elsewhere = null;
        showView(view);
        render();
      }
    });
  }

  async function drawMap(d) {
    const key = `${d.data?.dem?.sha256}|${d.data?.features?.sha256}|${d.demToMWL}`;
    if (shown === key || drawing === key) return;
    drawing = key;
    const empty = $(".empty");
    try {
      const repo = handle.repo ?? element.repo ?? window.repo;
      const { dem, features } = await readTerrainData(repo, d);
      if (dead || drawing !== key) return;
      const grid = d.data.dem;
      const S = d.heightScale ?? HEIGHT_SCALE;
      const sh = shape(grid, dem, { scale: grid.scale, offset: grid.offset ?? 0, toMWL: d.demToMWL ?? 0 }, features, { datum: d.datum ?? null, scale: S });
      const n = grid.n;
      canvas.width = canvas.height = n;
      const img = ctx2d.createImageData(n, n);
      const cache = new Map();
      for (let k = 0; k < n * n; k++) {
        const h = Math.round(sh.heights[k] * S * 5) / 5;
        let c = cache.get(h);
        if (!c) cache.set(h, (c = [1, 3, 5].map((o) => parseInt(hexAt(h).slice(o, o + 2), 16))));
        img.data.set(c, k * 4);
        img.data[k * 4 + 3] = 255;
      }
      ctx2d.putImageData(img, 0, 0);
      const px = (x, z) => [(x - grid.x0) / grid.cell, (z - grid.z0) / grid.cell];
      // where the depth is made up (the DEM shallower than the water floor, or land): hatched
      ctx2d.fillStyle = "rgba(200, 40, 120, 0.55)";
      for (let k = 0; k < n * n; k++) if (sh.quality[k] === QUALITY.CLAMPED && ((k % n) + Math.floor(k / n)) % 3 === 0) ctx2d.fillRect(k % n, Math.floor(k / n), 1, 1);
      // rocks too small for the grid
      ctx2d.fillStyle = "#3b352e";
      for (const r of sh.islets.rocks) {
        ctx2d.beginPath();
        r.points.forEach(([x, z], i) => (i ? ctx2d.lineTo(...px(x, z)) : ctx2d.moveTo(...px(x, z))));
        ctx2d.closePath();
        ctx2d.fill();
      }
      ctx2d.lineWidth = 1.5;
      ctx2d.strokeStyle = "rgba(40, 30, 20, 0.85)";
      for (const st of features.structures ?? []) {
        ctx2d.beginPath();
        st.points.forEach(([x, z], i) => (i ? ctx2d.lineTo(...px(x, z)) : ctx2d.moveTo(...px(x, z))));
        if (st.area) ctx2d.closePath();
        ctx2d.lineWidth = kindOf(st) === "breakwater" ? 3 : 1.5;
        ctx2d.stroke();
      }
      for (const m of features.marks ?? []) {
        if (!modelOf(m)) continue;
        const [i, j] = px(m.x, m.z);
        const c = modelOf(m) === "buoy" ? buoyLook(m).colour : m.light ?? m.colours[0];
        ctx2d.fillStyle = c === "green" ? "#2f8a3e" : c === "red" ? "#c8322b" : c === "grey" ? "#8b9096" : "#e8c22a";
        ctx2d.beginPath();
        ctx2d.arc(i, j, 4, 0, 2 * Math.PI);
        ctx2d.fill();
      }
      const frame = localFrame(d.origin);
      ctx2d.font = "600 15px system-ui, sans-serif";
      for (const p of d.places ?? []) {
        const [x, z] = frame.toLocal(p.lat, p.lon);
        const [i, j] = px(x, z);
        ctx2d.fillStyle = "#111";
        ctx2d.beginPath();
        ctx2d.arc(i, j, 3, 0, 2 * Math.PI);
        ctx2d.fill();
        ctx2d.lineWidth = 3;
        ctx2d.strokeStyle = "rgba(255,255,255,0.85)";
        ctx2d.strokeText(p.name, i + 6, j + 5);
        ctx2d.fillText(p.name, i + 6, j + 5);
      }
      empty.hidden = true;
      shown = key;
      let clamped = 0;
      for (const q of sh.quality) if (q === QUALITY.CLAMPED) clamped++;
      $(".legend").textContent = `${n} × ${n} nodes, ${grid.cell} m apart (${((n - 1) * grid.cell) / 1000} km a side); north up. ${sh.cls.stats.land.toLocaleString("en")} land and ${sh.cls.stats.water.toLocaleString("en")} water nodes, the shore burned in from OpenStreetMap. Away from the shore the DEM is on OSM's side of the water at ${(sh.agreement.share * 100).toFixed(1)}% of nodes. ${sh.islets.raised.length} islets raised above the land floor (+${sh.landFloor.toFixed(2)} m); ${sh.islets.rocks.length} rocks too small for the grid (dark). Hatched: ${clamped.toLocaleString("en")} water nodes whose depth is made up (the DEM says shallower than ${(0.05 * sh.cls.band).toFixed(2)} m, or land).${sh.problems.length ? ` Problems: ${sh.problems.join(" ")}` : ""}`;
    } catch (err) {
      if (dead) return;
      empty.hidden = false;
      empty.textContent = String(err?.message ?? err);
    } finally {
      if (drawing === key) drawing = null;
    }
  }

  function render() {
    if (dead) return;
    const d = handle.doc();
    if (!d) return;
    if (document.activeElement !== $(".title")) $(".title").value = d.title ?? "";
    for (const input of root.querySelectorAll(".fields [data-k]")) {
      if (document.activeElement === input) continue;
      const k = input.dataset.k;
      input.value = k === "lat" || k === "lon" ? d.origin?.[k] : k === "exaggeration" ? d.exaggeration ?? 1 : d.grid?.[k];
    }
    if (document.activeElement !== $(".osm-date")) $(".osm-date").value = d.osmDate ?? "";
    const g = d.grid ?? {};
    $(".summary").textContent = `${d.origin?.lat?.toFixed?.(5)}, ${d.origin?.lon?.toFixed?.(5)} · ${((g.n - 1) * g.cell) / 1000} km square`;
    $(".frame").textContent = "Frame: transverse Mercator about the origin (WGS84, scale 1). Metres; x east, y up, z south; y = 0 mean water level. The grid runs x0…x0 + (n−1)·cell east and z0…z0 + (n−1)·cell south.";
    const status = $(".status");
    const fits = dataFits(d);
    status.dataset.state = d.data && !fits ? "stale" : "";
    status.textContent = !d.data ? "No data yet. Fetch data asks NOAA NCEI for the heights and OpenStreetMap for the shore, the docks and the marks, and keeps them in this doc." : fits ? `Fetched ${new Date(d.data.fetched).toLocaleString()} (OpenStreetMap as of ${d.data.summary?.osmBase ?? "?"}).` : "The place, the grid or its settings changed since the data was fetched: fetch it again.";
    const btn = $(".fetch");
    btn.disabled = busy();
    btn.textContent = busy() ? "Fetching…" : d.data ? "Fetch again" : "Fetch data";
    $(".cancel").hidden = !busy();
    const sources = d.data?.sources?.length ? d.data.sources : [{ name: NCEI.name, licence: NCEI.licence, url: NCEI.metadata }];
    $(".sources").innerHTML = sources
      .map(
        (s) =>
          `<li><strong>${esc(s.name)}</strong>${s.fetched ? `, fetched ${esc(String(s.fetched).slice(0, 10))}` : ""}${s.osmBase ? `, as of ${esc(s.osmBase)}` : ""}<br><span class="muted">${esc(s.licence)}</span>${s.metadata ? ` · <a href="${esc(s.metadata)}" target="_blank" rel="noopener">metadata</a>` : ""}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">request</a>` : ""}${s.accuracy ? `<br><span class="muted">${esc(s.accuracy)}</span>` : ""}${s.derivation ? `<br><span class="muted">${esc(s.derivation)}</span>` : ""}</li>`,
      )
      .join("");
    $(".attribution").textContent = d.data?.attribution || "";
    const t = d.datum?.tide ?? {};
    $(".water").innerHTML = `Heights are above mean water level (${esc(d.datum?.station ?? "")}: ${d.datum?.mwlAboveChartDatum ?? "?"} m above chart datum). Tides about it: highest normal ${t.HHWLT ?? "?"} m, mean higher high ${t.MHHW ?? "?"} m, mean lower low ${t.MLLW ?? "?"} m, lowest normal ${t.LLWLT ?? "?"} m.${d.wind ? `<br>A typical breeze: ${d.wind.speed} m/s from ${d.wind.from}° (${esc(d.wind.source)}).` : ""}<br>Not for navigation.`;
    const empty = $(".empty");
    if (!d.data) {
      empty.hidden = false;
      empty.textContent = "Fetch data to see the place.";
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      shown = null;
    } else if (fits) drawMap(d);
  }

  const changed = () => {
    render();
    followKey();
  };
  render();
  followKey();
  handle.on("change", changed);
  return () => {
    dead = true;
    // work done in this page ends with it; work on the person's queue goes on
    if (job?.here) job.controller.abort();
    following?.stop();
    handle.off("change", changed);
    root.remove();
    style.remove();
  };
}
