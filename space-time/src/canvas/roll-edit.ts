import type { Clip, Playhead, SpaceTimeDoc } from '../types';
import type { ClipTimingInfo } from '../diffusion/sync-composition';
import { maxClipPlayDuration, resolveClipPlayDuration } from '../clip-timing';
import { clipDisplayName, findClip } from '../helpers';
import {
  maxSourceInKeepingMarkers,
  minDurationKeepingMarkers,
} from './clip-markers';
import { CLIP_HEIGHT, MIN_CLIP_DURATION, PIXELS_PER_SECOND, rangesOverlap } from './constants';
import { clipsInPlayheadExtent } from './playhead-extent';

/** Page-px tolerance for treating two clip edges as perfectly abutted. */
export const ROLL_ABUT_EPS_PX = 0.75;

export type RollRightPartner = {
  clipId: string;
  originalX: number;
  originalY: number;
  originalDuration: number;
  originalSourceInTime: number;
  label: string;
};

export type RollLeftPartner = {
  clipId: string;
  originalX: number;
  originalY: number;
  originalDuration: number;
  maxDuration: number;
  label: string;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function playDurationFor(
  clip: Clip,
  timing: Map<string, ClipTimingInfo>,
): number {
  return resolveClipPlayDuration(clip, timing.get(clip.id)?.sourceLength);
}

function clipsSharePlayhead(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  clipIdA: string,
  clipIdB: string,
  preferredPlayheadId: string | null,
): boolean {
  const ordered: Playhead[] = [];
  if (preferredPlayheadId) {
    const preferred = doc.playheads.find((p) => p.id === preferredPlayheadId);
    if (preferred) ordered.push(preferred);
  }
  for (const ph of doc.playheads) {
    if (ph.id !== preferredPlayheadId) ordered.push(ph);
  }
  for (const ph of ordered) {
    const clips = clipsInPlayheadExtent(doc, ph, timing);
    const hasA = clips.some((c) => c.id === clipIdA);
    const hasB = clips.some((c) => c.id === clipIdB);
    if (hasA && hasB) return true;
  }
  return false;
}

function verticallyOverlap(a: Clip, b: Clip): boolean {
  return rangesOverlap(a.y, a.y + CLIP_HEIGHT, b.y, b.y + CLIP_HEIGHT);
}

/**
 * Clips to the right of `primary` whose left edge abuts primary's right edge,
 * share a playhead, and overlap vertically. Used when dragging primary's
 * right handle (roll edit).
 */
export function findRightRollPartners(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  primaryId: string,
  preferredPlayheadId: string | null,
): RollRightPartner[] {
  const primary = findClip(doc, primaryId);
  if (!primary) return [];
  const primaryDur = playDurationFor(primary, timing);
  const editX = primary.x + primaryDur * PIXELS_PER_SECOND;
  const out: RollRightPartner[] = [];

  for (const clip of doc.clips) {
    if (clip.id === primaryId) continue;
    if (!verticallyOverlap(primary, clip)) continue;
    if (!clipsSharePlayhead(doc, timing, primaryId, clip.id, preferredPlayheadId)) continue;
    if (Math.abs(clip.x - editX) > ROLL_ABUT_EPS_PX) continue;
    const duration = playDurationFor(clip, timing);
    out.push({
      clipId: clip.id,
      originalX: clip.x,
      originalY: clip.y,
      originalDuration: duration,
      originalSourceInTime: clip.sourceInTime ?? 0,
      label: clipDisplayName(doc, clip),
    });
  }
  return out;
}

/**
 * Clips to the left of `primary` whose right edge abuts primary's left edge.
 * Used when dragging primary's left handle (roll edit).
 */
export function findLeftRollPartners(
  doc: SpaceTimeDoc,
  timing: Map<string, ClipTimingInfo>,
  primaryId: string,
  preferredPlayheadId: string | null,
): RollLeftPartner[] {
  const primary = findClip(doc, primaryId);
  if (!primary) return [];
  const editX = primary.x;
  const out: RollLeftPartner[] = [];

  for (const clip of doc.clips) {
    if (clip.id === primaryId) continue;
    if (!verticallyOverlap(primary, clip)) continue;
    if (!clipsSharePlayhead(doc, timing, primaryId, clip.id, preferredPlayheadId)) continue;
    const duration = playDurationFor(clip, timing);
    const rightX = clip.x + duration * PIXELS_PER_SECOND;
    if (Math.abs(rightX - editX) > ROLL_ABUT_EPS_PX) continue;
    const maxDuration = maxClipPlayDuration(clip, timing.get(clip.id)?.sourceLength);
    out.push({
      clipId: clip.id,
      originalX: clip.x,
      originalY: clip.y,
      originalDuration: duration,
      maxDuration: Number.isFinite(maxDuration) ? maxDuration : duration + 1e6,
      label: clipDisplayName(doc, clip),
    });
  }
  return out;
}

/**
 * How far a right-side partner can follow a roll delta via left-trim.
 * Positive deltaT = edit moves right (partner shortens from the left).
 * Negative deltaT = edit moves left (partner reveals media to the left).
 * Partners that can't follow the full delta return a clamped value — they
 * drop out of the abutment while the primary handle may keep moving.
 */
export function clampRightPartnerDelta(partner: RollRightPartner, clip: Clip, deltaT: number): number {
  const minDur = Math.max(MIN_CLIP_DURATION, minDurationKeepingMarkers(clip));
  const maxIn = maxSourceInKeepingMarkers(clip);
  const maxDelta = Math.min(
    partner.originalDuration - minDur,
    maxIn - partner.originalSourceInTime,
  );
  const minDelta = -partner.originalSourceInTime;
  return clamp(deltaT, minDelta, maxDelta);
}

/**
 * How far a left-side partner can follow a roll delta via right-resize.
 * Positive deltaT = edit moves right (partner lengthens).
 * Negative deltaT = edit moves left (partner shortens).
 */
export function clampLeftPartnerDelta(partner: RollLeftPartner, clip: Clip, deltaT: number): number {
  const minDur = Math.max(MIN_CLIP_DURATION, minDurationKeepingMarkers(clip));
  const maxDelta = partner.maxDuration - partner.originalDuration;
  const minDelta = minDur - partner.originalDuration;
  return clamp(deltaT, minDelta, maxDelta);
}

export function rightPartnerPreview(
  partner: RollRightPartner,
  deltaT: number,
): {
  clipId: string;
  x: number;
  y: number;
  duration: number;
  sourceInTime: number;
  label: string;
} {
  return {
    clipId: partner.clipId,
    x: partner.originalX + deltaT * PIXELS_PER_SECOND,
    y: partner.originalY,
    duration: partner.originalDuration - deltaT,
    sourceInTime: partner.originalSourceInTime + deltaT,
    label: partner.label,
  };
}

export function leftPartnerPreview(
  partner: RollLeftPartner,
  deltaT: number,
): {
  clipId: string;
  x: number;
  y: number;
  duration: number;
  label: string;
} {
  return {
    clipId: partner.clipId,
    x: partner.originalX,
    y: partner.originalY,
    duration: partner.originalDuration + deltaT,
    label: partner.label,
  };
}
