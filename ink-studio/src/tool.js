// patchwork:tool "ink-scene" — an ink-studio scene, built from the doc's source
// and drawn with upstream's WebGL 2 renderer, as their example pages do.
//
// The doc's files are edited collaboratively (Source); any change rebuilds the
// scene after a short pause, keeping the last good world on screen while the
// code has an error. Camera, clock and pixel size are this viewer's own.

import css from "./styles.css?inline";
import * as toolkit from "./generated/toolkit.js";
import { createRenderer } from "../vendor/ink-studio/src/webgl/renderer.mjs";
import { loadScene } from "./load-scene.js";
import { createOrbit } from "./orbit.js";
import { createPlayer } from "./player.js";
import { createEditor } from "./editor.js";

const STYLE_ID = "ink-studio-styles";
let styleUsers = 0;
function mountStyles() {
  styleUsers++;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.append(style);
}
function unmountStyles() {
  if (--styleUsers > 0) return;
  document.getElementById(STYLE_ID)?.remove();
}

const TEMPLATE = `
  <div class="view"><canvas></canvas><div class="message" aria-live="polite"></div></div>
  <aside class="source" hidden aria-label="Source">
    <header><select class="file" aria-label="File"></select></header>
    <div class="editor"></div>
    <div class="credit"></div>
  </aside>
  <div class="bar">
    <span class="name"></span>
    <span class="stats"></span>
    <span class="spacer"></span>
    <button type="button" data-action="authored" hidden title="Give the camera back to the scene">Scene camera</button>
    <button type="button" data-action="play" aria-pressed="true">Pause</button>
    <button type="button" data-action="restart" title="Rebuild and start the clock again">Restart</button>
    <select class="px" aria-label="Pixel size" title="Screen pixels per art pixel">
      <option value="2">2×</option><option value="3" selected>3×</option><option value="4">4×</option><option value="6">6×</option>
    </select>
    <button type="button" data-action="source" aria-pressed="false">Source</button>
  </div>
`;

const sourceKey = (doc) => JSON.stringify([doc?.kind, doc?.main, doc?.files ?? null]);

