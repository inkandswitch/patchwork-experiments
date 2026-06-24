import { createEffect, onCleanup, onMount } from "solid-js";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { SpatialHostDoc, CalibrationDoc } from "../folder-datatype";
import {
  SPATIAL_SOURCE_KEY,
  type SpatialSource,
  type SpatialSourceHost,
} from "../spatial-source";
import { makeDefaultDocState } from "../apriltag-core.js";
import { createDetector, type Detector } from "../detection";
import type { Camera } from "../camera";

/**
 * Use phase: the aligned box (cameraViewBox sub-rect) filled by an embedded
 * patchwork-view of the active doc, wrapped by the two provider components. A
 * camera + detector feed the per-instance SpatialSource; a ResizeObserver feeds
 * the coordinate-system emitter.
 */
export function UseStage(props: {
  hostHandle: DocHandle<SpatialHostDoc>;
  hostDoc: SpatialHostDoc;
  calDoc: CalibrationDoc;
  repo: Repo;
  source: SpatialSource;
  camera: Camera;
}) {
  let boxEl!: HTMLDivElement;
  let embedded!: HTMLElement; // patchwork-view
  let detector: Detector | null = null;

  const box = () => props.calDoc.cameraViewBox;

  const activeUrl = () => {
    const docs = props.hostDoc.docs ?? [];
    return docs[props.hostDoc.activeIndex ?? 0]?.url;
  };

  // Keep the embedded view pointed at the active doc (remounts the inner tool).
  createEffect(() => {
    const url = activeUrl();
    if (embedded && url && embedded.getAttribute("doc-url") !== url) {
      embedded.setAttribute("doc-url", url);
    }
  });

  onMount(() => {
    // Stamp the per-instance source on both provider wrappers.
    const wrappers = boxEl.querySelectorAll<SpatialSourceHost>(".sph-provider");
    wrappers.forEach((w) => {
      w[SPATIAL_SOURCE_KEY] = props.source;
    });

    // Off-screen camera video for the detector.
    const video = props.camera.video;
    video.style.position = "absolute";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    boxEl.parentElement?.appendChild(video);

    // Live box size -> coordinate-system provider.
    const emitSize = () => {
      const r = boxEl.getBoundingClientRect();
      props.source.coordinateSystem.set({ width: r.width, height: r.height });
    };
    const ro = new ResizeObserver(emitSize);
    ro.observe(boxEl);
    emitSize();

    // Detector pushes tags into source.apriltags. It reads the latest
    // calibration doc each pass (for the homography).
    detector = createDetector({
      video,
      getDocState: () => makeDefaultDocState(props.calDoc) as never,
      getLiveSize: () => props.camera.getLiveSize(),
      tagsEmitter: props.source.apriltags,
    });
    if (props.camera.active()) void detector.ensure();

    onCleanup(() => {
      ro.disconnect();
      detector?.stop();
      detector = null;
      if (video.parentElement) video.parentElement.removeChild(video);
    });
  });

  // Ensure the detector spins up when the camera turns on.
  createEffect(() => {
    if (props.camera.active()) void detector?.ensure();
  });

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
        {/* Provider wrappers (independent selectors → order irrelevant). */}
        <patchwork-view class="sph-provider" component="spatial-apriltags-provider">
          <patchwork-view class="sph-provider" component="spatial-coordinate-system-provider">
            {/* Embedded active doc — no tool-id; registry mounts default tool. */}
            <patchwork-view ref={embedded} attr:doc-url={activeUrl()} />
          </patchwork-view>
        </patchwork-view>

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
