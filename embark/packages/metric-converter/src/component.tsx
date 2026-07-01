import type { JSX } from "solid-js";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import {
  stickerSourceCard,
  type ScanContext,
  type Sticker,
} from "@embark/core";

// A handle-less `patchwork:component` that scans text for metric quantities and
// annotates each with its imperial equivalent as a `text` sticker in the "after"
// slot — the mirror of the Unit Converter. It also understands running pace
// written as `M:SS /km` and converts it to `M:SS /mi`, the headline case for a
// pasted run summary like:
//
//   5.03 km
//   32:10 · 6:24 /km
//
// This is a standalone card: it deliberately shares no scanning code with the
// Unit Converter. `stickerSourceCard` ignores its doc handle, so the default
// export adapts it to the handle-less component shape.
const MetricConverterCard = stickerSourceCard(
  {
    title: "Metric Converter",
    description:
      "Scans your notes for metric quantities — km, m, kg, °C, and pace in /km — and annotates each with its imperial equivalent.",
    source: "Metric → imperial",
    accent: "#16a34a",
    icon: RulerIcon,
  },
  { scan: scanMetric },
);

export default (element: ToolElement): (() => void) | void =>
  MetricConverterCard(undefined as never, element);

function scanMetric(ctx: ScanContext): Sticker[] {
  const stickers: Sticker[] = [];
  for (const { from, to, text } of findMetrics(ctx.content)) {
    stickers.push({
      type: "text",
      text,
      target: ctx.target(from, to),
      slot: "after",
    });
  }
  return stickers;
}

const KM_PER_MILE = 1.60934;

// Running pace written `M:SS /km` (e.g. `6:24 /km`). Captured separately from the
// scalar converters because it has two number groups and a non-decimal format.
const PACE_RE = /(\d{1,2}):([0-5]\d)\s*\/\s*km\b/gi;

// Scalar `<number> <unit>` quantities. Each matches the whole span and formats
// the imperial result; the number is in group 1.
type Converter = { re: RegExp; convert: (value: number) => string };

const CONVERTERS: Converter[] = [
  {
    re: /(\d+(?:\.\d+)?)\s*km\b/gi,
    convert: (km) => `${round(km / KM_PER_MILE)} mi`,
  },
  {
    re: /(\d+(?:\.\d+)?)\s*kg\b/gi,
    convert: (kg) => `${round(kg * 2.20462)} lb`,
  },
  {
    re: /(\d+(?:\.\d+)?)\s*m\b/gi,
    convert: (m) => `${round(m * 3.28084)} ft`,
  },
  {
    re: /(\d+(?:\.\d+)?)\s*°?\s*C\b/g,
    convert: (c) => `${round((c * 9) / 5 + 32)} °F`,
  },
];

type MetricMatch = { from: number; to: number; text: string };

function findMetrics(content: string): MetricMatch[] {
  const matches: MetricMatch[] = [];

  for (const match of content.matchAll(PACE_RE)) {
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue;
    const from = match.index ?? 0;
    matches.push({
      from,
      to: from + match[0].length,
      text: `(${paceToMile(minutes, seconds)})`,
    });
  }

  for (const { re, convert } of CONVERTERS) {
    for (const match of content.matchAll(re)) {
      const value = Number(match[1]);
      if (!Number.isFinite(value)) continue;
      const from = match.index ?? 0;
      matches.push({
        from,
        to: from + match[0].length,
        text: `(${convert(value)})`,
      });
    }
  }

  // Drop overlaps so the same span isn't annotated twice. Pace is collected
  // first, so when a pace's trailing `km` would also tempt the distance matcher
  // the pace span wins (they start at different offsets anyway).
  matches.sort((a, b) => a.from - b.from);
  const claimed: MetricMatch[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.from < cursor) continue;
    claimed.push(match);
    cursor = match.to;
  }
  return claimed;
}

// Convert a per-kilometer pace to per-mile: scale the seconds by km/mile and
// reformat as M:SS. Rounding to whole seconds before splitting avoids a stray
// ":60".
function paceToMile(minutes: number, seconds: number): string {
  const perMile = Math.round((minutes * 60 + seconds) * KM_PER_MILE);
  const min = Math.floor(perMile / 60);
  const sec = perMile % 60;
  return `${min}:${String(sec).padStart(2, "0")} /mi`;
}

function round(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

function RulerIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8h18v8H3z" transform="rotate(-45 12 12)" />
      <path d="M9 7v2M12 6v3M15 7v2" transform="rotate(-45 12 12)" />
    </svg>
  );
}
