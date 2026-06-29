import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// A countdown timer. `durationMs` is fixed; `startedAt` (epoch ms) is set when
// the timer is running and cleared when reset. Minted by the timer source as
// the backing doc for a `tool` sticker, and rendered by the timer tool.
export type TimerDoc = {
  "@patchwork": { type: "timer" };
  durationMs: number;
  startedAt?: number;
};

const DEFAULT_DURATION_MS = 5 * 60 * 1000;

export const TimerDatatype: DatatypeImplementation<TimerDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "timer" };
    doc.durationMs = DEFAULT_DURATION_MS;
  },
  getTitle(doc) {
    const seconds = Math.round((doc.durationMs ?? 0) / 1000);
    return `Timer (${seconds}s)`;
  },
};
