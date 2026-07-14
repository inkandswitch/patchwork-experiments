import type { Clip } from '../types';
import { PIXELS_PER_SECOND } from './constants';
import { sourceSkip } from '../clip-timing';

/** Page-x tolerance for toggle: ~0.1s of timeline, independent of zoom. */
export const MARKER_TOGGLE_EPS_PX = 8;

export function clipMarkers(clip: Clip): number[] {
  return clip.markers ?? [];
}

/** Page-space x of a marker given the clip's current left edge and source in-point. */
export function markerPageX(clipX: number, sourceInTime: number, markerSourceTime: number): number {
  return clipX + (markerSourceTime - sourceInTime) * PIXELS_PER_SECOND;
}

/** Marker page-x positions that fall inside the clip's visible window. */
export function visibleMarkerPageXs(
  markers: readonly number[],
  clipX: number,
  sourceInTime: number,
  playDuration: number,
): number[] {
  const sourceEnd = sourceInTime + playDuration;
  const xs: number[] = [];
  for (const t of markers) {
    if (t < sourceInTime - 1e-9 || t > sourceEnd + 1e-9) continue;
    xs.push(markerPageX(clipX, sourceInTime, t));
  }
  return xs;
}

/** Offsets from the clip's left edge (page px) for each visible marker — used while moving. */
export function visibleMarkerOffsetsFromLeft(
  markers: readonly number[],
  sourceInTime: number,
  playDuration: number,
): number[] {
  const sourceEnd = sourceInTime + playDuration;
  const offsets: number[] = [];
  for (const t of markers) {
    if (t < sourceInTime - 1e-9 || t > sourceEnd + 1e-9) continue;
    offsets.push((t - sourceInTime) * PIXELS_PER_SECOND);
  }
  return offsets;
}

export function markerSourceBounds(clip: Clip): { min: number; max: number } | null {
  const markers = clipMarkers(clip);
  if (markers.length === 0) return null;
  let min = markers[0]!;
  let max = markers[0]!;
  for (let i = 1; i < markers.length; i++) {
    const t = markers[i]!;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { min, max };
}

/**
 * Shortest play duration that still keeps every marker visible
 * (right edge cannot trim past the rightmost marker).
 */
export function minDurationKeepingMarkers(clip: Clip): number {
  const bounds = markerSourceBounds(clip);
  if (!bounds) return 0;
  return Math.max(0, bounds.max - sourceSkip(clip));
}

/**
 * Highest sourceInTime that still keeps every marker visible
 * (left edge cannot trim past the leftmost marker).
 */
export function maxSourceInKeepingMarkers(clip: Clip): number {
  const bounds = markerSourceBounds(clip);
  if (!bounds) return Infinity;
  return bounds.min;
}

/** Source time under the playhead on this clip, or null if the playhead misses the clip. */
export function playheadSourceTimeOnClip(
  clip: Clip,
  playheadX: number,
  playDuration: number,
): number | null {
  const width = Math.max(12, playDuration * PIXELS_PER_SECOND);
  if (playheadX < clip.x - MARKER_TOGGLE_EPS_PX || playheadX > clip.x + width + MARKER_TOGGLE_EPS_PX) {
    return null;
  }
  return (playheadX - clip.x) / PIXELS_PER_SECOND + sourceSkip(clip);
}

/** Index of the marker nearest to `pageX` within `tolerancePx`, or -1. */
export function nearestMarkerIndexAtPageX(
  clip: Clip,
  pageX: number,
  tolerancePx: number = MARKER_TOGGLE_EPS_PX,
): number {
  const sourceIn = sourceSkip(clip);
  const markers = clipMarkers(clip);
  let best = -1;
  let bestDist = tolerancePx + 1;
  for (let i = 0; i < markers.length; i++) {
    const mx = markerPageX(clip.x, sourceIn, markers[i]!);
    const dist = Math.abs(mx - pageX);
    if (dist <= tolerancePx && dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export function removeClipMarkerAtIndex(clip: Clip, index: number): boolean {
  const markers = [...clipMarkers(clip)];
  if (index < 0 || index >= markers.length) return false;
  markers.splice(index, 1);
  if (markers.length > 0) clip.markers = markers;
  else delete clip.markers;
  return true;
}

/**
 * Add a marker at `sourceTime` unless one already sits within `tolerancePx`.
 * Returns whether a marker was added.
 */
export function addClipMarkerAtSourceTime(
  clip: Clip,
  sourceTime: number,
  playDuration: number,
  tolerancePx: number = MARKER_TOGGLE_EPS_PX,
): boolean {
  const sourceIn = sourceSkip(clip);
  if (sourceTime < sourceIn - 1e-9 || sourceTime > sourceIn + playDuration + 1e-9) return false;
  const pageX = markerPageX(clip.x, sourceIn, sourceTime);
  if (nearestMarkerIndexAtPageX(clip, pageX, tolerancePx) >= 0) return false;
  const markers = [...clipMarkers(clip)];
  markers.push(sourceTime);
  markers.sort((a, b) => a - b);
  clip.markers = markers;
  return true;
}

/**
 * Add a marker at `sourceTime`, or remove the nearest marker within `tolerancePx`
 * page pixels of that position. Returns whether the markers array changed.
 */
export function toggleClipMarkerAtSourceTime(
  clip: Clip,
  sourceTime: number,
  playDuration: number,
  tolerancePx: number = MARKER_TOGGLE_EPS_PX,
): boolean {
  const sourceIn = sourceSkip(clip);
  const pageX = markerPageX(clip.x, sourceIn, sourceTime);
  const best = nearestMarkerIndexAtPageX(clip, pageX, tolerancePx);
  if (best >= 0) return removeClipMarkerAtIndex(clip, best);
  // Only place markers inside the visible window.
  if (sourceTime < sourceIn - 1e-9 || sourceTime > sourceIn + playDuration + 1e-9) return false;
  const markers = [...clipMarkers(clip)];
  markers.push(sourceTime);
  markers.sort((a, b) => a - b);
  clip.markers = markers;
  return true;
}

/** Clamp a marker's source time so it stays inside the clip's visible window. */
export function clampMarkerSourceTime(clip: Clip, sourceTime: number, playDuration: number): number {
  const sourceIn = sourceSkip(clip);
  return Math.max(sourceIn, Math.min(sourceIn + playDuration, sourceTime));
}

export function setClipMarkerSourceTime(
  clip: Clip,
  originalSourceTime: number,
  nextSourceTime: number,
): void {
  const markers = [...clipMarkers(clip)];
  const index = markers.findIndex((t) => Math.abs(t - originalSourceTime) < 1e-6);
  if (index < 0) return;
  markers[index] = nextSourceTime;
  markers.sort((a, b) => a - b);
  clip.markers = markers;
}

export function partitionMarkersAtSourceTime(
  markers: readonly number[],
  splitSourceTime: number,
): { left: number[]; right: number[] } {
  const left: number[] = [];
  const right: number[] = [];
  for (const t of markers) {
    if (t < splitSourceTime - 1e-9) left.push(t);
    else right.push(t);
  }
  return { left, right };
}
