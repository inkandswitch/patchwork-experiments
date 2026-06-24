/**
 * Spatial Patchwork Host — the orchestrator tool.
 *
 * The host's doc is a folder ({ title, docs[], calibrationUrl, activeIndex }).
 * It has two top-level phases, toggled by `doc.hostMode` ("calibrate" | "use"):
 *
 *  - "calibrate": mounts the copied apriltag-projector Tool against the dedicated
 *    calibration doc, giving the full align/calibrate/test workflow that writes
 *    the cameraViewBox + homography into that doc.
 *
 *  - "use": hides the calibration UI and renders the aligned box (cameraViewBox
 *    sub-rect of the stage). The box is filled by an embedded <patchwork-view>
 *    of the active folder doc, wrapped by the two spatial provider components.
 *    A camera + detector run in this view and push normalized tag positions into
 *    a per-instance SpatialSource that the providers relay to the embedded tool.
 *
 * Coordinate insight: the calibration corners A=[0,0]..D=[0,1] are the corners of
 * the view-box, so board space [0..1]² IS the box interior IS the embedded view.
 * cameraPointToBoard() already returns box-normalized coords — no extra transform.
 */

import {
  getRegistry,
  createDocOfDatatype2,
} from "@inkandswitch/patchwork-plugins";
import { Tool as ProjectorTool, makeDefaultDocState } from "./apriltag-core.js";
import { CALIBRATION_DATATYPE_ID } from "./folder-datatype.js";
import { createSpatialSource, SPATIAL_SOURCE_KEY } from "./spatial-source.js";
import { createDetector } from "./detection.js";

