import type { ColorId, EffectId, SoundId } from '../types.ts';
import type { CardDefinition, CardPayload, Hsl, Palette } from './types.ts';

export const DWELL_MS = 160;
export const CARD_TTL_MS = 1400;
export const MAX_SCANS_PER_SECOND = 14;
export const TRACK_MATCH_DISTANCE_RATIO = 0.15;

export const COLOR_ORDER: ColorId[] = ['red', 'blue', 'yellow', 'green'];

export const COLOR_LIBRARY: Record<ColorId, { label: string; hsl: Hsl; accent: string; description: string }> = {
  red: {
    label: 'Red',
    hsl: { h: 6, s: 80, l: 56 },
    accent: '#e24f3e',
    description: 'Warm crimson palette. Pair with blue for purple or yellow for orange.',
  },
  blue: {
    label: 'Blue',
    hsl: { h: 220, s: 84, l: 58 },
    accent: '#4b7dff',
    description: 'Cool electric blue. Pair with red for purple or yellow for spring green.',
  },
  yellow: {
    label: 'Yellow',
    hsl: { h: 48, s: 92, l: 62 },
    accent: '#f6c74b',
    description: 'Bright golden yellow. Pair with red for orange or green for lime.',
  },
  green: {
    label: 'Green',
    hsl: { h: 145, s: 62, l: 48 },
    accent: '#4fbf78',
    description: 'Fresh leaf green. Pair with blue for cyan or yellow for lime.',
  },
};

export const EFFECT_LIBRARY: Record<EffectId, { label: string; description: string; accent: string }> = {
  ripple: {
    label: 'Ripple',
    description: 'A liquid energy field with shock rings, caustics, and orbiting flares.',
    accent: '#8cc9ff',
  },
  grid: {
    label: 'Grid',
    description: 'A hyperspace tunnel with portal frames, rails, and star streaks.',
    accent: '#9be06b',
  },
  grain: {
    label: 'Grain',
    description: 'A prism storm of shards, orbiting dust, and radiant debris.',
    accent: '#f0d18a',
  },
};

export const SOUND_LIBRARY: Record<SoundId, { label: string; description: string; accent: string }> = {
  chime: {
    label: 'Chime',
    description: 'Sparse bell tones in a pentatonic pattern.',
    accent: '#f2f5ff',
  },
  pad: {
    label: 'Pad',
    description: 'Airy sustained synth chords with slow filter drift.',
    accent: '#c5e6ff',
  },
  lofi: {
    label: 'Lofi',
    description: 'Soft pulse, filtered hiss, and mellow tape wobble.',
    accent: '#ffd3a1',
  },
};

export const IDLE_PALETTE: Palette = {
  name: 'Idle Field',
  accent: '#355f70',
  glow: 'rgba(100, 187, 210, 0.36)',
  background: ['#f4e7d4', '#dce8dd', '#fff8ef'],
  panel: 'rgba(255, 249, 239, 0.74)',
  text: '#152329',
};

export const CARD_DEFINITIONS: CardDefinition[] = [
  ...COLOR_ORDER.map((colorId) => ({
    payload: `color:${colorId}` as CardPayload,
    category: 'color' as const,
    id: colorId,
    label: COLOR_LIBRARY[colorId].label,
    description: COLOR_LIBRARY[colorId].description,
    accent: COLOR_LIBRARY[colorId].accent,
  })),
  ...(['ripple', 'grid', 'grain'] as const).map((effectId) => ({
    payload: `fx:${effectId}` as CardPayload,
    category: 'fx' as const,
    id: effectId,
    label: EFFECT_LIBRARY[effectId].label,
    description: EFFECT_LIBRARY[effectId].description,
    accent: EFFECT_LIBRARY[effectId].accent,
  })),
  ...(['chime', 'pad', 'lofi'] as const).map((soundId) => ({
    payload: `sound:${soundId}` as CardPayload,
    category: 'sound' as const,
    id: soundId,
    label: SOUND_LIBRARY[soundId].label,
    description: SOUND_LIBRARY[soundId].description,
    accent: SOUND_LIBRARY[soundId].accent,
  })),
];

export const CARD_LIBRARY = new Map<CardPayload, CardDefinition>(
  CARD_DEFINITIONS.map((card) => [card.payload, card]),
);
