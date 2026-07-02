import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import {
  runStickerSource,
  type ScanContext,
  type Sticker,
} from "@embark/stickers";

// "Convert to metric" card behavior: runs the shared sticker-scanning engine
// against the canvas it's mounted inside, annotating imperial quantities with
// their metric equivalents. `element.repo` is the embed contract and the shared
// context store is found by DOM discovery from `element`. It carries no live
// state of its own — releasing the engine drops every sticker it published. The
// card's face is drawn by the shared card shell, so it renders nothing into the
// middle slot. Shares no scanning code with Convert-to-imperial.
export function UnitConverterCard(props: { element: ToolElement }) {
  onMount(() => {
    const source = runStickerSource(props.element, { scan: scanUnits });
    onCleanup(source.stop);
  });

  return null;
}

function scanUnits(ctx: ScanContext): Sticker[] {
  const stickers: Sticker[] = [];
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
type Converter = { re: RegExp; convert: (value: number) => string };

const CONVERTERS: Converter[] = [
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

type UnitMatch = { from: number; to: number; text: string };

function findUnits(content: string): UnitMatch[] {
  const matches: UnitMatch[] = [];
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
  const claimed: UnitMatch[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.from < cursor) continue;
    claimed.push(match);
    cursor = match.to;
  }
  return claimed;
}

function round(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}
