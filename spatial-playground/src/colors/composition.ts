import type { ColorId } from '../types.ts';
import { clamp } from '../shared/utils.ts';
import type { ActiveComposition, CardCategory, CardDefinition, ColorPosition, Hsl, Palette } from './types.ts';
import { COLOR_LIBRARY, COLOR_ORDER } from './constants.ts';

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

  return { h: averageHue, s: averageSaturation, l: averageLightness };
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
  return 'Color';
}

export function formatVisibleLabel(card: CardDefinition): string {
  return `${categoryLabel(card.category)}: ${card.label}`;
}

function computePalette(colors: ColorId[]): Palette {
  if (!colors.length) {
    return { name: 'Idle', accent: '#888888', panel: 'rgba(255, 255, 255, 0.74)', text: '#111111' };
  }

  const hslValues = colors.map((colorId) => COLOR_LIBRARY[colorId].hsl);
  const mix = colors.length === 1 ? hslValues[0] : mixHsl(hslValues);
  const accent = hslToHex(mix.h, mix.s, mix.l);
  const isBright = mix.l > 55 || (mix.h > 40 && mix.h < 80);

  return {
    name: formatColorMix(colors),
    accent,
    panel: isBright
      ? hslaString(mix.h, clamp(mix.s * 0.36, 12, 70), 96, 0.76)
      : hslaString(mix.h, clamp(mix.s * 0.6, 20, 82), 11, 0.72),
    text: isBright ? '#14211c' : '#eff7ff',
  };
}

export function createComposition(colorPositions: ColorPosition[]): ActiveComposition {
  const colors = colorPositions.map((cp) => cp.colorId);
  const palette = computePalette(colors);
  const title = colors.length ? formatColorMix(colors) : 'Idle';

  const tagline = colors.length
    ? `${colors.length} color${colors.length > 1 ? 's' : ''} active.`
    : 'Show color cards to the camera to fill the screen.';

  const positionKey = colorPositions
    .map((cp) => `${cp.colorId}@${cp.x.toFixed(1)},${cp.y.toFixed(1)}`)
    .join('|');

  return {
    colors,
    colorPositions,
    palette,
    title,
    tagline,
    key: positionKey || 'idle',
  };
}
