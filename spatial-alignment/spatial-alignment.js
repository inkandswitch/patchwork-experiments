/**
 * Spatial Alignment - Bundleless Patchwork Tool
 *
 * Prototype 1.5: Manual Camera Visibility Box. A fullscreen black projector page
 * with one adjustable white rectangle (the cameraViewBox). While watching the
 * UGREEN camera feed, move/resize the projected rectangle until all four edges
 * are visible to the camera. The saved box marks the reliable camera-visible
 * working area that future projected islands should stay inside.
 *
 * The box is stored in the automerge doc (not localStorage as the spec's plain
 * HTML sketch suggested): in Patchwork the doc persists and syncs across the
 * editing device and the projector window, and — importantly — the saved box is
 * meant to be consumed by other tools to constrain islands, so it belongs in
 * shared document state.
 *
 * Geometry is stored as fractions (0-1) of the projection surface so the same
 * box lands in the same physical spot regardless of the rendering window's
 * resolution.
 *
 * @typedef {Object} CameraViewBox
 * @property {number} x  - left, fraction 0-1 of surface width
 * @property {number} y  - top, fraction 0-1 of surface height
 * @property {number} w  - width, fraction 0-1 of surface width
 * @property {number} h  - height, fraction 0-1 of surface height
 *
 * @typedef {Object} CameraViewBoxDoc
 * @property {string} title
 * @property {CameraViewBox} cameraViewBox
 */

// Bump on any code change; shown in the top-right version badge so you can
// confirm at a glance that the running build is current.
const VERSION = "0.0.4";

// ============================================================================
// Datatype
// ============================================================================

