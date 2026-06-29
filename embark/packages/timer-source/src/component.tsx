import type { JSX } from "solid-js";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import {
  stickerSourceCard,
  type ScanContext,
  type Sticker,
} from "@embark/core";

// The timer sticker's backing-doc shape (rendered by @embark/stickers' timer
// tool). Inlined here as a contract type so this component keeps zero dependency
// on the stickers package — it only mints docs of this shape.
type TimerDoc = {
  "@patchwork": { type: "timer" };
  durationMs: number;
  startedAt?: number;
};

// A handle-less `patchwork:component` that turns timer tokens into live timer
// widgets via a `tool` sticker in the "replace" slot. Each token gets a backing
// `timer` document, reused across edits (keyed by the cursor-based target url).
// The countdown widget itself is the separate timer tool (@embark/stickers'
// timer); this component only finds the tokens and mints the widgets.
// `stickerSourceCard` ignores its doc handle, so the default export adapts it to
// the handle-less component shape.
const TimerSourceCard = stickerSourceCard(
  {
    title: "Timer",
    description:
      "Turns timer tokens in your notes — @timer 5m or a bare 5:00 — into live countdown widgets you can start and reset.",
    source: "@timer 5m · MM:SS",
    accent: "#8b5cf6",
    icon: ClockIcon,
  },
  { scan: scanTimers },
);

export default (element: ToolElement): (() => void) | void =>
  TimerSourceCard(undefined as never, element);

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

function ClockIcon(): JSX.Element {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
