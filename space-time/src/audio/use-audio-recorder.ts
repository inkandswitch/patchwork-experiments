import { useCallback, useRef, useState } from 'react';

export type RecordingPreview = {
  x: number;
  y: number;
  duration: number;
};

export type AudioRecordingResult = {
  blob: Blob;
  duration: number;
  mimeType: string;
};

function pickRecorderMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  return 'audio/webm';
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
};

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [preview, setPreview] = useState<RecordingPreview | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('audio/webm');
  const startTimeRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const resolveStopRef = useRef<((result: AudioRecordingResult | null) => void) | null>(null);
  const previewRef = useRef<RecordingPreview | null>(null);

  const cleanupStream = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  const start = useCallback(async (x: number, y: number): Promise<boolean> => {
    if (mediaRecorderRef.current) return false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      streamRef.current = stream;

      const mimeType = pickRecorderMimeType();
      mimeTypeRef.current = mimeType;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        cleanupStream();
        setIsRecording(false);
        setPreview(null);
        previewRef.current = null;
        resolveStopRef.current?.({ blob, duration, mimeType: mimeTypeRef.current });
        resolveStopRef.current = null;
      };

      mediaRecorderRef.current = recorder;
      startTimeRef.current = Date.now();
      const initialPreview = { x, y, duration: 0 };
      previewRef.current = initialPreview;
      setPreview(initialPreview);
      setIsRecording(true);
      recorder.start(100);

      timerRef.current = window.setInterval(() => {
        const next = {
          x,
          y,
          duration: (Date.now() - startTimeRef.current) / 1000,
        };
        previewRef.current = next;
        setPreview(next);
      }, 50);

      return true;
    } catch {
      cleanupStream();
      setIsRecording(false);
      setPreview(null);
      previewRef.current = null;
      return false;
    }
  }, [cleanupStream]);

  const stop = useCallback((): Promise<AudioRecordingResult | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      cleanupStream();
      setIsRecording(false);
      setPreview(null);
      previewRef.current = null;
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      resolveStopRef.current = resolve;
      recorder.stop();
    });
  }, [cleanupStream]);

  return {
    isRecording,
    preview,
    start,
    stop,
  };
}
