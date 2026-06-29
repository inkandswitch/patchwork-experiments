/**
 * Built-in calibration plugin (the default `physical:calibration`).
 *
 * Wraps the existing setup UI (`SetupPhase` stage + the calibrate/test controls
 * that used to live in `ControlPanel`) into the plugin contract: `mount(element,
 * ctx)` renders it (in-process) using the live camera + the current system's
 * calibration doc handle from `ctx`. The surface-brightness slider and
 * "Sample background" button now live HERE (they're calibration concerns).
 *
 * `calDoc.mode` (align/calibrate/test) is the calibration UI's INTERNAL sub-mode
 * and stays here — distinct from the frame's removed setup/sample/use hostMode.
 */

import { render } from "solid-js/web";
import { For, Show, createMemo } from "solid-js";
import { RepoContext } from "@automerge/automerge-repo-solid-primitives";
import type { CalibrationMode } from "../folder-datatype";
import {
  calibrationStatus,
  recaptureActive,
  clearCapture,
  resetCalibration,
  solveSetup,
} from "../setup/calibrate-logic";
import { SetupPhase } from "../setup/SetupPhase";
import type {
  CalibrationContext,
  PhysicalCalibration,
} from "../physical-calibration";

const SETUP_MODES: { id: CalibrationMode; label: string }[] = [
  { id: "align", label: "Align" },
  { id: "calibrate", label: "Calibrate" },
  { id: "test", label: "Test" },
];

function surfaceLevel(pct: number): number {
  return Math.round((Math.max(0, Math.min(100, pct)) / 100) * 255);
}

function BuiltinCalibrationUI(props: { ctx: CalibrationContext }) {
  const ctx = props.ctx;
  const calDoc = () => ctx.calibrationDoc();
  const status = createMemo(() => {
    const d = calDoc();
    return d ? calibrationStatus(d) : { text: "", kind: "" as const };
  });

  const setMode = (m: CalibrationMode) =>
    ctx.calibrationHandle.change((d) => {
      d.mode = m;
    });
  const setGrid = (g: 4 | 9) =>
    ctx.calibrationHandle.change((d) => {
      d.gridSize = g;
      d.homographyCamToBoard = null;
      d.homographyBoardToCam = null;
      d.cameraCalibrationSize = null;
    });

  // Surface brightness lives on the calibration doc here (so the "paper" the
  // camera sees during calibration is controllable + matches the sampled bg).
  const surface = () => calDoc()?.surfaceBrightness ?? 0;

  return (
    <div class="sph-cal-root">
      {/* The calibration stage (align box / target dots / test markers + camera
          panel). Projected "paper" underlay so the camera sees a lit surface. */}
      <div
        class="sph-cal-surface"
        style={{
          background: `rgb(${surfaceLevel(surface())}, ${surfaceLevel(surface())}, ${surfaceLevel(surface())})`,
        }}
      />
      <Show when={calDoc()}>
        <SetupPhase
          calHandle={ctx.calibrationHandle}
          calDoc={calDoc()!}
          camera={ctx.camera}
        />
      </Show>

      {/* Calibration control bar. */}
      <div class="sph-cal-bar">
        <div class="sph-seg">
          <For each={SETUP_MODES}>
            {(m) => (
              <button
                data-active={calDoc()?.mode === m.id ? "" : undefined}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            )}
          </For>
        </div>

        <label>
          Grid
          <select
            value={String(calDoc()?.gridSize ?? 4)}
            onChange={(e) => setGrid(Number(e.currentTarget.value) as 4 | 9)}
          >
            <option value="4">4 corners</option>
            <option value="9">9 points</option>
          </select>
        </label>

        <Show when={calDoc()?.mode === "calibrate"}>
          <button
            data-variant="primary"
            disabled={!ctx.camera.active()}
            onClick={() =>
              solveSetup(ctx.calibrationHandle, ctx.camera.getLiveSize())
            }
          >
            Solve
          </button>
          <button onClick={() => recaptureActive(ctx.calibrationHandle)}>
            Recapture
          </button>
          <button onClick={() => clearCapture(ctx.calibrationHandle)}>Clear</button>
        </Show>

        <button data-variant="primary" onClick={() => ctx.camera.toggle()}>
          {ctx.camera.active() ? "Hide camera" : "Show camera"}
        </button>

        {/* Surface brightness — affects the calibration view + the bg sample. */}
        <label class="sph-surface-ctrl">
          <span>Surface</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={surface()}
            onInput={(e) => {
              const v = Number(e.currentTarget.value);
              ctx.calibrationHandle.change((d) => {
                d.surfaceBrightness = v;
              });
            }}
          />
          <span class="sph-surface-val">{surface()}%</span>
        </label>

        <button data-variant="primary" onClick={() => ctx.sampleBackground()}>
          Sample background
        </button>
        <span class="sph-status" data-kind={ctx.hasBackground() ? "accent" : "danger"}>
          {ctx.hasBackground() ? "Background sampled ✓" : "Not sampled"}
        </span>

        <div class="sph-sep" />
        <button onClick={() => resetCalibration(ctx.calibrationHandle)}>Reset</button>
        <span class="sph-status" data-kind={status().kind || undefined}>
          {status().text}
        </span>

        <div class="sph-sep" />
        <button data-variant="primary" onClick={() => ctx.close()}>
          Done
        </button>
      </div>
    </div>
  );
}

export const BuiltinCalibration: PhysicalCalibration = {
  id: "physical-frame:builtin-calibration",
  name: "Built-in calibration",
  mount(element, ctx) {
    // Render the Solid UI into the element; provide the repo context (the camera
    // panel / setup UI use repo-aware primitives). Return the disposer.
    return render(
      () => (
        <RepoContext.Provider value={ctx.repo}>
          <BuiltinCalibrationUI ctx={ctx} />
        </RepoContext.Provider>
      ),
      element,
    );
  },
};
