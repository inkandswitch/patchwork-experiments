import type { JSX } from "solid-js";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { isValidAutomergeUrl, type Repo } from "@automerge/automerge-repo";
import {
  stickerSourceCard,
  type ScanContext,
  type Sticker,
  type StickerSource,
} from "@embark/core";

// A handle-less `patchwork:component` that reads your notes, highlights every
// clock time and duration, and runs a little schedule calculator: within a
// paragraph it carries a running clock so each duration shows the time you'll
// finish, and flags any computed time that overruns a later target. Embedded
// docs that expose a `duration` (e.g. a route card) count as durations too.
// Like the unit/currency converters it ships as the shared sticker-scanning
// engine with a playing-card face; `stickerSourceCard` ignores its doc handle,
// so the default export adapts it to the handle-less component shape.
const ScheduleCard = stickerSourceCard(
  {
    title: "Schedule",
    description:
      "Reads your notes for times (8:00) and durations (1 hour, 30 min, or an embedded route), highlights them, and adds each duration to the running clock — flagging anything that runs late.",
    source: "Running clock per paragraph",
    accent: "#7c3aed",
    icon: ClockIcon,
  },
  { scan: scanSchedule },
  onReady,
);

export default (element: ToolElement): (() => void) | void =>
  ScheduleCard(undefined as never, element);

// Highlight colors for the matched spans and the computed-time chip. Times and
// durations get distinct accents; a chip that overruns its next target goes red.
const TIME_STYLE = { color: "#1d4ed8", "font-weight": "600" };
const DURATION_STYLE = { color: "#b45309", "font-weight": "600" };
const LATE_STYLE = { color: "#dc2626", "font-weight": "700" };

// Scan one text field. Each paragraph (run of non-blank lines) is an
// independent schedule: a blank line resets the running clock. Within a
// paragraph we walk times and durations left-to-right, top-to-bottom —
//   - a time *sets* the running clock (a fresh anchor),
//   - a duration *advances* it (`running += duration`) and emits the new time,
//     so consecutive durations chain off each other.
// Every literal time/duration span is highlighted; a duration's chip turns red
// when its computed time lands after the next target time still ahead in the
// paragraph. Embedded docs with a `duration` field act as durations but aren't
// highlighted (their span is already drawn as a token chip).
function scanSchedule(ctx: ScanContext): Sticker[] {
  const stickers: Sticker[] = [];
  for (const block of splitBlocks(ctx.content)) {
    const tokens = lexBlock(ctx.content, block.from, block.to, ctx.repo);
    let running: number | null = null;
    tokens.forEach((token, i) => {
      if (!token.embed) {
        stickers.push({
          type: "style",
          styles: token.kind === "time" ? TIME_STYLE : DURATION_STYLE,
          target: ctx.target(token.from, token.to),
        });
      }

      if (token.kind === "time") {
        running = token.minutes;
        return;
      }
      // A duration with no preceding time has nothing to add to.
      if (running == null) return;
      running += token.minutes;

      const nextTime = tokens.slice(i + 1).find((t) => t.kind === "time");
      const late = nextTime != null && running > nextTime.minutes;
      stickers.push({
        type: "text",
        text: formatTime(running),
        target: ctx.target(token.from, token.to),
        slot: "after",
        ...(late ? { styles: LATE_STYLE } : {}),
      });
    });
  }
  return stickers;
}

type Block = { from: number; to: number };

// Split content into paragraphs: maximal runs of consecutive non-blank lines.
// A blank line (whitespace only) ends the current paragraph, which is what
// breaks the running-clock flow.
function splitBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let start: number | null = null;
  let lastEnd = 0;
  let offset = 0;
  for (const line of content.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    if (line.trim() === "") {
      if (start != null) blocks.push({ from: start, to: lastEnd });
      start = null;
    } else {
      if (start == null) start = lineStart;
      lastEnd = lineEnd;
    }
    offset = lineEnd + 1; // account for the consumed "\n"
  }
  if (start != null) blocks.push({ from: start, to: lastEnd });
  return blocks;
}

type Token = {
  kind: "time" | "dur";
  from: number;
  to: number;
  minutes: number;
  // True for an embedded-doc duration (a `{automerge:…}` token); these advance
  // the clock but aren't style-highlighted, since the span renders as a chip.
  embed?: boolean;
};