const STYLE_ID = "spatial-patchwork-host-styles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .sph-root {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      overflow: hidden;
      background: #000;
      font-family: var(--studio-family-sans, system-ui, sans-serif);
    }
    .sph-calibration-host { position: absolute; inset: 0; }
    .sph-use-stage { position: absolute; inset: 0; background: #000; }
    .sph-box {
      position: absolute;
      overflow: hidden;
      background: #000;
    }
    .sph-box > patchwork-view,
    .sph-box .sph-provider {
      display: block;
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    .sph-bar {
      position: absolute;
      top: var(--studio-space-sm, 0.5rem);
      left: var(--studio-space-sm, 0.5rem);
      z-index: 30;
      display: flex;
      gap: var(--studio-space-xs, 0.375rem);
      align-items: center;
      flex-wrap: wrap;
      max-width: calc(100% - 1rem);
      padding: var(--studio-space-xs, 0.375rem);
      background: var(--studio-fill, white);
      color: var(--studio-line, black);
      border: 1px solid var(--studio-fill-offset-20, #ccc);
      border-radius: var(--studio-radius-sm, 4px);
      box-shadow: var(--studio-shadow-sm, 0 1px 3px rgba(0,0,0,0.2));
    }
    .sph-bar button, .sph-bar select {
      font: inherit; font-size: 0.85rem;
      padding: 0.3rem 0.6rem;
      background: var(--studio-fill, white);
      color: var(--studio-line, black);
      border: 1px solid var(--studio-fill-offset-20, #ccc);
      border-radius: var(--studio-radius-sm, 4px);
      cursor: pointer;
    }
    .sph-bar button[data-active] { border-color: var(--studio-primary, #35f7ca); }
    .sph-bar .sph-status { font-size: 0.78rem; color: var(--studio-line-offset-50, #888); }

    .sph-create-new { position: relative; display: inline-block; }
    .sph-create-menu {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 40;
      min-width: 12rem;
      max-height: 16rem;
      overflow: auto;
      padding: 0.25rem;
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: var(--studio-fill, white);
      border: 1px solid var(--studio-fill-offset-20, #ccc);
      border-radius: var(--studio-radius-sm, 4px);
      box-shadow: var(--studio-shadow-md, 0 4px 12px rgba(0,0,0,0.3));
    }
    .sph-create-item {
      text-align: left;
      border: none !important;
      background: transparent !important;
      border-radius: var(--studio-radius-sm, 4px);
    }
    .sph-create-item:hover {
      background: color-mix(in oklch, var(--studio-fill, white), var(--studio-line, black) 8%) !important;
    }
    .sph-create-empty {
      font-size: 0.78rem;
      color: var(--studio-line-offset-50, #888);
      padding: 0.35rem 0.5rem;
    }
  `;
  document.head.appendChild(style);
}

export function HostTool(handle, element) {
  ensureStyles();
  const repo = element.repo ?? window.repo;

  const prevPosition = element.style.position;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  const root = document.createElement("div");
  root.className = "sph-root";
  element.appendChild(root);

  // Per-instance live data channel for the providers (no globals).
  const source = createSpatialSource();

  // Calibration doc handle, resolved lazily.
  let calHandle = null;
  let calOff = null;

  // The mounted projector Tool's cleanup (calibrate phase only).
  let projectorCleanup = null;
  // The detector subsystem (use phase only).
  let detector = null;
  let detectorStatus = "idle";

  // Use-phase camera plumbing.
  let useVideo = null;
  let useStream = null;
  let resizeObserver = null;
  let boxEl = null;

  let destroyed = false;

  function hostMode() {
    const doc = handle.doc();
    return doc && doc.hostMode === "use" ? "use" : "calibrate";
  }

  async function ensureCalibration() {
    const doc = handle.doc();
    if (doc.calibrationUrl) {
      if (!calHandle || calHandle.url !== doc.calibrationUrl) {
        calHandle = await repo.find(doc.calibrationUrl);
      }
      return calHandle;
    }
    const dt = await getRegistry("patchwork:datatype").loadWhenReady(
      CALIBRATION_DATATYPE_ID,
    );
    const created = await createDocOfDatatype2(dt, repo);
    handle.change((d) => {
      d.calibrationUrl = created.url;
    });
    calHandle = created;
    return calHandle;
  }

  function getCalDocState() {
    if (!calHandle) return null;
    return makeDefaultDocState(calHandle.doc());
  }

  function getLiveSize() {
    if (!useVideo) return null;
    const w = useVideo.videoWidth;
    const h = useVideo.videoHeight;
    return w && h ? { w, h } : null;
  }

  // --- camera (use phase) --------------------------------------------------
  async function startUseCamera() {
    if (useStream) return;
    try {
      useStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 4096 }, height: { ideal: 2160 } },
        audio: false,
      });
      useVideo.srcObject = useStream;
      await lockCameraControls(useStream.getVideoTracks()[0]);
      detector?.ensure();
    } catch (err) {
      detectorStatus = "error";
      renderBarStatus(
        "Camera error: " + (err && err.message ? err.message : err),
      );
    }
  }

  function stopUseCamera() {
    if (useStream) {
      for (const track of useStream.getTracks()) track.stop();
      useStream = null;
    }
    if (useVideo) useVideo.srcObject = null;
  }

  async function lockCameraControls(track) {
    if (!track || !track.getCapabilities || !track.applyConstraints) return;
    let caps = {};
    try {
      caps = track.getCapabilities() || {};
    } catch {
      return;
    }
    const settings = track.getSettings ? track.getSettings() : {};
    const advanced = [];
    if (Array.isArray(caps.focusMode)) {
      if (caps.focusMode.includes("manual")) advanced.push({ focusMode: "manual" });
      else if (caps.focusMode.includes("none")) advanced.push({ focusMode: "none" });
    }
    if (caps.zoom && typeof caps.zoom === "object") {
      const min = Number.isFinite(caps.zoom.min) ? caps.zoom.min : 1;
      const max = Number.isFinite(caps.zoom.max) ? caps.zoom.max : min;
      const cur = Number.isFinite(settings.zoom) ? settings.zoom : min;
      advanced.push({ zoom: Math.max(min, Math.min(cur, max)) });
    }
    if (!advanced.length) return;
    try {
      await track.applyConstraints({ advanced });
    } catch {
      /* device rejected a lock; leave as-is */
    }
  }

  // --- rendering -----------------------------------------------------------
  let bar = null;
  let statusEl = null;

  function renderBarStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function teardownCalibratePhase() {
    if (projectorCleanup) {
      try {
        projectorCleanup();
      } catch {
        /* ignore */
      }
      projectorCleanup = null;
    }
  }

  function teardownUsePhase() {
    detector?.stop();
    detector = null;
    stopUseCamera();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    useVideo = null;
    boxEl = null;
  }

  function buildBar(mode) {
    if (bar) bar.remove();
    bar = document.createElement("div");
    bar.className = "sph-bar";

    const calBtn = document.createElement("button");
    calBtn.textContent = "Calibrate";
    if (mode === "calibrate") calBtn.setAttribute("data-active", "");
    calBtn.onclick = () => handle.change((d) => { d.hostMode = "calibrate"; });

    const useBtn = document.createElement("button");
    useBtn.textContent = "Use";
    if (mode === "use") useBtn.setAttribute("data-active", "");
    useBtn.onclick = () => handle.change((d) => { d.hostMode = "use"; });

    bar.append(calBtn, useBtn);

    if (mode === "use") {
      const doc = handle.doc();
      const docs = Array.isArray(doc.docs) ? doc.docs : [];
      // Active doc picker.
      const picker = document.createElement("select");
      docs.forEach((link, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = link.name || link.type || `Doc ${i + 1}`;
        if (i === (doc.activeIndex || 0)) opt.selected = true;
        picker.appendChild(opt);
      });
      if (!docs.length) {
        const opt = document.createElement("option");
        opt.textContent = "(no docs yet)";
        picker.appendChild(opt);
        picker.disabled = true;
      }
      picker.onchange = () =>
        handle.change((d) => { d.activeIndex = Number(picker.value) || 0; });
      bar.appendChild(picker);

      bar.appendChild(buildCreateNew());

      const camBtn = document.createElement("button");
      camBtn.textContent = useStream ? "Stop camera" : "Start camera";
      camBtn.onclick = () => {
        if (useStream) {
          stopUseCamera();
          render();
        } else {
          startUseCamera();
          render();
        }
      };
      bar.appendChild(camBtn);
    }

    statusEl = document.createElement("span");
    statusEl.className = "sph-status";
    bar.appendChild(statusEl);

    root.appendChild(bar);
  }

  // "Create new ▾" — a dropdown of listed datatypes (like the sideboard's Create
  // New button). Creates a child doc of the chosen datatype, links it into the
  // host folder, and makes it the active embedded doc.
  function buildCreateNew() {
    const wrap = document.createElement("div");
    wrap.className = "sph-create-new";

    const trigger = document.createElement("button");
    trigger.textContent = "Create new ▾";
    wrap.appendChild(trigger);

    const menu = document.createElement("div");
    menu.className = "sph-create-menu";
    menu.style.display = "none";
    wrap.appendChild(menu);

    const datatypes = listedDatatypes();
    if (!datatypes.length) {
      const empty = document.createElement("div");
      empty.className = "sph-create-empty";
      empty.textContent = "No datatypes registered";
      menu.appendChild(empty);
    } else {
      for (const dt of datatypes) {
        const item = document.createElement("button");
        item.className = "sph-create-item";
        item.textContent = dt.name || dt.id;
        item.onclick = () => {
          closeMenu();
          createNewDoc(dt);
        };
        menu.appendChild(item);
      }
    }

    const closeMenu = () => {
      menu.style.display = "none";
      document.removeEventListener("pointerdown", onOutside, true);
    };
    const onOutside = (event) => {
      if (!wrap.contains(event.target)) closeMenu();
    };
    trigger.onclick = () => {
      const open = menu.style.display !== "none";
      if (open) {
        closeMenu();
      } else {
        menu.style.display = "block";
        document.addEventListener("pointerdown", onOutside, true);
      }
    };

    return wrap;
  }

  function listedDatatypes() {
    try {
      const reg = getRegistry("patchwork:datatype");
      const all = reg.filter ? reg.filter((d) => !d.unlisted) : [];
      // Don't offer the host's own folder type or the calibration type.
      return all.filter(
        (d) =>
          d.id !== "spatial-patchwork-host" &&
          d.id !== CALIBRATION_DATATYPE_ID,
      );
    } catch {
      return [];
    }
  }

  async function createNewDoc(datatypePlugin) {
    try {
      const reg = getRegistry("patchwork:datatype");
      const dt = await reg.loadWhenReady(datatypePlugin.id);
      const child = await createDocOfDatatype2(dt, repo);
      // Prefer the datatype's own title for the link name (matches sideboard).
      let name = datatypePlugin.name || datatypePlugin.id;
      try {
        name = dt.module.getTitle(child.doc()) || name;
      } catch {
        /* getTitle optional */
      }
      handle.change((d) => {
        if (!Array.isArray(d.docs)) d.docs = [];
        d.docs.push({ name, type: datatypePlugin.id, url: child.url });
        d.activeIndex = d.docs.length - 1;
      });
    } catch (err) {
      window.alert("Could not create doc: " + err);
    }
  }

  function renderCalibratePhase() {
    teardownUsePhase();
    const hostEl = document.createElement("div");
    hostEl.className = "sph-calibration-host";
    // The projector Tool expects element.repo; pass it through.
    hostEl.repo = repo;
    root.appendChild(hostEl);
    // Mount the copied projector Tool against the calibration doc.
    projectorCleanup = ProjectorTool(calHandle, hostEl);
  }

  function renderUsePhase() {
    teardownCalibratePhase();
    const doc = handle.doc();
    const calDocState = getCalDocState();
    const cvb = (calDocState && calDocState.box) || { x: 0, y: 0, w: 1, h: 1 };

    const stage = document.createElement("div");
    stage.className = "sph-use-stage";
    root.appendChild(stage);

    boxEl = document.createElement("div");
    boxEl.className = "sph-box";
    boxEl.style.left = cvb.x * 100 + "%";
    boxEl.style.top = cvb.y * 100 + "%";
    boxEl.style.width = cvb.w * 100 + "%";
    boxEl.style.height = cvb.h * 100 + "%";
    stage.appendChild(boxEl);

    // Provider wrappers (order is irrelevant — independent selectors). Stamp the
    // per-instance source on each before setting the component attribute.
    const apriltagsWrapper = document.createElement("patchwork-view");
    apriltagsWrapper.className = "sph-provider";
    apriltagsWrapper[SPATIAL_SOURCE_KEY] = source;
    apriltagsWrapper.setAttribute("component", "spatial-apriltags-provider");

    const coordWrapper = document.createElement("patchwork-view");
    coordWrapper.className = "sph-provider";
    coordWrapper[SPATIAL_SOURCE_KEY] = source;
    coordWrapper.setAttribute("component", "spatial-coordinate-system-provider");

    // Embedded active doc — no tool-id; the registry mounts the default tool.
    const docs = Array.isArray(doc.docs) ? doc.docs : [];
    const active = docs[doc.activeIndex || 0];
    const embedded = document.createElement("patchwork-view");
    embedded.className = "sph-embedded";
    if (active && active.url) embedded.setAttribute("doc-url", active.url);

    coordWrapper.appendChild(embedded);
    apriltagsWrapper.appendChild(coordWrapper);
    boxEl.appendChild(apriltagsWrapper);

    // Off-screen video for detection (the operator doesn't need to see it here;
    // could be surfaced later). Kept attached so the browser keeps decoding.
    useVideo = document.createElement("video");
    useVideo.autoplay = true;
    useVideo.muted = true;
    useVideo.playsInline = true;
    useVideo.style.position = "absolute";
    useVideo.style.width = "1px";
    useVideo.style.height = "1px";
    useVideo.style.opacity = "0";
    useVideo.style.pointerEvents = "none";
    stage.appendChild(useVideo);

    // Live box size -> coordinate-system provider.
    const emitSize = () => {
      const r = boxEl.getBoundingClientRect();
      source.coordinateSystem.set({ width: r.width, height: r.height });
    };
    resizeObserver = new ResizeObserver(emitSize);
    resizeObserver.observe(boxEl);
    emitSize();

    // Detector pushes tags into source.apriltags.
    detector = createDetector({
      video: useVideo,
      getDocState: getCalDocState,
      getLiveSize,
      tagsEmitter: source.apriltags,
      onStateChange: (state, error) => {
        detectorStatus = state;
        renderBarStatus(
          state === "error"
            ? "Detector error: " + (error || "")
            : state === "ready"
              ? "Detecting…"
              : state === "loading"
                ? "Loading detector…"
                : "",
        );
      },
    });
    if (useStream) detector.ensure();

    renderBarStatus(
      !calDocState || !calDocState.homographyCamToBoard
        ? "Calibrate first (no homography yet)."
        : useStream
          ? "Detecting…"
          : "Start the camera to detect tags.",
    );
  }

  function render() {
    if (destroyed || !calHandle) return;
    const mode = hostMode();
    // Clear root children except persistent style; rebuild.
    root.innerHTML = "";
    if (mode === "calibrate") renderCalibratePhase();
    else renderUsePhase();
    buildBar(mode);
  }

  // --- lifecycle -----------------------------------------------------------
  let lastHostMode = null;
  function onChange() {
    const mode = hostMode();
    if (mode !== lastHostMode) {
      lastHostMode = mode;
      render();
    }
    // (Within a phase, the projector Tool and providers react to their own docs;
    // re-render the use box if cameraViewBox/activeIndex changed.)
    else if (mode === "use") {
      // Cheap: reposition the box and update embedded doc if it changed.
      maybeUpdateUse();
    }
  }

  function maybeUpdateUse() {
    if (!boxEl) return render();
    const doc = handle.doc();
    const calDocState = getCalDocState();
    const cvb = (calDocState && calDocState.box) || { x: 0, y: 0, w: 1, h: 1 };
    boxEl.style.left = cvb.x * 100 + "%";
    boxEl.style.top = cvb.y * 100 + "%";
    boxEl.style.width = cvb.w * 100 + "%";
    boxEl.style.height = cvb.h * 100 + "%";
    const docs = Array.isArray(doc.docs) ? doc.docs : [];
    const active = docs[doc.activeIndex || 0];
    const leaf = boxEl.querySelector("patchwork-view.sph-embedded");
    if (leaf && active && active.url && leaf.getAttribute("doc-url") !== active.url) {
      leaf.setAttribute("doc-url", active.url);
    }
    // Keep the toolbar's doc picker / camera button in sync (e.g. after Add doc)
    // without remounting the embedded view or restarting the detector.
    buildBar("use");
  }

  (async () => {
    await ensureCalibration();
    if (destroyed) return;
    calOff = calHandle.on("change", () => {
      // Calibration changes (box/homography) affect the use box; re-sync.
      if (hostMode() === "use") maybeUpdateUse();
    });
    lastHostMode = hostMode();
    render();
  })();

  handle.on("change", onChange);

  return () => {
    destroyed = true;
    handle.off("change", onChange);
    if (calOff) calOff();
    teardownCalibratePhase();
    teardownUsePhase();
    root.remove();
    element.style.position = prevPosition;
  };
}
