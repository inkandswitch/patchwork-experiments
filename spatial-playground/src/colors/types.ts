import type { Point } from '../types.ts';

export type VisibleCard = {
  trackingId: string;
  hue: number;
  cornerPoints: Point[];
  x: number;
  y: number;
  area: number;
};

export type CandidateCard = {
  trackingId: string;
  hue: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastArea: number;
  x: number;
  y: number;
};

export type TrackedSceneCard = {
  id: string;
  card: VisibleCard;
  lastSeenAt: number;
};

export type ColorRegion = {
  hue: number;
  corners: { x: number; y: number }[];
};
