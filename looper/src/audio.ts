import { INPUT_DEVICE_STORAGE_KEY } from './constants';
import type { InputDeviceInfo } from './types';

export const micProcessingConstraints = {
  autoGainControl: false,
  echoCancellation: false,
} as const;

export type MicConnection = {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
};

export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

/** Temporary stream so enumerateDevices gets non-empty labels for this origin. */
export async function primeMicrophonePermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const t of stream.getTracks()) {
    t.stop();
  }
}

export function readStoredInputDeviceId(): string | null {
  try {
    return localStorage.getItem(INPUT_DEVICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredInputDeviceId(deviceId: string): void {
  try {
    localStorage.setItem(INPUT_DEVICE_STORAGE_KEY, deviceId);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearStoredInputDeviceId(): void {
  try {
    localStorage.removeItem(INPUT_DEVICE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function openMicrophone(
  context: AudioContext,
  deviceId: string,
  previous: MicConnection | null,
): Promise<{ connection: MicConnection; info: InputDeviceInfo }> {
  if (previous) {
    previous.source.disconnect();
    for (const t of previous.stream.getTracks()) {
      t.stop();
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      ...micProcessingConstraints,
    },
  });

  const source = context.createMediaStreamSource(stream);
  await context.resume();

  return {
    connection: { stream, source },
    info: {
      id: deviceId,
      numChannels: source.channelCount,
      useMidiPedal: true,
    },
  };
}

export function deviceLabel(d: MediaDeviceInfo, index: number): string {
  if (d.label?.trim()) {
    return d.label.trim();
  }
  return `Microphone ${index + 1}`;
}
