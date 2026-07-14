// Schedule card behavior, loaded by the shared card shell as this package's
// `card.js`. It runs the shared sticker-scanning engine against the canvas
// it's mounted inside. It highlights every clock time and duration and runs a
// little schedule calculator: within a paragraph it carries a running clock so
// each duration shows the time you'll finish, flagging any computed time that
// overruns a later target. Embedded docs that expose a `duration` (e.g. a
// route card) count as durations too. The card's face is drawn by the shared
// card shell, so it renders nothing into the middle slot. It registers the
// running source so a resolved/changed embedded duration can re-run every
// source's scan.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards and the core platform are imported by their automerge urls.

import { isValidAutomergeUrl } from "@automerge/automerge-repo";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const STICKERS_CARD_PACKAGE_URL = "automerge:2Tjy4kfsDHyv7xLCZtuf8dHAWbDy";

const { runStickerSource } = await import(
  getImportableUrlFromAutomergeUrl(STICKERS_CARD_PACKAGE_URL, "engine.js")
);

export default function card(_handle, element) {
  const source = runStickerSource(element, { scan: scanSchedule });
  sources.add(source);
  return () => {
    sources.delete(source);
    source.stop();
  };
}

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
function scanSchedule(ctx) {
  const stickers = [];
  for (const block of splitBlocks(ctx.content)) {
    const tokens = lexBlock(ctx.content, block.from, block.to, ctx.repo);
    let running = null;
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

// Split content into paragraphs: maximal runs of consecutive non-blank lines.
// A blank line (whitespace only) ends the current paragraph, which is what
// breaks the running-clock flow.
function splitBlocks(content) {
  const blocks = [];
  let start = null;
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

// 24-hour clock times like 8:00 or 14:30 (hours 0-23, minutes 0-59).
const TIME_RE = /\b(\d{1,2}):(\d{2})\b/g;
// Durations like 1 hour, 2 hours, 1.5 hr, 30 minutes, 45 min. Hour units start
// with "h", minute units with "m" — `unitToMinutes` keys off that first letter.
const DURATION_RE = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?)\b/gi;
// Inline embed tokens, the literal the mention extension inserts: `{automerge:…}`.
const EMBED_RE = /\{(automerge:[^}\n]+)\}/g;

// Collect every time, duration, and duration-bearing embed in a paragraph as
// positioned tokens (`{ kind: "time" | "dur", from, to, minutes, embed? }`),
// then drop overlaps so the same characters aren't claimed twice. Embed
// tokens advance the clock but aren't style-highlighted, since their span
// already renders as a chip.
function lexBlock(content, from, to, repo) {
  const text = content.slice(from, to);
  const tokens = [];

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
  const claimed = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.from < cursor) continue;
    claimed.push(token);
    cursor = token.to;
  }
  return claimed;
}

function unitToMinutes(value, unit) {
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
const sources = new Set();
// url -> duration in minutes, or null once we know it carries no usable
// duration. Absent means "not fetched yet".
const durationCache = new Map();
const watching = new Set();

// The cached duration (minutes) for an embed url, or null when unknown/pending
// or the doc exposes no duration. Kicks off a one-time fetch on a cache miss.
function embedDurationMinutes(repo, url) {
  if (durationCache.has(url)) return durationCache.get(url) ?? null;
  watchEmbed(repo, url);
  return null;
}

function watchEmbed(repo, url) {
  if (watching.has(url)) return;
  watching.add(url);
  void Promise.resolve(repo.find(url))
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
function durationMinutesOf(doc) {
  const seconds = doc?.duration;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return seconds / 60;
}

function rescanAll() {
  for (const source of sources) source.rescanAll();
}

// Render minutes-since-midnight as H:MM, wrapping past midnight so a long day
// still produces a sane clock value.
function formatTime(total) {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
