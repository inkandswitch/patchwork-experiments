import type { ColorId } from '../types.ts';

export type CardCategory = 'color';
export type CardPayload = `color:${ColorId}`;

export type CardDefinition = {
  payload: CardPayload;
  category: CardCategory;
  id: ColorId;
  label: string;
  description: string;
  accent: string;
};

export type Hsl = {
  h: number;
  s: number;
  l: number;
};

export type Palette = {
  name: string;
  accent: string;
  panel: string;
  text: string;
};

export type VisibleCard = {
  trackingId: string;
  card: CardDefinition;
  rawValue: string;
  cornerPoints: import('../types.ts').Point[];
  x: number;
  y: number;
  area: number;
};

export type CandidateCard = {
  trackingId: string;
  card: CardDefinition;
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

export type ColorPosition = {
  colorId: ColorId;
  x: number;
  y: number;
};

export type ColorRegion = {
  colorId: ColorId;
  corners: { x: number; y: number }[];
};

export type ActiveComposition = {
  colors: ColorId[];
  colorPositions: ColorPosition[];
  palette: Palette;
  title: string;
  tagline: string;
  key: string;
};
