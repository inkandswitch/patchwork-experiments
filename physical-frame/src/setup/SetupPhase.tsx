import { For, Show, onMount, onCleanup } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { CalibrationDoc } from "../folder-datatype";
import {
  getCalibrationTargets,
  projectBoardToStage,
} from "../calibration-core.js";
import { AlignBox } from "./AlignBox";
import { CameraPanel } from "./CameraPanel";
import type { Camera } from "../camera";

const STEP = 0.005;
const COARSE = 0.02;

export function SetupPhase(props: {
  calHandle: DocHandle<CalibrationDoc>;
  calDoc: CalibrationDoc;
  camera: Camera;
}) {
  const box = () => props.calDoc.cameraViewBox;
  const targets = () => getCalibrationTargets(props.calDoc.gridSize);
  const activeId = () => props.calDoc.activeTargetId;

  // Arrow-key nudging of the view-box (align mode only).
  const onKeyDown = (event: KeyboardEvent) => {
    if (props.calDoc.mode !== "align") return;
    const t = event.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)
    ) {
      return;
    }
    const step = event.shiftKey ? COARSE : STEP;
    const apply = (fn: (b: CalibrationDoc["cameraViewBox"]) => void) => {
      props.calHandle.change((d) => fn(d.cameraViewBox));
      event.preventDefault();
    };
    switch (event.key) {
      case "ArrowLeft": apply((b) => (b.x = clamp(b.x - step, 1 - b.w))); break;
      case "ArrowRight": apply((b) => (b.x = clamp(b.x + step, 1 - b.w))); break;
      case "ArrowUp": apply((b) => (b.y = clamp(b.y - step, 1 - b.h))); break;
      case "ArrowDown": apply((b) => (b.y = clamp(b.y + step, 1 - b.h))); break;
      case "+": case "=": apply((b) => (b.w = clamp(b.w + step, 1))); break;
      case "-": case "_": apply((b) => (b.w = Math.max(0.02, b.w - step))); break;
      case "]": apply((b) => (b.h = clamp(b.h + step, 1))); break;
      case "[": apply((b) => (b.h = Math.max(0.02, b.h - step))); break;
    }
  };

  onMount(() => document.addEventListener("keydown", onKeyDown));
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));

  return (
    <>
      <div class="sph-stage">
        <AlignBox
          box={box()}
          interactive={props.calDoc.mode === "align"}
          onChange={(next) =>
            props.calHandle.change((d) => {
              d.cameraViewBox = next;
            })
          }
        />

        {/* Calibration target dots */}
        <Show when={props.calDoc.mode === "calibrate"}>
          <For each={targets()}>
            {(target) => {
              const [x, y] = projectBoardToStage(box(), target.board);
              const captured = !!props.calDoc.pairs[target.id];
              return (
                <div
                  class="sph-target"
                  style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                  data-captured={captured ? "" : undefined}
                  data-active={target.id === activeId() ? "" : undefined}
                >
                  <div
                    class="sph-target-label"
                    style={{ transform: labelTransform(target.board) }}
                  >
                    {target.label}
                  </div>
                </div>
              );
            }}
          </For>
        </Show>

        {/* Test markers */}
        <Show when={props.calDoc.mode === "test"}>
          <For each={props.calDoc.testMarkers}>
            {(marker) => {
              const [x, y] = projectBoardToStage(box(), marker.board);
              return (
                <div
                  class="sph-test-marker"
                  style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                />
              );
            }}
          </For>
        </Show>
      </div>

      <Show when={props.camera.active()}>
        <CameraPanel calHandle={props.calHandle} calDoc={props.calDoc} camera={props.camera} />
      </Show>
    </>
  );
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(v, max));
}

/**
 * Offset a target's label toward the interior of the bounding box so it's never
 * clipped at an edge/corner. The label is anchored at the dot center (0,0); we
 * translate it inward based on the board coordinate, with a gap past the dot.
 */
function labelTransform(board: [number, number]): string {
  const [bx, by] = board;
  const GAP = 52; // px past the dot (clears the enlarged ~76px active dot)
  // Horizontal: left edge → push right (label starts after the dot); right edge
  // → push left (label ends before the dot); center → center the label.
  let tx: string;
  if (bx < 0.4) tx = `${GAP}px`;
  else if (bx > 0.6) tx = `calc(-100% - ${GAP}px)`;
  else tx = "-50%";
  // Vertical: top edge → push down; bottom edge → push up; middle → center.
  let ty: string;
  if (by < 0.4) ty = `${GAP}px`;
  else if (by > 0.6) ty = `calc(-100% - ${GAP}px)`;
  else ty = "-50%";
  return `translate(${tx}, ${ty})`;
}
