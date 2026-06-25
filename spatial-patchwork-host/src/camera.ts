/**
 * Shared reactive camera controller. One instance is created per host and used
 * by the control panel (Show/Hide camera), the Setup camera panel (calibration
 * capture), and the Use detector — so there is a single getUserMedia stream.
 *
 * A single hidden <video> element decodes the stream; consumers read frames off
 * it (the Setup panel also shows it, the Use detector samples it off-screen).
 */

import { createSignal } from "solid-js";
import { grabGray } from "./grab-gray.js";

export type CameraSize = { w: number; h: number };

export function createCamera() {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  // Scratch canvas for one-off grabs (background sampling).
  const grabCanvas = document.createElement("canvas");

  const [active, setActive] = createSignal(false);
  const [liveSize, setLiveSize] = createSignal<CameraSize | null>(null);
  const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = createSignal<string | undefined>(undefined);
  const [error, setError] = createSignal<string | null>(null);

  let stream: MediaStream | null = null;

  const updateSize = () => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    setLiveSize(w && h ? { w, h } : null);
  };
  video.addEventListener("loadedmetadata", updateSize);
  video.addEventListener("resize", updateSize);

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "videoinput"));
    } catch {
      /* enumerateDevices can fail before permission; ignore */
    }
  }

  async function lockControls(track: MediaStreamTrack) {
    const getCaps = (track as MediaStreamTrack & {
      getCapabilities?: () => MediaTrackCapabilities;
    }).getCapabilities;
    if (!getCaps || !track.applyConstraints) return;
    let caps: MediaTrackCapabilities = {};
    try {
      caps = getCaps.call(track) || {};
    } catch {
      return;
    }
    const settings = track.getSettings ? track.getSettings() : {};
    const advanced: MediaTrackConstraintSet[] = [];
    const focusModes = (caps as { focusMode?: string[] }).focusMode;
    if (Array.isArray(focusModes)) {
      if (focusModes.includes("manual")) advanced.push({ focusMode: "manual" } as never);
      else if (focusModes.includes("none")) advanced.push({ focusMode: "none" } as never);
    }
    const zoomCap = (caps as { zoom?: { min?: number; max?: number } }).zoom;
    if (zoomCap && typeof zoomCap === "object") {
      const min = Number.isFinite(zoomCap.min) ? (zoomCap.min as number) : 1;
      const max = Number.isFinite(zoomCap.max) ? (zoomCap.max as number) : min;
      const cur = Number.isFinite((settings as { zoom?: number }).zoom)
        ? ((settings as { zoom?: number }).zoom as number)
        : min;
      advanced.push({ zoom: Math.max(min, Math.min(cur, max)) } as never);
    }
    if (!advanced.length) return;
    try {
      await track.applyConstraints({ advanced });
    } catch {
      /* device rejected a lock; leave as-is */
    }
  }

  function stopStream() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
  }

  async function start(id?: string) {
    setError(null);
    try {
      stopStream();
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: 4096 },
        height: { ideal: 2160 },
      };
      if (id) videoConstraints.deviceId = { exact: id };
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      video.srcObject = stream;
      setActive(true);
      await refreshDevices();
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings ? track.getSettings() : {};
      if (settings.deviceId) setDeviceId(settings.deviceId);
      await lockControls(track);
      updateSize();
    } catch (err) {
      stopStream();
      setActive(false);
      setError(String((err as Error)?.message ?? err));
    }
  }

  function stop() {
    stopStream();
    setActive(false);
    setLiveSize(null);
  }

  function toggle() {
    if (active()) stop();
    else void start(deviceId());
  }

  function dispose() {
    stopStream();
  }

  void refreshDevices();

  return {
    video,
    active,
    liveSize,
    devices,
    deviceId,
    setDeviceId,
    error,
    start,
    stop,
    toggle,
    refreshDevices,
    dispose,
    getLiveSize: () => liveSize(),
    /**
     * Grab the current frame as a downscaled grayscale buffer (detector dims),
     * for background sampling. Returns null if no frame is available.
     */
    grabGray: (): Uint8Array | null =>
      grabGray(video, grabCanvas, liveSize())?.gray ?? null,
  };
}

export type Camera = ReturnType<typeof createCamera>;