// 24-hour clock times like 8:00 or 14:30 (hours 0-23, minutes 0-59).
const TIME_RE = /\b(\d{1,2}):(\d{2})\b/g;
// Durations like 1 hour, 2 hours, 1.5 hr, 30 minutes, 45 min. Hour units start
// with "h", minute units with "m" — `unitToMinutes` keys off that first letter.
const DURATION_RE = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?)\b/gi;
// Inline embed tokens, the literal the mention extension inserts: `{automerge:…}`.
const EMBED_RE = /\{(automerge:[^}\n]+)\}/g;

// Collect every time, duration, and duration-bearing embed in a paragraph as
// positioned tokens, then drop overlaps so the same characters aren't claimed
// twice.
function lexBlock(
  content: string,
  from: number,
  to: number,
  repo: Repo,
): Token[] {
  const text = content.slice(from, to);
  const tokens: Token[] = [];

  for (const match of text.matchAll(TIME_RE)) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) continue;
    const index = (match.index ?? 0) + from;
    tokens.push({
      kind: "time",
      from: index,
      to: index + match[0].length,
      minutes: hours * 60 + minutes,
    });
  }

  for (const match of text.matchAll(DURATION_RE)) {
    const value = Number(match[1]);
    const minutes = unitToMinutes(value, match[2].toLowerCase());
    if (minutes == null) continue;
    const index = (match.index ?? 0) + from;
    tokens.push({
      kind: "dur",
      from: index,
      to: index + match[0].length,
      minutes,
    });
  }

  for (const match of text.matchAll(EMBED_RE)) {
    const url = match[1].trim();
    if (!isValidAutomergeUrl(url)) continue;
    const minutes = embedDurationMinutes(repo, url);
    if (minutes == null) continue; // unknown, pending, or has no duration
    const index = (match.index ?? 0) + from;
    tokens.push({
      kind: "dur",
      from: index,
      to: index + match[0].length,
      minutes,
      embed: true,
    });
  }

  tokens.sort((a, b) => a.from - b.from);
  const claimed: Token[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.from < cursor) continue;
    claimed.push(token);
    cursor = token.to;
  }
  return claimed;
}

function unitToMinutes(value: number, unit: string): number | null {
  if (!Number.isFinite(value)) return null;
  if (unit.startsWith("h")) return Math.round(value * 60);
  if (unit.startsWith("m")) return Math.round(value);
  return null;
}

// ---------------------------------------------------------------------------
// Embedded-doc durations
//
// An embed token (`{automerge:url}`) counts as a duration when the doc it points
// at carries a numeric `duration` (seconds — e.g. a route card's travel time).
// Resolving a doc is async but `scan` is synchronous, so we mirror the currency
// converter's pattern: a module-level cache answers scans immediately, and a
// background fetch fills it in and re-runs every source's scan once it lands
// (and again whenever the embedded doc changes).
// ---------------------------------------------------------------------------

// Every live source, so a resolved/changed embed can trigger a fresh scan.
const sources = new Set<StickerSource>();
// url -> duration in minutes, or null once we know it carries no usable
// duration. Absent means "not fetched yet".
const durationCache = new Map<string, number | null>();
const watching = new Set<string>();

function onReady(source: StickerSource) {
  sources.add(source);
}

// The cached duration (minutes) for an embed url, or null when unknown/pending
// or the doc exposes no duration. Kicks off a one-time fetch on a cache miss.
function embedDurationMinutes(repo: Repo, url: string): number | null {
  if (durationCache.has(url)) return durationCache.get(url) ?? null;
  watchEmbed(repo, url);
  return null;
}

function watchEmbed(repo: Repo, url: string): void {
  if (watching.has(url)) return;
  watching.add(url);
  void Promise.resolve(repo.find(url as Parameters<Repo["find"]>[0]))
    .then((handle) => {
      const update = () => {
        const next = durationMinutesOf(handle.doc());
        if (durationCache.get(url) === next) return;
        durationCache.set(url, next);
        rescanAll();
      };
      update();
      handle.on("change", update);
    })
    .catch(() => {
      durationCache.set(url, null);
      rescanAll();
    });
}

// A doc's travel/elapsed time in minutes, read from a generic `duration` field
// (seconds, the route card's unit). Null when there's no usable positive value.
function durationMinutesOf(doc: unknown): number | null {
  const seconds = (doc as { duration?: unknown } | undefined)?.duration;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return seconds / 60;
}

function rescanAll(): void {
  for (const source of sources) source.rescanAll();
}

// Render minutes-since-midnight as H:MM, wrapping past midnight so a long day
// still produces a sane clock value.
function formatTime(total: number): string {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
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
