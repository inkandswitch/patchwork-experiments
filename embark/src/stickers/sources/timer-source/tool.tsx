import type { Sticker } from "../../types";
import type { TimerDoc } from "../../timer/datatype";
import type { ScanContext } from "../source-lib";
import { stickerSourceTool } from "../source-tool";

// A sticker source that turns timer tokens into live timer widgets via a
// `tool` sticker in the "replace" slot. Each token gets a backing `timer`
// document, reused across edits (keyed by the cursor-based target url).
export const TimerSourceTool = stickerSourceTool(
  { title: "Timer Source", subtitle: "@timer 5m or 5:00 becomes a widget" },
  { scan: scanTimers },
);

// `@timer <n><h|m|s>` (e.g. `@timer 5m`) or a bare `MM:SS` (e.g. `5:00`).
const TOKEN_RE = /@timer\s+(\d+)\s*(h|m|s)\b|\b(\d{1,2}):([0-5]\d)\b/gi;

function scanTimers(ctx: ScanContext): Sticker[] {
  const stickers: Sticker[] = [];
  for (const match of ctx.content.matchAll(TOKEN_RE)) {
    const durationMs = durationOf(match);
    if (durationMs == null) continue;
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const target = ctx.target(from, to);
    const docUrl = ctx.resource(target, () =>
      ctx.repo.create<TimerDoc>({
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
function durationOf(match: RegExpMatchArray): number | null {
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
