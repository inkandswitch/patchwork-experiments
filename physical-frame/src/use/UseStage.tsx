import {
  createEffect,
  createSignal,
  For,
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
import { makeDefaultDocState } from "../calibration-core.js";
import { loadPhysicalLayerDescriptors } from "../registry";
import type { PhysicalLayer, Reader } from "../physical-layer";
import { createFrameLoop, type FrameLoop } from "../frame-loop";
import type { Camera } from "../camera";
import {
  DEFAULT_CONTROLS,
  createControlResolver,
  reservedIds,
  emptyControlState,
  type ControlState,
} from "../controls";

const COORD_PROVIDER_ID = "physical-coordinate-system-provider";
/** The apriltags layer selector the frame interposes on for controls. */
const APRILTAGS_SELECTOR = "physical:apriltags";

/** Minimal shape the frame reads from the apriltags payload (graded). */
type ApriltagsValue = { calibrated?: boolean; tags?: { id: number }[] };

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

  // ---- Physical controls (reserved AprilTags → frame UI) -------------------
  // Phase 2: a single hardcoded control map. Phase 3 moves it into per-system
  // frame config. Controls read tag PRESENCE (ids), so they work pre-calibration.
  const controls = () => DEFAULT_CONTROLS;
  const controlResolver = createControlResolver(controls);
  const [controlState, setControlState] = createSignal<ControlState>(
    emptyControlState(),
  );

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

  // A generic (demand-driven) layer: reader writes straight to the registered
  // Emitter; ensure/stop are driven by tool-subscription activity on it.
  function setupGenericLayer(layer: PhysicalLayer) {
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

  // The apriltags layer is special: the FRAME itself consumes it (for physical
  // controls), so it runs ALWAYS (not demand-driven). The reader writes to a RAW
  // Emitter; the frame taps raw to (a) resolve control state from reserved-tag
  // presence and (b) republish a reserved-id-STRIPPED payload into the PUBLIC
  // Emitter that tools subscribe to. Tools never see control tags.
  function setupApriltagsLayer(layer: PhysicalLayer) {
    const raw = new Emitter<unknown>(layer.initialResult());
    const pub = new Emitter<unknown>(layer.initialResult());
    const reader = layer.createReader(raw);
    const rt: LayerRuntime = {
      layer,
      emitter: raw,
      reader,
      active: true, // always on — the frame depends on it for controls
      ensuring: false,
      stopTimer: null,
    };

    raw.subscribe((value) => {
      const v = (value ?? {}) as ApriltagsValue;
      const allTags = Array.isArray(v.tags) ? v.tags : [];
      const reserved = reservedIds(controls());

      // (a) controls: which reserved ids are present → resolve action state.
      const presentReserved = new Set<string>();
      for (const t of allTags) {
        const idStr = String(t.id);
        if (reserved.has(idStr)) presentReserved.add(idStr);
      }
      setControlState(controlResolver.resolve(presentReserved));

      // (b) public payload: same shape, reserved control tags removed.
      pub.set({
        ...(v as object),
        tags: allTags.filter((t) => !reserved.has(String(t.id))),
      });
    });

    // Register the PUBLIC emitter under the selector (what tools relay from).
    registry.set(layer.selector, pub);
    runtimes.push(rt);
    // Start the reader immediately (frame is a permanent consumer).
    void reader
      .ensure()
      .catch((err) =>
        console.error(`[physical-frame] apriltags ensure failed:`, err),
      );
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
          if (layer.selector === APRILTAGS_SELECTOR) {
            setupApriltagsLayer(layer);
          } else {
            setupGenericLayer(layer);
          }
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

  // Fullscreen control: a tag in the camera feed is NOT a user gesture, so the
  // Fullscreen API's requestFullscreen() is blocked by the browser. Instead we
  // "maximize" the stage with fixed positioning over the whole viewport (a CSS
  // class) — no permission needed, works from a tag, and for a projector that's
  // the actual goal. (We still TRY real fullscreen best-effort; harmless if the
  // browser ignores it, e.g. when a real user gesture happens to be active.)
  createEffect(() => {
    const want = controlState().fullscreen;
    const stage = boxEl?.closest<HTMLElement>(".sph-stage");
    stage?.classList.toggle("sph-maximized", want);
    if (want && !document.fullscreenElement) {
      void stage?.requestFullscreen?.().catch(() => {});
    } else if (!want && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
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

        {/* Left sidebar — shown while the left-sidebar control is active. The
            main area insets to make room (the embedded view never remounts). */}
        <Show when={controlState()["left-sidebar"]}>
          <div class="sph-left-sidebar">
            <div class="sph-sidebar-title">Documents</div>
            <div class="sph-sidebar-hint">
              (Phase 2 placeholder — doc picker comes later)
            </div>
          </div>
        </Show>

        {/* Main area holds the embedded document tool. Insets from the left when
            the sidebar is open. Re-render wrappers when the layer set changes. */}
        <div class="sph-main" data-sidebar={controlState()["left-sidebar"] ? "" : undefined}>
          <For each={[providerIds().join("|")]}>{() => wrapped()}</For>
        </div>

        {/* Setup mode — shown while the setup control is active. Phase 4 mounts
            the real calibration tool here; Phase 2 is a placeholder proving the
            toggle drives it. */}
        <Show when={controlState().setup}>
          <div class="sph-setup-overlay">
            <div class="sph-setup-title">Setup mode</div>
            <div class="sph-sidebar-hint">
              (Phase 4 mounts the calibration tool here)
            </div>
          </div>
        </Show>

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
