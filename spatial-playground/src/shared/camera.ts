export async function listVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'videoinput');
}

export function buildVideoConstraints(
  deviceId?: string | null,
  resolution: { width: number; height: number } = { width: 1920, height: 1080 },
): MediaTrackConstraints {
  if (deviceId) {
    return {
      deviceId: { exact: deviceId },
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
    };
  }
  return {
    width: { ideal: resolution.width },
    height: { ideal: resolution.height },
  };
}

export async function waitForVideoReady(target: HTMLVideoElement) {
  if (target.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return;
  }
  await new Promise<void>((resolve) => {
    target.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
