import type { JSX } from "solid-js";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import {
  runStickerSource,
  type ScanContext,
  type Sticker,
} from "@embark/stickers";
import "./unit-converter.css";

// Tool entry point for the `convert-to-metric` datatype: a document-backed view
// that runs the shared sticker-scanning engine against the canvas it's mounted
// inside, annotating imperial quantities with their metric equivalents. The
// backing doc is just a marker (see ./datatype); `element.repo` is the embed
// contract and the shared context store is found by DOM discovery from
// `element`. Its url is passed down as `selfUrl` so the engine can emphasize
// this card's stickers while it is the selected embed. It shares no scanning
// code with the Convert-to-imperial card.
export const ConvertToMetricTool: ToolRender = (handle, element) =>
  render(
    () => <UnitConverterCard element={element} selfUrl={handle.url} />,
    element,
  );

// The card face: a playing-card surface that starts the scanning engine on mount
// and tears it down on cleanup. It carries no live state of its own — releasing
// the engine drops every sticker it published.
function UnitConverterCard(props: {
  element: ToolElement;
  selfUrl: AutomergeUrl;
}) {
  onMount(() => {
    const source = runStickerSource(
      props.element,
      { scan: scanUnits },
      undefined,
      props.selfUrl,
    );
    onCleanup(source.stop);
  });

  return (
    <div class="embark-unit-card">
      <span class="embark-unit-card__pip embark-unit-card__pip--tl">
        <RulerIcon />
      </span>
      <div class="embark-unit-card__body">
        <div class="embark-unit-card__title">Convert to metric</div>
        <p class="embark-unit-card__desc">
          Annotates imperial quantities in your notes with metric equivalents.
        </p>
      </div>
      <span class="embark-unit-card__pip embark-unit-card__pip--br">
        <RulerIcon />
      </span>
    </div>
  );
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
      <path d="M3 8h18v8H3z" transform="rotate(45 12 12)" />
      <path d="M9 7v2M12 6v3M15 7v2" transform="rotate(45 12 12)" />
    </svg>
  );
}
