import { onMount } from "solid-js";
import type { CalibrationDoc } from "../folder-datatype";
import type { Camera } from "../camera";

/**
 * Sample-background phase. The aligned box projects the NEUTRAL Use view — a
 * black fill with the white border, and nothing else (no embedded tool) — so
 * the camera samples the empty surface under exactly the lighting
 * present during Use. The actual "Sample background" action + status live in the
 * control panel (no camera preview here). Auto-starts the camera (off-screen) so
 * a grab is available when the operator samples.
 */
export function SampleBackgroundPhase(props: {
  calDoc: CalibrationDoc;
  camera: Camera;
}) {
  const box = () => props.calDoc.cameraViewBox;

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
        {/* Neutral projection: black box + white border. Nothing else. */}
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
