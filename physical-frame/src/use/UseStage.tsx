import {
  createEffect,
  createSignal,
  For,
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
import { loadPhysicalLayerDescriptors } from "../registry";
import type { PhysicalLayer, Reader } from "../physical-layer";
import { createFrameLoop, type FrameLoop } from "../frame-loop";
import type { Camera } from "../camera";

const COORD_PROVIDER_ID = "physical-coordinate-system-provider";

/** How long after the last unsubscribe to keep a reader warm before stopping. */
const READER_IDLE_STOP_MS = 5000;

/** Per-layer runtime state held by the frame instance. */
interface LayerRuntime {
  layer: PhysicalLayer;
  emitter: Emitter<unknown>;
  reader: Reader;
  active: boolean; // in the loop's active set (subscribed)
  ensuring: boolean; // ensure() in flight
  stopTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Use phase: the aligned box filled by an embedded patchwork-view of the active
 * doc, wrapped by the frame's coordinate-system provider + one provider per
 * DISCOVERED physical layer. The frame's camera loop drives only the readers
 * whose selector currently has a subscriber (demand-driven); each publishes into
 * a per-instance Emitter that its provider relays. All per-instance (no globals).
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

  // Coordinate-system Emitter is always-on (frame-owned).
  const coordEmitter = new Emitter<CoordinateSystem>({ width: 0, height: 0 });

  // Per-instance registry stamped on provider wrappers: selector → Emitter.
  const registry: SpatialRegistry = new Map<string, Emitter<unknown>>();
  registry.set(COORDINATE_SYSTEM_SELECTOR, coordEmitter as Emitter<unknown>);

  // Discovered layers + their runtime; populated async at mount.
  const runtimes: LayerRuntime[] = [];
  const [layers, setLayers] = createSignal<PhysicalLayer[]>([]);

  const box = () => props.calDoc.cameraViewBox;
  const activeUrl = () =>
    props.hostDoc.docs?.[props.hostDoc.activeIndex ?? 0]?.url;
  // 0–100 brightness → 0–255 gray for the projected "paper" underlay.
  const surfaceLevel = () =>
    Math.round(
      (Math.max(0, Math.min(100, props.hostDoc.surfaceBrightness ?? 0)) / 100) *
        255,
    );

  const activeReaders = (): Reader[] =>
    runtimes.filter((rt) => rt.active).map((rt) => rt.reader);

  // ---- Demand-driven lifecycle (driven by Emitter activity hooks) ----------
  function onLayerActive(rt: LayerRuntime) {
    if (rt.stopTimer) {
      clearTimeout(rt.stopTimer); // re-subscribed within the warm window
      rt.stopTimer = null;
    }
    if (rt.active || rt.ensuring) return;
    rt.ensuring = true;
    void rt.reader
      .ensure()
      .catch((err) =>
        console.error(`[physical-frame] reader ensure failed (${rt.layer.selector}):`, err),
      )
      .finally(() => {
        rt.ensuring = false;
        rt.active = true; // loop will process it once status === "ready"
      });
  }

  function onLayerIdle(rt: LayerRuntime) {
    if (rt.stopTimer) return;
    rt.stopTimer = setTimeout(() => {
      rt.stopTimer = null;
      // Only stop if still idle (no subscriber re-appeared).
      if (rt.emitter.subscriberCount === 0) {
        rt.active = false;
        try {
          rt.reader.stop();
        } catch (err) {
          console.error(`[physical-frame] reader stop failed (${rt.layer.selector}):`, err);
        }
      }
    }, READER_IDLE_STOP_MS);
  }

  // Keep the embedded view pointed at the active doc (remounts the inner tool).
  createEffect(() => {
    const url = activeUrl();
    if (embedded && url && embedded.getAttribute("doc-url") !== url) {
      embedded.setAttribute("doc-url", url);
    }
  });

  onMount(() => {
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

    // Camera loop processes only the active (subscribed) readers each tick.
    loop = createFrameLoop({
      video,
      getDocState: () => makeDefaultDocState(props.calDoc) as never,
      getLiveSize: () => props.camera.getLiveSize(),
      getActiveReaders: activeReaders,
      getBackground: () => props.getBackground(),
    });
    if (props.camera.active()) loop.start();

    // Discover physical layers, build their runtime, and wire demand-driven
    // ensure/stop via each Emitter's activity hooks.
    void loadPhysicalLayerDescriptors()
      .then((descriptors) => {
        for (const layer of descriptors) {
          const emitter = new Emitter<unknown>(layer.initialResult());
          const reader = layer.createReader(emitter);
          const rt: LayerRuntime = {
            layer,
            emitter,
            reader,
            active: false,
            ensuring: false,
            stopTimer: null,
          };
          emitter.setActivityHooks({
            onActive: () => onLayerActive(rt),
            onIdle: () => onLayerIdle(rt),
          });
          registry.set(layer.selector, emitter);
          runtimes.push(rt);
        }
        setLayers(descriptors);
        // Re-stamp the registry on any provider wrappers that just rendered.
        stampRegistry();
      })
      .catch((err) =>
        console.error("[physical-frame] failed to load physical layers:", err),
      );

    // Stamp the registry on the coordinate-system wrapper (rendered immediately).
    stampRegistry();

    onCleanup(() => {
      ro.disconnect();
      loop?.stop();
      loop = null;
      for (const rt of runtimes) {
        if (rt.stopTimer) clearTimeout(rt.stopTimer);
        try {
          rt.reader.stop();
        } catch {
          /* ignore */
        }
      }
      if (video.parentElement) video.parentElement.removeChild(video);
    });
  });

  function stampRegistry() {
    boxEl
      ?.querySelectorAll<SpatialRegistryHost>(".sph-provider")
      .forEach((w) => {
        w[SPATIAL_REGISTRY_KEY] = registry;
      });
  }

  // Start the loop when the camera turns on.
  createEffect(() => {
    if (props.camera.active()) loop?.start();
  });

  // Re-stamp whenever the set of layer wrappers changes (descriptors loaded).
  createEffect(() => {
    layers();
    queueMicrotask(stampRegistry);
  });

  // The provider component ids to wrap with: coordinate-system + one per layer.
  const providerIds = () => [
    COORD_PROVIDER_ID,
    ...layers().map((l) => l.providerComponentId),
  ];

  // Build the nested provider wrappers around the embedded view.
  const wrapped = () => {
    const ids = providerIds();
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
        {/* Re-render wrappers when the discovered layer set changes. */}
        <For each={[providerIds().join("|")]}>{() => wrapped()}</For>

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
