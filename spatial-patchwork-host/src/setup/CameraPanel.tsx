import { onMount, onCleanup, createEffect, For, Show } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { CalibrationDoc } from "../folder-datatype";
import {
  getCalibrationTargets,
  cameraPointToBoard,
  boardPointToCamera,
  scalePoint,
  normalizeCameraSize,
  clonePoint,
  cloneSize,
  nextIncompleteTargetId,
  makeDefaultDocState,
} from "../apriltag-core.js";
import { makeDraggable } from "../lib/draggable";
import type { Camera } from "../camera";

const MAX_TEST_MARKERS = 8;

/**
 * Large draggable camera preview with a click-to-capture overlay. In calibrate
 * mode a click records (active target board point ↔ clicked camera pixel); in
 * test mode a click projects through the homography to a board marker.
 */
export function CameraPanel(props: {
  calHandle: DocHandle<CalibrationDoc>;
  calDoc: CalibrationDoc;
  camera: Camera;
}) {
  let stageEl!: HTMLDivElement;
  let overlay!: HTMLCanvasElement;
  let header!: HTMLDivElement;

  const liveSize = () => props.camera.liveSize();

  // Draggable panel (local position; calibration panel placement is per-view).
  let panelEl!: HTMLDivElement;
  const dragHandlers = makeDraggableLocal(() => panelEl);

  function eventToIntrinsic(event: MouseEvent): [number, number] | null {
    const ls = liveSize();
    if (!ls) return null;
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return [
      clamp01((event.clientX - rect.left) / rect.width) * ls.w,
      clamp01((event.clientY - rect.top) / rect.height) * ls.h,
    ];
  }

  function onClick(event: MouseEvent) {
    const ls = liveSize();
    const cameraPoint = eventToIntrinsic(event);
    if (!ls || !cameraPoint) return;
    const doc = props.calHandle.doc();
    if (!doc) return;

    if (doc.mode === "calibrate") {
      const targets = getCalibrationTargets(doc.gridSize);
      const active = targets.find((t) => t.id === doc.activeTargetId) ?? targets[0];
      if (!active) return;
      props.calHandle.change((d) => {
        if (!d.pairs || typeof d.pairs !== "object") d.pairs = {};
        d.pairs[active.id] = {
          board: clonePoint(active.board),
          camera: clonePoint(cameraPoint),
          cameraSize: cloneSize(ls),
        };
        d.homographyCamToBoard = null;
        d.homographyBoardToCam = null;
        d.cameraCalibrationSize = null;
        d.activeTargetId = nextIncompleteTargetId(targets, d.pairs, active.id);
      });
    } else if (doc.mode === "test") {
      // Normalize first: automerge stores the homography as a proxy array and a
      // possibly-partial camera size; makeDefaultDocState turns them into the
      // plain shapes cameraPointToBoard expects.
      const ds = makeDefaultDocState(doc);
      if (!ds.homographyCamToBoard) {
        console.warn("[spatial-host] test click ignored: no solved homography");
        return;
      }
      const board = cameraPointToBoard(ds, cameraPoint, ls);
      if (!board) {
        console.warn("[spatial-host] test click: cameraPointToBoard returned null", {
          cameraPoint,
          liveSize: ls,
          calibrationSize: ds.cameraCalibrationSize,
        });
        return;
      }
      props.calHandle.change((d) => {
        if (!Array.isArray(d.testMarkers)) d.testMarkers = [];
        // Mutate the automerge array in place. Do NOT reassign it to a slice of
        // itself — that re-inserts the existing (already-in-doc) marker objects
        // and throws "Cannot create a reference to an existing document object".
        d.testMarkers.push({
          board: clonePoint(board),
          camera: clonePoint(cameraPoint),
        });
        while (d.testMarkers.length > MAX_TEST_MARKERS) d.testMarkers.shift();
      });
    }
  }

  // --- overlay drawing -----------------------------------------------------
  function draw() {
    const ls = liveSize();
    const rect = stageEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (overlay.width !== w * dpr) overlay.width = w * dpr;
    if (overlay.height !== h * dpr) overlay.height = h * dpr;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!ls) return;

    const doc = props.calDoc;
    const toOverlay = (pt: [number, number]) =>
      [(pt[0] / ls.w) * w, (pt[1] / ls.h) * h] as [number, number];

    if (doc.mode === "calibrate") {
      const targets = getCalibrationTargets(doc.gridSize);
      // predicted positions once solved
      if (doc.homographyBoardToCam) {
        const ds = makeDefaultDocState(doc);
        for (const t of targets) {
          const cam = boardPointToCamera(ds, t.board, ls);
          if (!cam) continue;
          const [x, y] = toOverlay(cam);
          ring(ctx, x, y, t.id === doc.activeTargetId ? "#35f7ca" : "rgba(255,255,255,0.45)");
        }
      }
      for (const t of targets) {
        const pair = doc.pairs[t.id];
        if (!pair) continue;
        const pairSize = normalizeCameraSize(pair.cameraSize) || doc.cameraCalibrationSize || ls;
        const live = scalePoint(pair.camera, pairSize, ls);
        const [x, y] = toOverlay(live);
        crosshair(ctx, x, y, t.id === doc.activeTargetId ? "#35f7ca" : "#fff", t.label);
      }
    } else if (doc.mode === "test") {
      doc.testMarkers.forEach((m, i) => {
        const [x, y] = toOverlay(m.camera);
        crosshair(
          ctx,
          x,
          y,
          i === doc.testMarkers.length - 1 ? "#35f7ca" : "rgba(255,255,255,0.82)",
          i === doc.testMarkers.length - 1 ? "test" : "",
        );
      });
    }
  }

  // Redraw whenever the doc or live size changes, and on window resize.
  createEffect(() => {
    // touch reactive deps
    void props.calDoc.mode;
    void props.calDoc.pairs;
    void props.calDoc.testMarkers;
    void props.calDoc.activeTargetId;
    void liveSize();
    queueMicrotask(draw);
  });

  onMount(() => {
    // Mount the shared camera <video> into our stage. The Use phase shrinks the
    // shared video off-screen (1px/opacity:0); reset those inline styles so it
    // displays full-size here (otherwise the stage collapses and the overlay has
    // zero size, so capture/test clicks map nowhere).
    const video = props.camera.video;
    video.removeAttribute("style");
    stageEl.prepend(video);
    video.classList.add("sph-camera-video");
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    props.camera.video.addEventListener("loadedmetadata", draw);
    draw();
    onCleanup(() => {
      window.removeEventListener("resize", onResize);
      props.camera.video.removeEventListener("loadedmetadata", draw);
      // Detach the shared video so it can be reused by the Use phase.
      if (props.camera.video.parentElement === stageEl) {
        stageEl.removeChild(props.camera.video);
      }
    });
  });

  const devices = () => props.camera.devices();

  return (
    <div ref={panelEl} class="sph-camera-panel" style={{ top: "0.5rem", right: "0.5rem" }}>
      <div ref={header} class="sph-camera-header" {...dragHandlers}>
        <span class="sph-camera-title">Camera</span>
        <span class="sph-camera-res">
          {(() => {
            const ls = liveSize();
            return ls ? `${ls.w}×${ls.h}` : "";
          })()}
        </span>
      </div>
      <div ref={stageEl} class="sph-camera-stage">
        <canvas ref={overlay} class="sph-camera-overlay" onClick={onClick} />
      </div>
      <Show when={devices().length > 1}>
        <select
          class="sph-camera-devices"
          value={props.camera.deviceId()}
          onChange={(e) => props.camera.start(e.currentTarget.value)}
        >
          <For each={devices()}>
            {(d, i) => (
              <option value={d.deviceId}>{d.label || `Camera ${i() + 1}`}</option>
            )}
          </For>
        </select>
      </Show>
    </div>
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function crosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label?: string,
) {
  const r = 9;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (label) {
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = color;
    ctx.fillText(label, x + 10, y - 8);
  }
  ctx.restore();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Local (non-persisted) drag for the calibration camera panel.
function makeDraggableLocal(getPanel: () => HTMLElement) {
  const onPointerDown = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    const panel = getPanel();
    const parent = (panel.offsetParent as HTMLElement) ?? document.body;
    const parentRect = parent.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const onMove = (m: PointerEvent) => {
      const left = Math.max(0, Math.min(m.clientX - parentRect.left - offsetX, parentRect.width - rect.width));
      const top = Math.max(0, Math.min(m.clientY - parentRect.top - offsetY, parentRect.height - rect.height));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
    };
    const onUp = (u: PointerEvent) => {
      handle.releasePointerCapture(u.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  };
  return { onPointerDown };
}
