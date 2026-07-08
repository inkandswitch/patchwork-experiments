// Timer card behavior, loaded by the shared card shell as this package's
// `card.js`. It turns timer tokens into live timer widgets via a `tool`
// sticker in the "replace" slot. Each token gets a backing `timer` document,
// reused across edits (keyed by the cursor-based target url). The countdown
// widget itself is the separate timer tool (registered by the Stickers card);
// this card only finds the tokens and mints the widgets. The card's face is
// drawn by the shell, so it renders nothing into the middle slot.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards are imported with relative paths (every card lives in the one shared
// cards package) and the core platform comes from ../platform.js.

import { runStickerSource } from "../stickers-card/engine.js";

export default function card(_handle, element) {
  const source = runStickerSource(element, { scan: scanTimers });
  return source.stop;
}

// `@timer <n><h|m|s>` (e.g. `@timer 5m`) or a bare `MM:SS` (e.g. `5:00`).
const TOKEN_RE = /@timer\s+(\d+)\s*(h|m|s)\b|\b(\d{1,2}):([0-5]\d)\b/gi;

// The minted backing doc's shape is the timer tool's contract: a `timer`
// document with a duration (and, once running, a start timestamp).
function scanTimers(ctx) {
  const stickers = [];
  for (const match of ctx.content.matchAll(TOKEN_RE)) {
    const durationMs = durationOf(match);
    if (durationMs == null) continue;
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const target = ctx.target(from, to);
    const docUrl = ctx.resource(
      target,
      () =>
        ctx.repo.create({
          "@patchwork": { type: "timer" },
          durationMs,
        }).url,
    );
    stickers.push({
      type: "tool",
      toolId: "timer",
      docUrl,
      target,
      slot: "replace",
    });
  }
  return stickers;
}

// Group layout: 1 = number + 2 = unit (for `@timer`), or 3 = minutes + 4 =
// seconds (for `MM:SS`).
function durationOf(match) {
  if (match[1] && match[2]) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    const unit = match[2].toLowerCase();
    const factor = unit === "h" ? 3600000 : unit === "m" ? 60000 : 1000;
    return value * factor;
  }
  if (match[3] && match[4]) {
    return (Number(match[3]) * 60 + Number(match[4])) * 1000;
  }
  return null;
}
