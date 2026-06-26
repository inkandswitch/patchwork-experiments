import { createMemo, createSignal, For, Show } from "solid-js";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type {
  SpatialHostDoc,
  CalibrationDoc,
  CalibrationMode,
  HostMode,
} from "./folder-datatype";
import { CreateNew } from "./CreateNew";
import {
  solveSetup,
  calibrationStatus,
  recaptureActive,
  clearCapture,
  resetCalibration,
} from "./setup/calibrate-logic";
import { makeDraggable } from "./lib/draggable";
import type { Camera } from "./camera";

const SETUP_MODES: { id: CalibrationMode; label: string }[] = [
  { id: "align", label: "Align" },
  { id: "calibrate", label: "Calibrate" },
  { id: "test", label: "Test" },
];

export function ControlPanel(props: {
  hostHandle: DocHandle<SpatialHostDoc>;
  hostDoc: SpatialHostDoc;
  calHandle: DocHandle<CalibrationDoc> | undefined;
  calDoc: CalibrationDoc | undefined;
  repo: Repo;
  mode: HostMode;
  setHostMode: (m: HostMode) => void;
  requestFullscreen: () => void;
  camera: Camera;
  /** Whether calibration is solved (gates Sample/Use). */
  calibrated: boolean;
  /** Whether a background has been sampled (for status + Use readiness). */
  hasBackground: boolean;
  /** Sample the current frame as the empty-surface background. */
  onSample: () => void;
}) {
  // Collapse is LOCAL to this screen — not persisted to the doc — so collapsing
  // on one display doesn't hide the panel on the projector or other viewers.
  const [collapsed, setCollapsed] = createSignal(false);

  const setMode = (m: CalibrationMode) =>
    props.calHandle?.change((d) => {
      d.mode = m;
    });

  const setGrid = (g: 4 | 9) =>
    props.calHandle?.change((d) => {
      d.gridSize = g;
      d.homographyCamToBoard = null;
      d.homographyBoardToCam = null;
      d.cameraCalibrationSize = null;
    });

  // Persisted drag: writes barPosition into the host doc.
  const dragHandlers = makeDraggable({
    getPosition: () => props.hostDoc.barPosition,
    onChange: (pos) =>
      props.hostHandle.change((d) => {
        d.barPosition = pos;
      }),
  });

  const panelStyle = () => {
    const pos = props.hostDoc.barPosition;
    if (pos) {
      return { left: `${pos.left}px`, top: `${pos.top}px`, right: "auto" };
    }
    return { left: "0.5rem", top: "0.5rem" };
  };

  const toggleCollapsed = () => setCollapsed((c) => !c);

  // Sampling the background grabs whatever the camera sees — including THIS
  // panel AND the mouse cursor, both in frame. So hide the panel + cursor, wait
  // a couple frames for the projector/camera to show the clean surface, sample,
  // then bring them back.
  const [hidden, setHidden] = createSignal(false);
  const sampleWithPanelHidden = () => {
    setHidden(true);
    document.body.classList.add("sph-sampling"); // hides the cursor (see css)
    // Two rAFs ensure the hide has painted; the timeout gives the projector +
    // camera a beat to actually display/capture the panel-free surface.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setTimeout(async () => {
          // Freeze the camera (exposure/gain/white-balance) at THIS moment so the
          // picture can't drift between sampling the background and drawing on it
          // — the main cause of detection working then suddenly failing.
          await props.camera.relock();
          props.onSample();
          setHidden(false);
          document.body.classList.remove("sph-sampling");
        }, 250),
      ),
    );
  };

  return (
    <div
      class="sph-panel"
      style={panelStyle()}
      data-collapsed={collapsed() ? "" : undefined}
      data-hidden={hidden() ? "" : undefined}
    >
      <div class="sph-drag" title="Drag" {...dragHandlers}>
        ⠿
      </div>

      <Show when={!collapsed()}>
        {/* Top-level Setup / Sample / Use switch — always first. Sample + Use
            are gated until calibration is solved. */}
        <div class="sph-seg">
          <button
            data-active={props.mode === "setup" ? "" : undefined}
            onClick={() => props.setHostMode("setup")}
          >
            Setup
          </button>
          <button
            data-active={props.mode === "sample" ? "" : undefined}
            disabled={!props.calibrated}
            onClick={() => props.setHostMode("sample")}
          >
            Sample
          </button>
          <button
            data-active={props.mode === "use" ? "" : undefined}
            disabled={!props.calibrated}
            onClick={() => props.setHostMode("use")}
          >
            Use
          </button>
        </div>

        <div class="sph-sep" />

        <Show when={props.mode === "setup" && props.calDoc}>
          <SetupControls
            calDoc={props.calDoc!}
            calHandle={props.calHandle!}
            camera={props.camera}
            setMode={setMode}
            setGrid={setGrid}
          />
        </Show>

        {/* Projected surface brightness — affects Sample + Use. Raising it
            floods the "paper" with projector light so dark markers stand out
            (needed for walls detection in a dim room). Re-sample the background
            after changing this so the reference matches. */}
        <Show when={props.mode === "sample" || props.mode === "use"}>
          <label class="sph-surface-ctrl">
            <span>Surface</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={props.hostDoc.surfaceBrightness ?? 0}
              onInput={(e) => {
                const v = Number(e.currentTarget.value);
                props.hostHandle.change((d) => {
                  d.surfaceBrightness = v;
                });
              }}
            />
            <span class="sph-surface-val">{props.hostDoc.surfaceBrightness ?? 0}%</span>
          </label>
        </Show>

        <Show when={props.mode === "sample"}>
          <button data-variant="primary" onClick={sampleWithPanelHidden}>
            Sample background
          </button>
          <span
            class="sph-status"
            data-kind={props.hasBackground ? "accent" : "danger"}
          >
            {props.hasBackground ? "Background sampled ✓" : "Not sampled"}
          </span>
        </Show>

        <Show when={props.mode === "use"}>
          <UseControls
            hostHandle={props.hostHandle}
            hostDoc={props.hostDoc}
            repo={props.repo}
            camera={props.camera}
          />
        </Show>

        <div class="sph-sep" />
        <button onClick={props.requestFullscreen}>Fullscreen</button>
        <button title="Collapse" onClick={toggleCollapsed}>
          –
        </button>
      </Show>

      <Show when={collapsed()}>
        <button title="Expand" onClick={toggleCollapsed}>
          ☰
        </button>
      </Show>
    </div>
  );
}

