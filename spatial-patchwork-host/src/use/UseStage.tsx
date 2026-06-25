import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { SpatialHostDoc, CalibrationDoc } from "../folder-datatype";
import {
  Emitter,
  SPATIAL_REGISTRY_KEY,
  COORDINATE_SYSTEM_SELECTOR,
  type CoordinateSystem,
  type SpatialRegistry,
  type SpatialRegistryHost,
} from "../spatial-source";
import { makeDefaultDocState } from "../apriltag-core.js";
import { LAYERS } from "../layers/index";
import {
  wallsDebug,
  initWallsDebugFromUrl,
  type WallsDebugStats,
} from "../layers/walls/debug";
import { createFrameLoop, type FrameLoop } from "../frame-loop";
import type { Recognizer } from "../layers/types";
import type { Camera } from "../camera";

const COORD_PROVIDER_ID = "spatial-coordinate-system-provider";

/**
 * Use phase: the aligned box (cameraViewBox sub-rect) filled by an embedded
 * patchwork-view of the active doc, wrapped by the host's coordinate-system
 * provider + one provider per recognition layer. The host's shared frame loop
 * drives every layer's recognizer; each publishes into a per-instance Emitter
 * that its provider relays. All per-instance (no globals).
 */
export function UseStage(props: {
  hostHandle: DocHandle<SpatialHostDoc>;
  hostDoc: SpatialHostDoc;
  calDoc: CalibrationDoc;
  repo: Repo;
  camera: Camera;
  /** Ephemeral empty-surface grayscale reference (or null). */
  getBackground: () => Uint8Array | null;
}) {
  let boxEl!: HTMLDivElement;
  let embedded!: HTMLElement; // patchwork-view
  let loop: FrameLoop | null = null;

  // Per-instance Emitters: one per layer + the coordinate-system one.
  const coordEmitter = new Emitter<CoordinateSystem>({ width: 0, height: 0 });
  const layerEmitters = LAYERS.map((l) => new Emitter(l.initialResult()));
  const recognizers: Recognizer[] = LAYERS.map((l, i) =>
    l.createRecognizer(layerEmitters[i]),
  );

  // One registry stamped on every provider wrapper: selector → Emitter.
  const registry: SpatialRegistry = new Map<string, Emitter<unknown>>();
  registry.set(COORDINATE_SYSTEM_SELECTOR, coordEmitter as Emitter<unknown>);
  LAYERS.forEach((l, i) =>
    registry.set(l.selector, layerEmitters[i] as Emitter<unknown>),
  );

  const box = () => props.calDoc.cameraViewBox;
  const activeUrl = () =>
    props.hostDoc.docs?.[props.hostDoc.activeIndex ?? 0]?.url;
  // 0–100 brightness → 0–255 gray for the projected "paper" underlay.
  const surfaceLevel = () =>
    Math.round((Math.max(0, Math.min(100, props.hostDoc.surfaceBrightness ?? 0)) / 100) * 255);

  // ---- Walls debug overlay (temporary; enabled via ?wallsDebug) ----------
  initWallsDebugFromUrl();
  let debugCanvas: HTMLCanvasElement | undefined;
  const [debugStats, setDebugStats] = createSignal<WallsDebugStats | null>(null);
  if (wallsDebug.enabled) {
    const off = wallsDebug.subscribe(() => {
      const snap = wallsDebug.snapshot;
      if (!snap || !debugCanvas) return;
      const { w, h, weak, strong, bin } = snap;
      if (debugCanvas.width !== w || debugCanvas.height !== h) {
        debugCanvas.width = w;
        debugCanvas.height = h;
      }
      const ctx = debugCanvas.getContext("2d");
      if (!ctx) return;
      const img = ctx.createImageData(w, h);
      const d = img.data;
      // weak-only = blue, strong = red, dilated-but-not-weak = faint green.
      for (let i = 0, p = 0; i < weak.length; i++, p += 4) {
        if (strong[i]) {
          d[p] = 255; d[p + 1] = 40; d[p + 2] = 40; d[p + 3] = 200;
        } else if (weak[i]) {
          d[p] = 40; d[p + 1] = 120; d[p + 2] = 255; d[p + 3] = 170;
        } else if (bin[i]) {
          d[p] = 40; d[p + 1] = 200; d[p + 2] = 40; d[p + 3] = 90;
        } else {
          d[p + 3] = 0;
        }
      }
      ctx.putImageData(img, 0, 0);
      setDebugStats({ ...snap.stats });
    });
    onCleanup(off);
  }

  // Keep the embedded view pointed at the active doc (remounts the inner tool).
  createEffect(() => {
    const url = activeUrl();
    if (embedded && url && embedded.getAttribute("doc-url") !== url) {
      embedded.setAttribute("doc-url", url);
    }
  });

  onMount(() => {
    // Stamp the same registry on every provider wrapper.
    boxEl
      .querySelectorAll<SpatialRegistryHost>(".sph-provider")
      .forEach((w) => {
        w[SPATIAL_REGISTRY_KEY] = registry;
      });

    // Off-screen camera video for the frame loop.
    const video = props.camera.video;
    video.style.position = "absolute";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    boxEl.parentElement?.appendChild(video);

    // Live box size → coordinate-system provider.
    const emitSize = () => {
      const r = boxEl.getBoundingClientRect();
      coordEmitter.set({ width: r.width, height: r.height });
    };
    const ro = new ResizeObserver(emitSize);
    ro.observe(boxEl);
    emitSize();

    // Shared frame loop drives every layer recognizer. getDocState is read
    // fresh each tick so re-calibration during Use takes effect live.
    loop = createFrameLoop({
      video,
      getDocState: () => makeDefaultDocState(props.calDoc) as never,
      getLiveSize: () => props.camera.getLiveSize(),
      recognizers,
      getBackground: () => props.getBackground(),
    });
    if (props.camera.active()) void loop.ensureAll();

    onCleanup(() => {
      ro.disconnect();
      loop?.stop(); // tears down every recognizer + worker
      loop = null;
      if (video.parentElement) video.parentElement.removeChild(video);
    });
  });

  // Spin up recognizers when the camera turns on.
  createEffect(() => {
    if (props.camera.active()) void loop?.ensureAll();
  });

  // Build the N+1 nested provider wrappers around the embedded view.
  const wrapped = () => {
    const ids = [
      ...LAYERS.map((l) => l.providerComponentId),
      COORD_PROVIDER_ID,
    ];
    const embeddedView = (
      <patchwork-view ref={embedded} attr:doc-url={activeUrl()} />
    ) as JSX.Element;
    return ids.reduceRight<JSX.Element>(
      (inner, componentId) => (
        <patchwork-view class="sph-provider" component={componentId}>
          {inner}
        </patchwork-view>
      ),
      embeddedView,
    );
  };

  return (
    <div class="sph-stage">
      <div
        ref={boxEl}
        class="sph-box"
        style={{
          left: `${box().x * 100}%`,
          top: `${box().y * 100}%`,
          width: `${box().w * 100}%`,
          height: `${box().h * 100}%`,
        }}
      >
        {/* Projected "paper": a light underlay behind the embedded tool so the
            camera sees a bright surface (high contrast vs. dark markers). Driven
            by doc.surfaceBrightness; 0 = black (transparent over the box bg). */}
        <div
          class="sph-surface"
          style={{
            background: `rgb(${surfaceLevel()}, ${surfaceLevel()}, ${surfaceLevel()})`,
          }}
        />
        {wrapped()}

        {/* Always-visible outline of the active area (above the embedded view,
            non-interactive) so the user can see which region is live. */}
        <div class="sph-box-outline">
          <div class="sph-corner tl" />
          <div class="sph-corner tr" />
          <div class="sph-corner bl" />
          <div class="sph-corner br" />
        </div>

        {/* Temporary walls-debug overlay: paints what the recognizer detects
            (strong=red, weak=blue, dilated-only=green) + brightness/noise stats.
            Enabled via ?wallsDebug. */}
        <Show when={wallsDebug.enabled}>
          <canvas
            ref={debugCanvas}
            class="sph-walls-debug"
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "pointer-events": "none",
              "image-rendering": "pixelated",
              "z-index": "3",
            }}
          />
          <Show when={debugStats()}>
            {(s) => (
              <pre class="sph-walls-debug-stats">
                {`gray μ${s().grayMean.toFixed(0)} [${s().grayMin}–${s().grayMax}]  bg μ${s().bgMean.toFixed(0)}
diff(bg-gray) μ${s().diffMean.toFixed(1)}  |diff| p50 ${s().absDiffP50} p95 ${s().absDiffP95} p99 ${s().absDiffP99}
temporal-noise μ${s().temporalNoiseMean.toFixed(2)}/px
weak ${s().weakPx}  strong ${s().strongPx}  bin ${s().binPx}
components ${s().components}  strong-gated ${s().strongGated}  published ${s().published}`}
              </pre>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}