export default function InkSceneTool(handle, element) {
  mountStyles();
  const root = document.createElement("div");
  root.className = "ink-studio";
  root.innerHTML = TEMPLATE;
  element.append(root);
  const $ = (sel) => root.querySelector(sel);
  const viewEl = $(".view"), canvas = $("canvas"), messageEl = $(".message");
  const nameEl = $(".name"), statsEl = $(".stats"), sourceEl = $(".source"), fileEl = $(".file");
  const playButton = $('[data-action="play"]'), authoredButton = $('[data-action="authored"]');

  const say = (text, kind = "info") => {
    messageEl.textContent = text ?? "";
    messageEl.dataset.kind = kind;
  };

  let renderer;
  try {
    renderer = createRenderer(canvas, { toolkit });
  } catch (error) {
    say(`Ink Studio needs WebGL 2: ${error.message}`, "error");
  }
  const player = renderer && createPlayer(renderer);
  const orbit = createOrbit();
  let playing = true;
  let px = 3;
  let built = { key: null, generation: 0, ms: 0, name: "" };
  let disposed = false;

  // ---- building ----------------------------------------------------------
  async function rebuild() {
    const doc = handle.doc();
    if (!doc || !player) return;
    const key = sourceKey(doc);
    const generation = ++built.generation;
    say("Building…");
    await new Promise((r) => setTimeout(r, 20)); // let "Building…" paint: a bake can hold the page for seconds
    if (disposed || generation !== built.generation) return;
    const t0 = performance.now();
    try {
      const scene = await loadScene(toolkit, doc);
      const world = await scene.build(scene.seed);
      if (disposed || generation !== built.generation) return;
      if (!world || !world.data) throw new Error("the scene's build() returned no world");
      player.set(world);
      built = { ...built, key, ms: performance.now() - t0, name: scene.name ?? doc.title ?? "" };
      say("");
    } catch (error) {
      if (disposed || generation !== built.generation) return;
      built.key = key;
      console.error("[ink-studio]", error);
      say(`${player.world ? "Showing the last good build. " : ""}${error?.stack ?? error}`, "error");
    }
    showStats();
  }

  let pending;
  function schedule(delay) {
    clearTimeout(pending);
    pending = setTimeout(rebuild, delay);
  }

  function showStats() {
    const doc = handle.doc();
    nameEl.textContent = doc?.title || built.name || "Ink Studio";
    const w = player?.world;
    statsEl.textContent = w
      ? `${w.count.toLocaleString()} splats · built in ${Math.round(built.ms)} ms · t ${player.time.toFixed(1)} s`
      : "";
  }

  // ---- source panel --------------------------------------------------------
  let editor = null, editing = null;
  function listFiles() {
    const doc = handle.doc();
    const paths = Object.keys(doc?.files ?? {}).sort((a, b) => (a === doc.main ? -1 : b === doc.main ? 1 : a.localeCompare(b)));
    fileEl.innerHTML = "";
    for (const p of paths) fileEl.append(new Option(p, p, false, p === editing));
    fileEl.hidden = paths.length < 2;
    $(".credit").textContent = doc?.credit ?? "";
    return paths;
  }
  function openFile(path) {
    editor?.destroy();
    editor = null;
    editing = path;
    if (path) editor = createEditor($(".editor"), handle, path);
    listFiles();
  }
  fileEl.onchange = () => openFile(fileEl.value);

  // ---- input ---------------------------------------------------------------
  let drag = null;
  viewEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.altKey };
    viewEl.setPointerCapture(e.pointerId);
    viewEl.classList.add("dragging");
  });
  viewEl.addEventListener("pointermove", (e) => {
    if (!drag || !player?.world) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) orbit.pan(player.world, dx, dy);
    else orbit.turn(player.world, dx, dy);
  });
  const endDrag = () => {
    drag = null;
    viewEl.classList.remove("dragging");
  };
  viewEl.addEventListener("pointerup", endDrag);
  viewEl.addEventListener("pointercancel", endDrag);
  viewEl.addEventListener("wheel", (e) => {
    if (!player?.world) return;
    e.preventDefault();
    orbit.dolly(player.world, e.deltaY);
  }, { passive: false });

  root.querySelector(".bar").addEventListener("click", (e) => {
    const action = e.target.closest("button")?.dataset.action;
    if (action === "play") {
      playing = !playing;
      playButton.textContent = playing ? "Pause" : "Play";
      playButton.setAttribute("aria-pressed", String(playing));
    } else if (action === "restart") {
      built.key = null;
      schedule(0);
    } else if (action === "authored") {
      orbit.release();
    } else if (action === "source") {
      const open = sourceEl.hidden;
      sourceEl.hidden = !open;
      e.target.setAttribute("aria-pressed", String(open));
      if (open && !editor) openFile(handle.doc()?.kind === "builtin" ? null : handle.doc()?.main);
      if (!open) openFile(null);
    }
  });
  $(".px").onchange = (e) => (px = Number(e.target.value));

  // ---- the loop --------------------------------------------------------------
  let last, raf, statsAt = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = last === undefined ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!player?.world) return;
    if (playing) player.step(dt);
    const rect = viewEl.getBoundingClientRect();
    const width = Math.max(16, Math.round(rect.width / px)), height = Math.max(16, Math.round(rect.height / px));
    try {
      player.draw({ width, height, camera: orbit.camera() });
    } catch (error) {
      console.error("[ink-studio] draw", error);
      say(`Drawing failed: ${error?.stack ?? error}`, "error");
      playing = false;
    }
    authoredButton.hidden = !orbit.isFree();
    if (now - statsAt > 250) {
      statsAt = now;
      showStats();
    }
  }
  raf = requestAnimationFrame(tick);

  // ---- the doc -----------------------------------------------------------------
  function onDocChange() {
    const doc = handle.doc();
    if (sourceKey(doc) !== built.key) schedule(built.key === null ? 0 : 600);
    if (!sourceEl.hidden) listFiles();
    showStats();
  }
  handle.on("change", onDocChange);
  rebuild();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    clearTimeout(pending);
    handle.off("change", onDocChange);
    editor?.destroy();
    renderer?.dispose();
    root.remove();
    unmountStyles();
  };
}
