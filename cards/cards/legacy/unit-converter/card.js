// "Convert to metric" card behavior, loaded by the shared card shell as this
// package's `card.js`. It runs a sticker source against the canvas it's
// mounted inside, annotating imperial quantities with their metric
// equivalents. `element.repo` is the embed contract and the shared context
// store is found by DOM discovery from `element`. It carries no live state of
// its own — releasing the stickers slice drops every sticker it published.
// The card's face is drawn by the shared card shell, so it renders nothing
// into the middle slot. Shares no scanning code with Convert-to-imperial.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards are imported with relative paths (every card lives in the one shared
// cards package) and the core platform comes from ../platform.js.

import { runStickerSource } from "../stickers-card/engine.js";

export default function card(_handle, element) {
  const source = runStickerSource(element, { scan: scanUnits });
  return source.stop;
}

// --- Scanning ----------------------------------------------------------------

function scanUnits(ctx) {
  const stickers = [];
  for (const { from, to, text } of findUnits(ctx.content)) {
    stickers.push({
      type: "text",
      text,
      target: ctx.target(from, to),
      slot: "after",
    });
  }
  return stickers;
}

// Each converter matches `<number> <unit>` and formats the metric result. The
// number is captured in group 1; the whole match is the span to annotate.
// Inches are intentionally omitted to avoid matching the word "in".
const CONVERTERS = [
  {
    re: /(\d+(?:\.\d+)?)\s*(?:miles|mile|mi)\b/gi,
    convert: (mi) => `${round(mi * 1.60934)} km`,
  },
  {
    re: /(\d+(?:\.\d+)?)\s*(?:feet|foot|ft)\b/gi,
    convert: (ft) => `${round(ft * 0.3048)} m`,
  },
  {
    re: /(\d+(?:\.\d+)?)\s*(?:pounds|pound|lbs|lb)\b/gi,
    convert: (lb) => `${round(lb * 0.453592)} kg`,
  },
  {
    re: /(\d+(?:\.\d+)?)\s*°?\s*F\b/g,
    convert: (f) => `${round(((f - 32) * 5) / 9)} °C`,
  },
];

function findUnits(content) {
  const matches = [];
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
  // Drop overlaps so the same span isn't annotated twice.
  matches.sort((a, b) => a.from - b.from);
  const claimed = [];
  let claimedTo = 0;
  for (const match of matches) {
    if (match.from < claimedTo) continue;
    claimed.push(match);
    claimedTo = match.to;
  }
  return claimed;
}

function round(value) {
  return (Math.round(value * 10) / 10).toString();
}
