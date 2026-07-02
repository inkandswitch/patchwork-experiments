import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import {
  runStickerSource,
  type ScanContext,
  type Sticker,
} from "@embark/stickers";

// The timer sticker's backing-doc shape (rendered by @embark/stickers' timer
// tool). Inlined here as a contract type so this card keeps zero dependency on
// the stickers package's doc types — it only mints docs of this shape.
type TimerDoc = {
  "@patchwork": { type: "timer" };
  durationMs: number;
  startedAt?: number;
};

// Timer card behavior, loaded by the shared card shell as this package's
// `card.js`. It turns timer tokens into live timer widgets via a `tool` sticker
// in the "replace" slot. Each token gets a backing `timer` document, reused
// across edits (keyed by the cursor-based target url). The countdown widget
// itself is the separate timer tool (@embark/stickers' timer); this card only
// finds the tokens and mints the widgets. The card's face is drawn by the shell,
// so it renders nothing into the middle slot.
const card: ToolRender = (_handle, element) =>
  render(() => <TimerSource element={element} />, element);

function TimerSource(props: { element: ToolElement }) {
  onMount(() => {
    const source = runStickerSource(props.element, { scan: scanTimers });
    onCleanup(source.stop);
  });

  return null;
}

export default card;

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
