// "Convert to imperial" card behavior, loaded by the shared card shell as this
// package's `card.js`. It runs the shared sticker-scanning engine against the
// canvas it's mounted inside, annotating metric quantities with their imperial
// equivalents. `element.repo` is the embed contract and the shared context
// store is found by DOM discovery from `element`. It carries no live state of
// its own — releasing the engine drops every sticker it published. The card's
// face is drawn by the shared card shell, so it renders nothing into the
// middle slot. Shares no scanning code with Convert-to-metric.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards are imported with relative paths (every card lives in the one shared
// cards package) and the core platform comes from ../platform.js.

import { runStickerSource } from "../stickers-card/engine.js";

export default function card(_handle, element) {
  const source = runStickerSource(element, { scan: scanMetric });
  return source.stop;
}

// --- Scanning ----------------------------------------------------------------

function scanMetric(ctx) {
  const stickers = [];
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
const CONVERTERS = [
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

function findMetrics(content) {
  const matches = [];

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
  const claimed = [];
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
function paceToMile(minutes, seconds) {
  const perMile = Math.round((minutes * 60 + seconds) * KM_PER_MILE);
  const min = Math.floor(perMile / 60);
  const sec = perMile % 60;
  return `${min}:${String(sec).padStart(2, "0")} /mi`;
}

function round(value) {
  return (Math.round(value * 10) / 10).toString();
}