function SetupControls(props: {
  calDoc: CalibrationDoc;
  calHandle: DocHandle<CalibrationDoc>;
  camera: Camera;
  setMode: (m: CalibrationMode) => void;
  setGrid: (g: 4 | 9) => void;
}) {
  const status = createMemo(() => calibrationStatus(props.calDoc));
  return (
    <>
      <div class="sph-seg">
        <For each={SETUP_MODES}>
          {(m) => (
            <button
              data-active={props.calDoc.mode === m.id ? "" : undefined}
              onClick={() => props.setMode(m.id)}
            >
              {m.label}
            </button>
          )}
        </For>
      </div>

      <div class="sph-sep" />

      <label>
        Grid
        <select
          value={String(props.calDoc.gridSize)}
          onChange={(e) => props.setGrid(Number(e.currentTarget.value) as 4 | 9)}
        >
          <option value="4">4 corners</option>
          <option value="9">9 points</option>
        </select>
      </label>

      <Show when={props.calDoc.mode === "calibrate"}>
        <button
          data-variant="primary"
          disabled={!props.camera.active()}
          onClick={() => solveSetup(props.calHandle, props.camera.getLiveSize())}
        >
          Solve
        </button>
        <button onClick={() => recaptureActive(props.calHandle)}>Recapture</button>
        <button onClick={() => clearCapture(props.calHandle)}>Clear</button>
      </Show>

      <button data-variant="primary" onClick={() => props.camera.toggle()}>
        {props.camera.active() ? "Hide camera" : "Show camera"}
      </button>

      <div class="sph-sep" />
      <button onClick={() => resetCalibration(props.calHandle)}>Reset</button>

      <span class="sph-status" data-kind={status().kind || undefined}>
        {status().text}
      </span>
    </>
  );
}

function UseControls(props: {
  hostHandle: DocHandle<SpatialHostDoc>;
  hostDoc: SpatialHostDoc;
  repo: Repo;
  camera: Camera;
}) {
  const docs = () => props.hostDoc.docs ?? [];
  return (
    <>
      <select
        disabled={!docs().length}
        value={String(props.hostDoc.activeIndex ?? 0)}
        onChange={(e) =>
          props.hostHandle.change((d) => {
            d.activeIndex = Number(e.currentTarget.value) || 0;
          })
        }
      >
        <Show when={docs().length} fallback={<option>(no docs yet)</option>}>
          <For each={docs()}>
            {(link, i) => (
              <option value={String(i())}>
                {link.name || link.type || `Doc ${i() + 1}`}
              </option>
            )}
          </For>
        </Show>
      </select>

      <CreateNew
        hostHandle={props.hostHandle}
        repo={props.repo}
      />

      <button data-variant="primary" onClick={() => props.camera.toggle()}>
        {props.camera.active() ? "Stop camera" : "Start camera"}
      </button>
    </>
  );
}
