import {
  createEffect,
  onCleanup,
  onMount,
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
        {wrapped()}

        {/* Always-visible outline of the active area (above the embedded view,
            non-interactive) so the user can see which region is live. */}
        <div class="sph-box-outline">
          <div class="sph-corner tl" />
          <div class="sph-corner tr" />
          <div class="sph-corner bl" />
          <div class="sph-corner br" />
        </div>
      </div>
    </div>
  );
}
