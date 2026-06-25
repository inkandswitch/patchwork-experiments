import type { GhostPlayhead } from './types';
import { PIXELS_PER_SECOND } from '../canvas/constants';

/** Light smoothing for band geometry (updates rarely). */
export const GHOST_BAND_SMOOTH_TAU_MS = 120;

/** Tighter follow for the playhead line (updates every frame over the network). */
export const GHOST_LINE_SMOOTH_TAU_MS = 50;

/** Extrapolate playhead line motion briefly between samples. */
export const GHOST_LINE_MAX_EXTRAPOLATE_MS = 100;

/** Jumps larger than this snap instantly (e.g. playhead switch or scrub). */
export const GHOST_PLAYHEAD_SNAP_DISTANCE_PX = 5 * PIXELS_PER_SECOND;

const BAND_FIELDS = ['x', 'y', 'height'] as const satisfies ReadonlyArray<
  keyof Pick<GhostPlayhead, 'x' | 'y' | 'height'>
>;

export type GhostSmoothState = {
  display: GhostPlayhead;
  target: GhostPlayhead;
  prevTarget: GhostPlayhead | null;
  targetAt: number;
  prevTargetAt: number | null;
};

function copyGhost(ghost: GhostPlayhead): GhostPlayhead {
  return { ...ghost };
}

export function syncGhostSmoothStates(
  targets: readonly GhostPlayhead[],
  states: Map<string, GhostSmoothState>,
): void {
  const now = performance.now();
  const nextNames = new Set<string>();

  for (const target of targets) {
    nextNames.add(target.name);
    const existing = states.get(target.name);
    if (existing) {
      if (
        Math.abs(existing.target.currentX - target.currentX) >= 0.5 ||
        existing.target.x !== target.x ||
        existing.target.y !== target.y ||
        existing.target.height !== target.height
      ) {
        existing.prevTarget = copyGhost(existing.target);
        existing.prevTargetAt = existing.targetAt;
      }
      existing.target = copyGhost(target);
      existing.targetAt = now;
      existing.display.color = target.color;
      existing.display.name = target.name;
      existing.display.timestamp = target.timestamp;
    } else {
      states.set(target.name, {
        display: copyGhost(target),
        target: copyGhost(target),
        prevTarget: null,
        targetAt: now,
        prevTargetAt: null,
      });
    }
  }

  for (const name of states.keys()) {
    if (!nextNames.has(name)) states.delete(name);
  }
}

function stepScalar(
  display: number,
  target: number,
  blend: number,
  snapDistance = GHOST_PLAYHEAD_SNAP_DISTANCE_PX,
): { value: number; animating: boolean } {
  const delta = target - display;
  if (Math.abs(delta) >= snapDistance) {
    return { value: target, animating: false };
  }
  if (Math.abs(delta) <= 0.25) {
    return { value: target, animating: false };
  }
  return { value: display + delta * blend, animating: true };
}

function predictedCurrentX(state: GhostSmoothState, now: number): number {
  const { target, prevTarget, targetAt, prevTargetAt } = state;
  if (!prevTarget || prevTargetAt === null) return target.currentX;

  const sampleDt = targetAt - prevTargetAt;
  if (sampleDt < 16) return target.currentX;

  const velocity = (target.currentX - prevTarget.currentX) / sampleDt;
  const elapsed = Math.max(0, now - targetAt);
  const lead = Math.min(elapsed, GHOST_LINE_MAX_EXTRAPOLATE_MS);
  return target.currentX + velocity * lead;
}

export function advanceGhostSmoothStates(
  states: Map<string, GhostSmoothState>,
  dtMs: number,
  now = performance.now(),
): boolean {
  if (states.size === 0) return false;

  const bandBlend = 1 - Math.exp(-dtMs / GHOST_BAND_SMOOTH_TAU_MS);
  const lineBlend = 1 - Math.exp(-dtMs / GHOST_LINE_SMOOTH_TAU_MS);
  let animating = false;

  for (const state of states.values()) {
    for (const field of BAND_FIELDS) {
      const stepped = stepScalar(state.display[field], state.target[field], bandBlend);
      state.display[field] = stepped.value;
      if (stepped.animating) animating = true;
    }

    const lineTarget = predictedCurrentX(state, now);
    const steppedLine = stepScalar(state.display.currentX, lineTarget, lineBlend, 2000);
    state.display.currentX = steppedLine.value;
    if (steppedLine.animating) animating = true;

    state.display.timestamp = state.target.timestamp;
  }

  return animating;
}

export function ghostDisplaysFromStates(states: Map<string, GhostSmoothState>): GhostPlayhead[] {
  return [...states.values()].map((state) => state.display);
}
