import type { Point } from '../types.ts';

// @ts-expect-error — js-aruco is a CommonJS module without type declarations
import { AR } from 'js-aruco';

export type DetectedMarker = {
  id: number;
  corners: Point[];
};

export type MarkerDetector = {
  detect(video: HTMLVideoElement): DetectedMarker[];
};

export function createArucoDetector(): MarkerDetector {
  const detector = new AR.Detector();
  const offscreen = document.createElement('canvas');
  const offCtx = offscreen.getContext('2d')!;

  function detect(video: HTMLVideoElement): DetectedMarker[] {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return [];

    if (offscreen.width !== width || offscreen.height !== height) {
      offscreen.width = width;
      offscreen.height = height;
    }

    offCtx.drawImage(video, 0, 0, width, height);
    const imageData = offCtx.getImageData(0, 0, width, height);
    const markers = detector.detect(imageData);

    return markers.map((marker: any) => ({
      id: marker.id as number,
      corners: marker.corners.map((c: any) => ({ x: c.x, y: c.y })) as Point[],
    }));
  }

  return { detect };
}
