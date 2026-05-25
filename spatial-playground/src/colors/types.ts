import type { ColorId, EffectId } from '../types.ts';

export type CardCategory = 'color' | 'fx';
export type CardPayload = `color:${ColorId}` | `fx:${EffectId}`;

export type CardDefinition = {
  payload: CardPayload;
  category: CardCategory;
  id: ColorId | EffectId;
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
  glow: string;
  background: [string, string, string];
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

export type ActiveComposition = {
  colors: ColorId[];
  effect: EffectId | null;
  palette: Palette;
  title: string;
  tagline: string;
  key: string;
};
