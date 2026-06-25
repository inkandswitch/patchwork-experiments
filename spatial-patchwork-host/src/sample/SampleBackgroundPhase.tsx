import { onMount } from "solid-js";
import type { CalibrationDoc, SpatialHostDoc } from "../folder-datatype";
import type { Camera } from "../camera";

/**
 * Sample-background phase. The aligned box projects the NEUTRAL Use view — the
 * projected "paper" surface (doc.surfaceBrightness) with the white border and
 * nothing else (no embedded tool) — so the camera samples the empty surface
 * under EXACTLY the lighting + surface brightness present during Use. (If the
 * sample surface and the Use surface differed, the background reference wouldn't
 * match and the difference math would break.) The actual "Sample background"
 * action + status live in the control panel (no camera preview here).
 * Auto-starts the camera (off-screen) so a grab is available when sampling.
 */
export function SampleBackgroundPhase(props: {
  calDoc: CalibrationDoc;
  hostDoc: SpatialHostDoc;
  camera: Camera;
}) {
  const box = () => props.calDoc.cameraViewBox;
  const surfaceLevel = () =>
    Math.round((Math.max(0, Math.min(100, props.hostDoc.surfaceBrightness ?? 0)) / 100) * 255);

  onMount(() => {
    // Ensure the camera is running so a frame can be grabbed when the operator
    // samples. The shared <video> decodes from its srcObject without needing to
    // be in the DOM (grabGray reads it via drawImage), and it's never shown here.
    if (!props.camera.active()) {
      void props.camera.start(props.camera.deviceId());
    }
  });

  return (
    <div class="sph-stage">
      <div
        class="sph-box"
        style={{
          left: `${box().x * 100}%`,
          top: `${box().y * 100}%`,
          width: `${box().w * 100}%`,
          height: `${box().h * 100}%`,
        }}
      >
        {/* Neutral projection: the lit "paper" surface + white border, matching
            what Use will project. Nothing else. */}
        <div
          class="sph-surface"
          style={{
            background: `rgb(${surfaceLevel()}, ${surfaceLevel()}, ${surfaceLevel()})`,
          }}
        />
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
