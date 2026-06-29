/**
 * Swappable calibration-plugin contract.
 *
 * Calibration needs the LIVE camera (MediaStream / <video> / grab fns), which is
 * NOT serializable — so it can't be a `patchwork:component` relay or a normal
 * harness-mounted tool. Instead it mirrors the SENSOR pattern: the frame
 * discovers calibration plugins in the registry bucket `physical:calibration`,
 * `load()`s them, and calls `mount(element, ctx)` IN-PROCESS, handing over the
 * live camera object BY REFERENCE (just like `createReader` gets a live Emitter).
 *
 * Multiple plugins may register; the frame lists them via `.all()` and the user
 * picks (choice persisted in localStorage, per-frame-instance). A built-in
 * default is always registered so there is at least one.
 */

import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { CalibrationDoc } from "./folder-datatype";
import type { Camera } from "./camera";

/** Registry bucket calibration plugins register into. */
export const PHYSICAL_CALIBRATION_PLUGIN_TYPE = "physical:calibration";

/** Live context handed to a calibration plugin by reference (NOT serialized). */
export interface CalibrationContext {
  /** The frame's single shared camera (live object — start/stop/grab/video/relock). */
  camera: Camera;
  /** The repo (for repo-aware UI primitives inside the plugin). */
  repo: Repo;
  /** The current system's calibration doc handle — the plugin WRITES homography here. */
  calibrationHandle: DocHandle<CalibrationDoc>;
  /** Reactive accessor for the current calibration doc value (read). */
  calibrationDoc: () => CalibrationDoc | undefined;
  /**
   * Sample the empty-surface background (a frame-owned action; the plugin's UI
   * triggers it, e.g. a "Sample background" button). No-op if camera not ready.
   */
  sampleBackground: () => void;
  /** Whether a background has been sampled (for status display). */
  hasBackground: () => boolean;
  /** Exit setup (close the calibration plugin, return to the document). */
  close: () => void;
}

export interface PhysicalCalibration {
  /** Stable id (used to persist the user's plugin choice). */
  readonly id: string;
  readonly name: string;
  /**
   * Mount the calibration UI into `element` using the live context. Returns a
   * cleanup fn. Called in-process by the frame while setup is active.
   */
  mount(element: HTMLElement, ctx: CalibrationContext): () => void;
}