export const SpatialAlignmentDatatype = {
  init(doc) {
    doc.title = "Spatial Alignment";
    // Start as the full window; shrink it inward until all edges are visible to
    // the camera.
    doc.cameraViewBox = { x: 0, y: 0, w: 1, h: 1 };
  },

  getTitle(doc) {
    return doc.title || "Spatial Alignment";
  },

  setTitle(doc, title) {
    doc.title = title;
  },

  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

// ============================================================================
// Helpers
// ============================================================================

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// Normalize a possibly-missing/partial box to a valid fractional box.
function normalizeBox(box) {
  const b = box || {};
  const w = Math.max(0.02, Math.min(typeof b.w === "number" ? b.w : 1, 1));
  const h = Math.max(0.02, Math.min(typeof b.h === "number" ? b.h : 1, 1));
  const x = clamp01(typeof b.x === "number" ? b.x : 0);
  const y = clamp01(typeof b.y === "number" ? b.y : 0);
  return {
    x: Math.min(x, 1 - w),
    y: Math.min(y, 1 - h),
    w,
    h,
  };
}

function createStyles() {
  const style = document.createElement("style");
  style.textContent = `
    @layer package {
      :root,
      :host,
      [theme] {
        --sa-bar-bg: var(--studio-fill, white);
        --sa-bar-fg: var(--studio-line, black);
        --sa-bar-border: var(--studio-fill-offset-20, #ccc);
        --sa-bar-muted: var(--studio-line-offset-50, #888);
        --sa-accent: var(--studio-primary, #35f7ca);
        --sa-family: var(--studio-family-sans, system-ui, sans-serif);
      }
    }

    .spatial-alignment {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      overflow: hidden;
      background: #000;
      font-family: var(--sa-family);
    }

    /* The projection stage. Literal black/white are a deliberate exception to
       the "derive colors from the theme" rule: the projector surface must be
       true black with a bright-white box regardless of the active theme.
       Inset by 2px so a full-window box's white border stays fully visible
       rather than being clipped at the very edge of the surface. */
    .spatial-alignment .stage {
      position: absolute;
      inset: 2px;
      background: #000;
    }

    .spatial-alignment[data-mode="project"][data-hide-cursor] .stage {
      cursor: none;
    }

    /* The re-rendered layer (stage, box, chrome). The camera panel is a sibling
       so it survives re-renders and the video stream isn't restarted. */
    .spatial-alignment .view-layer {
      position: absolute;
      inset: 0;
    }

    /* The adjustable camera-visible box, a thin white outline. */
    .spatial-alignment .view-box {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid #fff;
      background: transparent;
    }

    .spatial-alignment[data-mode="edit"] .view-box {
      cursor: move;
      touch-action: none;
    }

    /* Resize handles: 4 edges + 4 corners. Positioned just INSIDE the box edge
       (not hanging outside) so they stay grabbable even when the box fills the
       whole window and can't overlap controls sitting outside the box. */
    .spatial-alignment .view-box .resize-handle {
      position: absolute;
      touch-action: none;
      z-index: 2;
    }
    /* Edge handles: thin strips running along each side. */
    .spatial-alignment .view-box .resize-handle[data-dir="n"],
    .spatial-alignment .view-box .resize-handle[data-dir="s"] {
      left: 14px;
      right: 14px;
      height: 12px;
      cursor: ns-resize;
    }
    .spatial-alignment .view-box .resize-handle[data-dir="e"],
    .spatial-alignment .view-box .resize-handle[data-dir="w"] {
      top: 14px;
      bottom: 14px;
      width: 12px;
      cursor: ew-resize;
    }
    .spatial-alignment .view-box .resize-handle[data-dir="n"] { top: -2px; }
    .spatial-alignment .view-box .resize-handle[data-dir="s"] { bottom: -2px; }
    .spatial-alignment .view-box .resize-handle[data-dir="w"] { left: -2px; }
    .spatial-alignment .view-box .resize-handle[data-dir="e"] { right: -2px; }
    /* Corner handles: small squares pinned inside each corner. */
    .spatial-alignment .view-box .resize-handle[data-dir="nw"],
    .spatial-alignment .view-box .resize-handle[data-dir="ne"],
    .spatial-alignment .view-box .resize-handle[data-dir="sw"],
    .spatial-alignment .view-box .resize-handle[data-dir="se"] {
      width: 16px;
      height: 16px;
    }
    .spatial-alignment .view-box .resize-handle[data-dir="nw"] { top: -2px; left: -2px; cursor: nwse-resize; }
    .spatial-alignment .view-box .resize-handle[data-dir="se"] { bottom: -2px; right: -2px; cursor: nwse-resize; }
    .spatial-alignment .view-box .resize-handle[data-dir="ne"] { top: -2px; right: -2px; cursor: nesw-resize; }
    .spatial-alignment .view-box .resize-handle[data-dir="sw"] { bottom: -2px; left: -2px; cursor: nesw-resize; }
    /* A faint dot marks each corner handle so it's discoverable. */
    .spatial-alignment[data-mode="edit"] .view-box .resize-handle[data-dir="nw"],
    .spatial-alignment[data-mode="edit"] .view-box .resize-handle[data-dir="ne"],
    .spatial-alignment[data-mode="edit"] .view-box .resize-handle[data-dir="sw"],
    .spatial-alignment[data-mode="edit"] .view-box .resize-handle[data-dir="se"] {
      background: var(--sa-accent);
      border-radius: 2px;
    }
    .spatial-alignment[data-mode="project"] .view-box .resize-handle {
      display: none;
    }

    /* Corner ticks help confirm all four edges are within the camera frame. */
    .spatial-alignment .view-box .corner {
      position: absolute;
      width: 14px;
      height: 14px;
      border: 2px solid #fff;
    }
    .spatial-alignment .view-box .corner.tl { left: -2px; top: -2px; border-right: none; border-bottom: none; }
    .spatial-alignment .view-box .corner.tr { right: -2px; top: -2px; border-left: none; border-bottom: none; }
    .spatial-alignment .view-box .corner.bl { left: -2px; bottom: -2px; border-right: none; border-top: none; }
    .spatial-alignment .view-box .corner.br { right: -2px; bottom: -2px; border-left: none; border-top: none; }

    /* Version badge, top-right. Themed chrome; hidden in project mode. */
    .spatial-alignment .version-badge {
      position: absolute;
      top: var(--studio-space-xs, 0.375rem);
      right: var(--studio-space-xs, 0.375rem);
      z-index: 10;
      padding: 0.15rem 0.4rem;
      font: 500 0.7rem/1 var(--sa-family);
      color: var(--sa-bar-muted);
      background: color-mix(in oklch, var(--sa-bar-bg), transparent 15%);
      border: 1px solid var(--sa-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      pointer-events: none;
      user-select: none;
    }
    .spatial-alignment[data-mode="project"] .version-badge {
      display: none;
    }

    /* Readout of the current box, bottom-right. Useful while calibrating. */
    .spatial-alignment .readout {
      position: absolute;
      bottom: var(--studio-space-xs, 0.375rem);
      right: var(--studio-space-xs, 0.375rem);
      z-index: 10;
      padding: 0.2rem 0.45rem;
      font: 500 0.7rem/1.3 var(--studio-family-code, ui-monospace, monospace);
      color: var(--sa-bar-muted);
      background: color-mix(in oklch, var(--sa-bar-bg), transparent 15%);
      border: 1px solid var(--sa-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      pointer-events: none;
      user-select: none;
      white-space: pre;
    }
    .spatial-alignment[data-mode="project"] .readout {
      display: none;
    }

    /* Control bar — themed chrome. Hidden in project mode. */
    .spatial-alignment .control-bar {
      position: absolute;
      top: var(--studio-space-sm, 0.5rem);
      left: var(--studio-space-sm, 0.5rem);
      z-index: 10;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--studio-space-xs, 0.375rem);
      padding: var(--studio-space-xs, 0.375rem);
      background: var(--sa-bar-bg);
      color: var(--sa-bar-fg);
      border: 1px solid var(--sa-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      box-shadow: var(--studio-shadow-sm, 0 1px 3px rgba(0,0,0,0.2));
      max-width: calc(100% - 1rem);
    }
    .spatial-alignment[data-mode="project"] .control-bar {
      display: none;
    }

    /* Minimal "Edit" affordance shown in project mode so you can re-open the
       controls without leaving fullscreen. Faint so it barely adds light. */
    .spatial-alignment .exit-project {
      position: absolute;
      top: var(--studio-space-xs, 0.375rem);
      left: var(--studio-space-xs, 0.375rem);
      z-index: 10;
      opacity: 0.25;
      transition: opacity var(--studio-transition-fast, 0.1s ease);
    }
    .spatial-alignment .exit-project:hover {
      opacity: 1;
    }

    /* Floating, draggable camera preview. Shows what the camera sees so you can
       shrink the box until all four projected edges are inside the frame. */
    .spatial-alignment .camera-panel {
      position: absolute;
      top: var(--studio-space-sm, 0.5rem);
      right: var(--studio-space-sm, 0.5rem);
      z-index: 20;
      width: 320px;
      max-width: calc(100% - 1rem);
      display: flex;
      flex-direction: column;
      background: var(--sa-bar-bg);
      border: 1px solid var(--sa-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      box-shadow: var(--studio-shadow-md, 0 4px 12px rgba(0,0,0,0.3));
      overflow: hidden;
    }
    /* Keep the camera out of the clean projection. */
    .spatial-alignment[data-mode="project"] .camera-panel {
      display: none !important;
    }
    .spatial-alignment .camera-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.25rem 0.25rem 0.25rem 0.5rem;
      background: var(--sa-bar-bg);
      color: var(--sa-bar-fg);
      cursor: move;
      touch-action: none;
      user-select: none;
    }
    .spatial-alignment .camera-title {
      font-size: 0.8rem;
      font-weight: 600;
    }
    .spatial-alignment .camera-res {
      margin-left: auto;
      font: 500 0.72rem/1 var(--studio-family-code, ui-monospace, monospace);
      color: var(--sa-bar-muted);
    }
    .spatial-alignment button.camera-close {
      padding: 0.15rem 0.4rem;
      font-size: 0.8rem;
      line-height: 1;
    }
    .spatial-alignment .camera-panel video {
      display: block;
      width: 100%;
      height: auto;
      background: #000;
    }
    .spatial-alignment .camera-devices {
      font: inherit;
      font-size: 0.78rem;
      padding: 0.25rem;
      border: none;
      border-top: 1px solid var(--sa-bar-border);
      background: var(--sa-bar-bg);
      color: var(--sa-bar-fg);
    }

    .spatial-alignment button {
      font: inherit;
      font-size: 0.85rem;
      padding: 0.3rem 0.6rem;
      background: var(--sa-bar-bg);
      color: var(--sa-bar-fg);
      border: 1px solid var(--sa-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      cursor: pointer;
    }
    .spatial-alignment button:hover {
      background: color-mix(in oklch, var(--sa-bar-bg), var(--sa-bar-fg) 6%);
    }
    .spatial-alignment button[data-variant="primary"] {
      border-color: var(--sa-accent);
    }

    .spatial-alignment .control-bar label {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.85rem;
      color: var(--sa-bar-muted);
    }

    .spatial-alignment .control-bar .hint {
      font-size: 0.78rem;
      color: var(--sa-bar-muted);
    }

    .spatial-alignment .control-bar .sep {
      width: 1px;
      align-self: stretch;
      background: var(--sa-bar-border);
      margin: 0 0.15rem;
    }
  `;
  return style;
}

// ============================================================================
// Tool
// ============================================================================

export function Tool(handle, element) {
  const style = createStyles();
  element.appendChild(style);

  // Make the host a sized positioning context so .spatial-alignment (absolute; inset:0) fills
  // exactly the visible host area and the box edges aren't pushed off-screen.
  const prevPosition = element.style.position;
  const prevHeight = element.style.height;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }
  if (!element.style.height) {
    element.style.height = "100%";
  }

  const root = document.createElement("div");
  root.className = "spatial-alignment";
  root.tabIndex = 0; // focusable so it can receive arrow-key events
  element.appendChild(root);

  // render() rebuilds this layer on every change; the camera panel lives
  // outside it so the live <video> stream isn't torn down on every nudge.
  const viewLayer = document.createElement("div");
  viewLayer.className = "view-layer";
  root.appendChild(viewLayer);

  // Local (non-persisted) UI state.
  let mode = "edit"; // "edit" | "project"
  let renderCount = 0;

  // --- Camera preview (persistent across renders) ---------------------------
  // The camera sees the projected surface, so this panel mirrors what the
  // UGREEN camera captures: watch your projected box appear in the feed and
  // shrink it until all four edges are inside the frame.
  let cameraStream = null;
  const cameraPanel = document.createElement("div");
  cameraPanel.className = "camera-panel";
  cameraPanel.setAttribute("data-open", "");
  cameraPanel.style.display = "none"; // shown once the camera starts

  const cameraVideo = document.createElement("video");
  cameraVideo.autoplay = true;
  cameraVideo.muted = true;
  cameraVideo.playsInline = true;
  // videoWidth/Height are the true intrinsic dimensions of the rendered frame
  // (i.e. exactly what you see), available once metadata loads.
  cameraVideo.addEventListener("loadedmetadata", updateCameraResolution);
  cameraVideo.addEventListener("resize", updateCameraResolution);

  const cameraHeader = document.createElement("div");
  cameraHeader.className = "camera-header";
  const cameraTitle = document.createElement("span");
  cameraTitle.className = "camera-title";
  cameraTitle.textContent = "Camera";
  const cameraRes = document.createElement("span");
  cameraRes.className = "camera-res";
  const cameraClose = button("✕", () => stopCamera());
  cameraClose.className = "camera-close";
  cameraHeader.append(cameraTitle, cameraRes, cameraClose);

  const cameraDevicePicker = document.createElement("select");
  cameraDevicePicker.className = "camera-devices";
  cameraDevicePicker.addEventListener("change", () => {
    if (cameraStream) startCamera(cameraDevicePicker.value);
  });

  cameraPanel.append(cameraHeader, cameraVideo, cameraDevicePicker);
  root.appendChild(cameraPanel);
  makePanelDraggable(cameraPanel, cameraHeader);

  async function refreshCameraDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      const prev = cameraDevicePicker.value;
      cameraDevicePicker.innerHTML = "";
      for (const cam of cams) {
        const opt = document.createElement("option");
        opt.value = cam.deviceId;
        opt.textContent = cam.label || `Camera ${cameraDevicePicker.length + 1}`;
        cameraDevicePicker.appendChild(opt);
      }
      cameraDevicePicker.style.display = cams.length > 1 ? "" : "none";
      if (prev && cams.some((c) => c.deviceId === prev)) {
        cameraDevicePicker.value = prev;
      }
    } catch {
      /* enumerateDevices can fail before permission; ignore */
    }
  }

  async function startCamera(deviceId) {
    try {
      stopStreamOnly();
      // Ask for the camera's native/full field of view by requesting a very
      // high ideal resolution: the browser clamps to the device's true maximum
      // (you can't get more pixels than the sensor has), and `ideal` never
      // fails the request when unsupported. This avoids the camera defaulting
      // to a downscaled or cropped lower-res mode.
      const videoConstraints = {
        width: { ideal: 4096 },
        height: { ideal: 2160 },
      };
      if (deviceId) videoConstraints.deviceId = { exact: deviceId };
      const constraints = { video: videoConstraints, audio: false };
      cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraVideo.srcObject = cameraStream;
      cameraPanel.style.display = "";
      // Labels only populate after permission is granted.
      await refreshCameraDevices();
      // Reflect the actually-selected device in the picker.
      const track = cameraStream.getVideoTracks()[0];
      const settings = track && track.getSettings ? track.getSettings() : {};
      if (settings.deviceId) cameraDevicePicker.value = settings.deviceId;
      updateCameraResolution();
      updateCameraButton();
    } catch (err) {
      cameraPanel.style.display = "none";
      window.alert(
        "Could not start the camera: " +
          (err && err.message ? err.message : err) +
          "\n\nMake sure the page has camera permission and the camera isn't in use by another app.",
      );
    }
  }

  function stopStreamOnly() {
    if (cameraStream) {
      for (const track of cameraStream.getTracks()) track.stop();
      cameraStream = null;
    }
    cameraVideo.srcObject = null;
  }

  function stopCamera() {
    stopStreamOnly();
    cameraPanel.style.display = "none";
    cameraRes.textContent = "";
    updateCameraButton();
  }

  function toggleCamera() {
    if (cameraStream) stopCamera();
    else startCamera(cameraDevicePicker.value || undefined);
  }

  function updateCameraResolution() {
    const w = cameraVideo.videoWidth;
    const h = cameraVideo.videoHeight;
    cameraRes.textContent = cameraStream && w && h ? `${w}×${h}` : "";
  }

  let cameraToggleBtn = null;
  function updateCameraButton() {
    if (cameraToggleBtn) {
      cameraToggleBtn.textContent = cameraStream ? "Hide camera" : "Show camera";
    }
  }

  // Nudge step in fractions; Shift = coarse. Move with arrows, resize with
  // Shift held is too ambiguous, so: arrows move, +/- resize, [ ] resize the
  // other axis. (See buildControlBar hint text.)
  const STEP = 0.005;
  const COARSE = 0.02;

  function render() {
    const doc = handle.doc();
    if (!doc) return;

    renderCount++;
    root.setAttribute("data-mode", mode);
    if (doc.hideCursor) root.setAttribute("data-hide-cursor", "");
    else root.removeAttribute("data-hide-cursor");
    viewLayer.innerHTML = "";

    const stage = document.createElement("div");
    stage.className = "stage";
    viewLayer.appendChild(stage);

    const box = normalizeBox(doc.cameraViewBox);

    const boxEl = document.createElement("div");
    boxEl.className = "view-box";
    boxEl.style.left = box.x * 100 + "%";
    boxEl.style.top = box.y * 100 + "%";
    boxEl.style.width = box.w * 100 + "%";
    boxEl.style.height = box.h * 100 + "%";
    for (const c of ["tl", "tr", "bl", "br"]) {
      const corner = document.createElement("div");
      corner.className = "corner " + c;
      boxEl.appendChild(corner);
    }
    stage.appendChild(boxEl);

    if (mode === "edit") {
      boxEl.addEventListener("pointerdown", (e) => {
        if (e.target.classList.contains("resize-handle")) return;
        e.stopPropagation();
        startDrag(e, box, stage, boxEl);
      });
      // Resize handles on every edge and corner.
      for (const dir of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
        const handleEl = document.createElement("div");
        handleEl.className = "resize-handle";
        handleEl.dataset.dir = dir;
        handleEl.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          startResize(e, dir, box, stage, boxEl);
        });
        boxEl.appendChild(handleEl);
      }
    }

    // Version badge.
    const badge = document.createElement("div");
    badge.className = "version-badge";
    badge.textContent = `v${VERSION} · #${renderCount}`;
    viewLayer.appendChild(badge);

    if (mode === "edit") {
      const readout = document.createElement("div");
      readout.className = "readout";
      readout.textContent =
        `x ${box.x.toFixed(3)}  y ${box.y.toFixed(3)}\n` +
        `w ${box.w.toFixed(3)}  h ${box.h.toFixed(3)}`;
      viewLayer.appendChild(readout);

      const bar = document.createElement("div");
      bar.className = "control-bar";
      viewLayer.appendChild(bar);
      buildControlBar(doc, bar);
    } else {
      const exitBtn = button("Edit", () => {
        mode = "edit";
        render();
      });
      exitBtn.className = "exit-project";
      viewLayer.appendChild(exitBtn);
    }
  }

  function commitBox(updater) {
    handle.change((d) => {
      const cur = normalizeBox(d.cameraViewBox);
      const next = normalizeBox(updater(cur));
      d.cameraViewBox = next;
    });
  }

  function startDrag(e, box, stage, boxEl) {
    const rect = stage.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = box.x;
    const origY = box.y;
    let cur = { x: origX, y: origY };

    function onMove(ev) {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      cur.x = Math.min(clamp01(origX + dx), 1 - box.w);
      cur.y = Math.min(clamp01(origY + dy), 1 - box.h);
      boxEl.style.left = cur.x * 100 + "%";
      boxEl.style.top = cur.y * 100 + "%";
    }
    function onUp(ev) {
      boxEl.releasePointerCapture(ev.pointerId);
      boxEl.removeEventListener("pointermove", onMove);
      boxEl.removeEventListener("pointerup", onUp);
      commitBox((b) => ({ ...b, x: cur.x, y: cur.y }));
    }
    boxEl.setPointerCapture(e.pointerId);
    boxEl.addEventListener("pointermove", onMove);
    boxEl.addEventListener("pointerup", onUp);
  }

  // Resize by dragging one edge/corner. `dir` is a compass string (n/s/e/w and
  // corners), where each letter names a moving edge. North/west edges move the
  // origin as well as the size; south/east edges only change the size.
  function startResize(e, dir, box, stage, boxEl) {
    const rect = stage.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const MIN = 0.02;
    // Fixed edges (the box as left/top/right/bottom).
    const left = box.x;
    const top = box.y;
    const right = box.x + box.w;
    const bottom = box.y + box.h;
    const movesW = dir.includes("w");
    const movesE = dir.includes("e");
    const movesN = dir.includes("n");
    const movesS = dir.includes("s");
    let cur = { x: box.x, y: box.y, w: box.w, h: box.h };

    function onMove(ev) {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      let l = left;
      let t = top;
      let r = right;
      let bo = bottom;
      if (movesW) l = clamp01(Math.min(left + dx, right - MIN));
      if (movesE) r = clamp01(Math.max(right + dx, left + MIN));
      if (movesN) t = clamp01(Math.min(top + dy, bottom - MIN));
      if (movesS) bo = clamp01(Math.max(bottom + dy, top + MIN));
      cur = { x: l, y: t, w: r - l, h: bo - t };
      boxEl.style.left = cur.x * 100 + "%";
      boxEl.style.top = cur.y * 100 + "%";
      boxEl.style.width = cur.w * 100 + "%";
      boxEl.style.height = cur.h * 100 + "%";
    }
    function onUp(ev) {
      boxEl.releasePointerCapture(ev.pointerId);
      boxEl.removeEventListener("pointermove", onMove);
      boxEl.removeEventListener("pointerup", onUp);
      commitBox(() => cur);
    }
    boxEl.setPointerCapture(e.pointerId);
    boxEl.addEventListener("pointermove", onMove);
    boxEl.addEventListener("pointerup", onUp);
  }

  function buildControlBar(doc, bar) {
    bar.innerHTML = "";

    bar.appendChild(
      button("Project", () => {
        mode = "project";
        render();
      }),
    );
    bar.appendChild(button("Fullscreen", enterFullscreen));

    bar.appendChild(sep());

    cameraToggleBtn = button("Show camera", toggleCamera);
    cameraToggleBtn.setAttribute("data-variant", "primary");
    updateCameraButton();
    bar.appendChild(cameraToggleBtn);

    bar.appendChild(sep());

    const resetBtn = button("Reset box", () => {
      commitBox(() => ({ x: 0, y: 0, w: 1, h: 1 }));
    });
    resetBtn.setAttribute("data-variant", "primary");
    bar.appendChild(resetBtn);

    bar.appendChild(sep());

    const cursorLabel = document.createElement("label");
    const cursorCb = document.createElement("input");
    cursorCb.type = "checkbox";
    cursorCb.checked = !!doc.hideCursor;
    cursorCb.addEventListener("change", () => {
      const checked = cursorCb.checked;
      handle.change((d) => {
        d.hideCursor = checked;
      });
    });
    cursorLabel.append(cursorCb, document.createTextNode("Hide cursor"));
    bar.appendChild(cursorLabel);

    bar.appendChild(sep());

    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Arrows: move · +/−: width · [ ]: height · Shift: coarse";
    bar.appendChild(hint);
  }

  // Keyboard move/resize (per the spec). Active in both edit and project mode so
  // you can fine-tune while watching the camera with a clean projection.
  // Listens on document so it works without keeping focus on the box (clicking
  // a control button moves focus); ignored while typing in a form field.
  function onKeyDown(e) {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    // Escape: leave project mode (browser also handles fullscreen exit).
    if (e.key === "Escape") {
      if (mode === "project" && !document.fullscreenElement) {
        mode = "edit";
        render();
      }
      return;
    }

    const step = e.shiftKey ? COARSE : STEP;
    let handled = true;
    switch (e.key) {
      case "ArrowLeft":
        commitBox((b) => ({ ...b, x: b.x - step }));
        break;
      case "ArrowRight":
        commitBox((b) => ({ ...b, x: b.x + step }));
        break;
      case "ArrowUp":
        commitBox((b) => ({ ...b, y: b.y - step }));
        break;
      case "ArrowDown":
        commitBox((b) => ({ ...b, y: b.y + step }));
        break;
      case "+":
      case "=":
        commitBox((b) => ({ ...b, w: b.w + step }));
        break;
      case "-":
      case "_":
        commitBox((b) => ({ ...b, w: b.w - step }));
        break;
      case "]":
        commitBox((b) => ({ ...b, h: b.h + step }));
        break;
      case "[":
        commitBox((b) => ({ ...b, h: b.h - step }));
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  function enterFullscreen() {
    // Stay in the current mode (edit by default) so the box stays adjustable on
    // the projected surface. Use Project (or Escape) for a clean black view.
    if (element.requestFullscreen) {
      element.requestFullscreen().catch(() => {});
    }
  }

  function onFullscreenChange() {
    if (!document.fullscreenElement && mode === "project") {
      mode = "edit";
      render();
    }
  }

  function button(text, onClick) {
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  function sep() {
    const s = document.createElement("div");
    s.className = "sep";
    return s;
  }

  // Drag a floating panel by its header. Positions via left/top in pixels,
  // clamped to stay within the host element.
  function makePanelDraggable(panel, handleEl) {
    handleEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return; // let the close button work
      e.preventDefault();
      const hostRect = root.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const offsetX = e.clientX - panelRect.left;
      const offsetY = e.clientY - panelRect.top;

      function onMove(ev) {
        let left = ev.clientX - hostRect.left - offsetX;
        let top = ev.clientY - hostRect.top - offsetY;
        left = Math.max(0, Math.min(left, hostRect.width - panelRect.width));
        top = Math.max(0, Math.min(top, hostRect.height - panelRect.height));
        panel.style.left = left + "px";
        panel.style.top = top + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      }
      function onUp(ev) {
        handleEl.releasePointerCapture(ev.pointerId);
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
      }
      handleEl.setPointerCapture(e.pointerId);
      handleEl.addEventListener("pointermove", onMove);
      handleEl.addEventListener("pointerup", onUp);
    });
  }

  render();
  handle.on("change", render);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("fullscreenchange", onFullscreenChange);

  return () => {
    handle.off("change", render);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    stopStreamOnly();
    if (document.fullscreenElement === element) {
      document.exitFullscreen?.().catch(() => {});
    }
    element.style.position = prevPosition;
    element.style.height = prevHeight;
    root.remove();
    style.remove();
  };
}

// ============================================================================
// Plugin Exports
// ============================================================================

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "spatial-alignment",
    name: "Spatial Alignment",
    icon: "ScanLine",
    async load() {
      return SpatialAlignmentDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "spatial-alignment",
    name: "Spatial Alignment",
    icon: "ScanLine",
    supportedDatatypes: ["spatial-alignment"],
    async load() {
      return Tool;
    },
  },
];
