import type { ColorId } from '../types.ts';
import type { CardDefinition, CardPayload, Hsl } from './types.ts';

export const DWELL_MS = 160;
export const CARD_TTL_MS = 1400;
export const MAX_SCANS_PER_SECOND = 14;
export const TRACK_MATCH_DISTANCE_RATIO = 0.15;

export const COLOR_ORDER: ColorId[] = ['red', 'blue', 'yellow'];

export const COLOR_LIBRARY: Record<ColorId, { label: string; hsl: Hsl; accent: string; description: string }> = {
  red: {
    label: 'Red',
    hsl: { h: 6, s: 80, l: 56 },
    accent: '#e24f3e',
    description: 'Warm crimson. Mixes with blue for purple, with yellow for orange.',
  },
  blue: {
    label: 'Blue',
    hsl: { h: 220, s: 84, l: 58 },
    accent: '#4b7dff',
    description: 'Cool electric blue. Mixes with red for purple, with yellow for green.',
  },
  yellow: {
    label: 'Yellow',
    hsl: { h: 48, s: 92, l: 62 },
    accent: '#f6c74b',
    description: 'Bright golden yellow. Mixes with red for orange, with blue for green.',
  },
};

export const CARD_DEFINITIONS: CardDefinition[] = COLOR_ORDER.map((colorId) => ({
  payload: `color:${colorId}` as CardPayload,
  category: 'color' as const,
  id: colorId,
  label: COLOR_LIBRARY[colorId].label,
  description: COLOR_LIBRARY[colorId].description,
  accent: COLOR_LIBRARY[colorId].accent,
}));

export const CARD_LIBRARY = new Map<CardPayload, CardDefinition>(
  CARD_DEFINITIONS.map((card) => [card.payload, card]),
);
