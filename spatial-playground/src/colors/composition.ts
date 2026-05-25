import type { ColorId, EffectId } from '../types.ts';
import { clamp } from '../shared/utils.ts';
import type { ActiveComposition, CandidateCard, CardCategory, CardDefinition, Hsl, Palette } from './types.ts';
import { COLOR_LIBRARY, COLOR_ORDER, EFFECT_LIBRARY, IDLE_PALETTE } from './constants.ts';

export function mixHsl(colors: Hsl[]): Hsl {
  const total = colors.length;
  const unitVectors = colors.reduce(
    (sum, color) => {
      const radians = (color.h * Math.PI) / 180;
      return {
        x: sum.x + Math.cos(radians),
        y: sum.y + Math.sin(radians),
      };
    },
    { x: 0, y: 0 },
  );

  const averageHue = ((Math.atan2(unitVectors.y, unitVectors.x) * 180) / Math.PI + 360) % 360;
  const averageSaturation = colors.reduce((sum, color) => sum + color.s, 0) / total;
  const averageLightness = colors.reduce((sum, color) => sum + color.l, 0) / total;

  return {
    h: averageHue,
    s: averageSaturation,
    l: averageLightness,
  } satisfies Hsl;
}

export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = h / 60;
  const second = chroma * (1 - Math.abs((segment % 2) - 1));
  const match = l - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment >= 0 && segment < 1) {
    red = chroma;
    green = second;
  } else if (segment < 2) {
    red = second;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = second;
  } else if (segment < 4) {
    green = second;
    blue = chroma;
  } else if (segment < 5) {
    red = second;
    blue = chroma;
  } else {
    red = chroma;
    blue = second;
  }

  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function hslaString(hue: number, saturation: number, lightness: number, alpha: number): string {
  return `hsla(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%, ${alpha})`;
}

export function withAlpha(hexColor: string, alpha: number): string {
  const safeHex = hexColor.replace('#', '');
  const value = safeHex.length === 3
    ? safeHex.split('').map((character) => character + character).join('')
    : safeHex;

  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function resolvePalette(colors: ColorId[]): Palette {
  if (!colors.length) {
    return IDLE_PALETTE;
  }

  const colorDefinitions = colors.map((colorId) => COLOR_LIBRARY[colorId]);
  const mix = mixHsl(colorDefinitions.map((definition) => definition.hsl));

  if (colors.length === 1) {
    const base = colorDefinitions[0].hsl;
    const accent = hslToHex(base.h, clamp(base.s + 4, 0, 100), clamp(base.l + 2, 0, 100));
    const isBright = base.l > 58 || (base.h > 40 && base.h < 80);

    return {
      name: COLOR_LIBRARY[colors[0]].label,
      accent,
      glow: hslaString(base.h, clamp(base.s + 12, 0, 100), clamp(base.l + 10, 0, 100), 0.42),
      background: [
        hslToHex(base.h, clamp(base.s - 4, 0, 100), clamp(base.l - 34, 0, 100)),
        hslToHex(base.h, clamp(base.s + 2, 0, 100), clamp(base.l - 10, 0, 100)),
        hslToHex(base.h, clamp(base.s - 12, 0, 100), clamp(base.l + 24, 0, 100)),
      ] as [string, string, string],
      panel: isBright
        ? hslaString(base.h, clamp(base.s * 0.36, 12, 70), 96, 0.76)
        : hslaString(base.h, clamp(base.s * 0.6, 20, 82), 11, 0.72),
      text: isBright ? '#14211c' : '#eff7ff',
    } satisfies Palette;
  }

  const left = colorDefinitions[0].hsl;
  const right = colorDefinitions[1].hsl;
  const accent = hslToHex(mix.h, clamp(mix.s + 6, 0, 100), clamp(mix.l + 4, 0, 100));
  const isBright = mix.l > 60 || (mix.h > 40 && mix.h < 120);

  return {
    name: colors.map((colorId) => COLOR_LIBRARY[colorId].label).join(' + '),
    accent,
    glow: hslaString(mix.h, clamp(mix.s + 12, 0, 100), clamp(mix.l + 10, 0, 100), 0.44),
    background: [
      hslToHex(left.h, clamp(left.s - 10, 0, 100), clamp(left.l - 34, 0, 100)),
      hslToHex(mix.h, clamp(mix.s + 2, 0, 100), clamp(mix.l - 4, 0, 100)),
      hslToHex(right.h, clamp(right.s - 14, 0, 100), clamp(right.l + 12, 0, 100)),
    ] as [string, string, string],
    panel: isBright
      ? hslaString(mix.h, clamp(mix.s * 0.32, 12, 70), 96, 0.76)
      : hslaString(mix.h, clamp(mix.s * 0.56, 20, 84), 12, 0.72),
    text: isBright ? '#152117' : '#f4fbff',
  } satisfies Palette;
}

export function formatColorMix(colors: ColorId[]): string {
  const counts = new Map<ColorId, number>();
  for (const color of colors) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  return COLOR_ORDER
    .filter((color) => counts.has(color))
    .map((color) => {
      const count = counts.get(color) ?? 0;
      return count > 1
        ? `${COLOR_LIBRARY[color].label} x${count}`
        : COLOR_LIBRARY[color].label;
    })
    .join(' + ');
}

export function categoryLabel(category: CardCategory): string {
  if (category === 'color') {
    return 'Color';
  }

  return 'Effect';
}

export function formatVisibleLabel(card: CardDefinition): string {
  return `${categoryLabel(card.category)}: ${card.label}`;
}

export function createComposition(colors: ColorId[], effect: EffectId | null): ActiveComposition {
  const palette = resolvePalette(colors);
  const title = colors.length
    ? formatColorMix(colors)
    : 'Idle Field';

  const colorPhrase = colors.length
    ? `${colors.length === 2 ? 'Dual-color blend' : 'Single-color palette'} in ${palette.name.toLowerCase()}.`
    : 'Neutral idle palette waiting for cards.';

  const effectPhrase = effect
    ? `${EFFECT_LIBRARY[effect].label} effect is active.`
    : 'No effect layer active.';

  return {
    colors,
    effect,
    palette,
    title,
    tagline: `${colorPhrase} ${effectPhrase}`,
    key: `colors:${colors.join('+') || 'idle'}|fx:${effect ?? 'none'}`,
  };
}

export function resolveComposition(activeCandidates: CandidateCard[]): ActiveComposition {
  const activeColors = activeCandidates
    .filter((candidate) => candidate.card.category === 'color')
    .sort((left, right) => left.x - right.x)
    .map((candidate) => candidate.card.id as ColorId);

  const activeEffect = activeCandidates
    .filter((candidate) => candidate.card.category === 'fx')
    .sort((left, right) => right.lastArea - left.lastArea)[0]?.card.id as EffectId | undefined;

  return createComposition(activeColors, activeEffect ?? null);
}
