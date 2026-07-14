import getStroke from 'perfect-freehand';
import type { Scribble, SpaceTimeDoc } from '../types';
import { findScribble, newScribble } from '../helpers';

export const SCRIBBLE_STROKE_OPTIONS = {
  size: 8,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
};

export function ensureScribbles(doc: SpaceTimeDoc): Scribble[] {
  if (!doc.scribbles) doc.scribbles = [];
  return doc.scribbles;
}

export function buildScribbleOutline(points: number[][]): number[][] | null {
  if (points.length < 2) return null;
  return getStroke(points, SCRIBBLE_STROKE_OPTIONS);
}

export function addScribble(doc: SpaceTimeDoc, outline: number[][]): string | null {
  if (outline.length < 3) return null;
  const scribble = newScribble(outline);
  ensureScribbles(doc).push(scribble);
  return scribble.id;
}

export function deleteScribble(doc: SpaceTimeDoc, scribbleId: string): void {
  const scribbles = ensureScribbles(doc);
  const index = scribbles.findIndex((s) => s.id === scribbleId);
  if (index >= 0) scribbles.splice(index, 1);
}

export function commitScribbleMove(
  doc: SpaceTimeDoc,
  scribbleId: string,
  outline: number[][],
): void {
  const scribble = findScribble(doc, scribbleId);
  if (!scribble) return;
  scribble.outline = outline;
}

export function translateOutline(outline: number[][], dx: number, dy: number): number[][] {
  return outline.map(([px, py]) => [px + dx, py + dy]);
}
