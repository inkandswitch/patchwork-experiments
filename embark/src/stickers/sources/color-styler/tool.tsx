import type { Sticker } from "../../types";
import type { ScanContext } from "../source-lib";
import { stickerSourceTool } from "../source-tool";

// A sticker source that finds color literals in a document and paints each one
// in its own color via a `style` sticker.
export const ColorStylerTool = stickerSourceTool(
  { title: "Color Styler", subtitle: "Tints color words" },
  { scan: scanColors },
);

// Hex (#rgb / #rgba / #rrggbb / #rrggbbaa), rgb()/rgba(), and a handful of
// common named colors.
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const RGB_RE =
  /rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+%?\s*)?\)/g;
const NAMED_RE = new RegExp(
  `\\b(${[
    "red",
    "orange",
    "yellow",
    "green",
    "blue",
    "indigo",
    "violet",
    "purple",
    "pink",
    "brown",
    "black",
    "white",
    "gray",
    "grey",
    "cyan",
    "magenta",
    "teal",
    "navy",
    "maroon",
    "olive",
    "lime",
    "aqua",
    "gold",
    "coral",
    "salmon",
    "crimson",
    "turquoise",
  ].join("|")})\\b`,
  "gi",
);

function scanColors(ctx: ScanContext): Sticker[] {
  const stickers: Sticker[] = [];
  for (const { from, to, color } of findColors(ctx.content)) {
    stickers.push({
      type: "style",
      styles: { color, "border-bottom": `2px solid ${color}` },
      target: ctx.target(from, to),
    });
  }
  return stickers;
}

type ColorMatch = { from: number; to: number; color: string };

// Collect color spans from every pattern, then drop any that overlap an
// already-claimed span (so a named color inside an rgb() isn't double-counted).
function findColors(content: string): ColorMatch[] {
  const matches: ColorMatch[] = [];
  for (const re of [HEX_RE, RGB_RE, NAMED_RE]) {
    for (const match of content.matchAll(re)) {
      const from = match.index ?? 0;
      matches.push({ from, to: from + match[0].length, color: match[0] });
    }
  }
  matches.sort((a, b) => a.from - b.from);

  const claimed: ColorMatch[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.from < cursor) continue;
    claimed.push(match);
    cursor = match.to;
  }
  return claimed;
}
