import { onMount, onCleanup } from "solid-js";
import type { CalibrationDoc } from "../folder-datatype";
import type { Camera } from "../camera";

/**
 * Sample-background phase: shows the live camera feed filling the aligned box so
 * you can confirm the surface is empty, then sample it. The sampled grayscale
 * reference (held by App) lets the walls layer detect only what's darker than
 * the empty surface. Auto-starts the camera on entry.
 */
export function SampleBackgroundPhase(props: {
  calDoc: CalibrationDoc;
  camera: Camera;
  hasBackground: boolean;
  onSample: () => void;
}) {
  let boxEl!: HTMLDivElement;

  const box = () => props.calDoc.cameraViewBox;

  onMount(() => {
    // Auto-start the camera; mount its live <video> filling the box.
    if (!props.camera.active()) void props.camera.start(props.camera.deviceId());
    const video = props.camera.video;
    video.removeAttribute("style"); // clear any off-screen styling from Use
    video.classList.add("sph-sample-video");
    boxEl.appendChild(video);

    onCleanup(() => {
      video.classList.remove("sph-sample-video");
      if (video.parentElement === boxEl) boxEl.removeChild(video);
    });
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
