// The voice brush's pending-claim bookkeeping: each dropped card is claimed once by
// ITS renderer. A second click before the first card is claimed must not orphan the
// first (a stuck `recording: true` card every peer would see forever).
import { describe, it, expect, vi } from "vitest";

vi.mock("@chee/patchwork-transcript", () => ({ createTranscriptionStream: vi.fn() }));

import { claimVoice, VoiceBrush } from "./voice.js";

describe("voice brush — pending claims are per card id", () => {
  const rig = () => {
    let n = 0;
    const items = [];
    return { items, ctx: { uid: () => "v" + ++n, start: { x: 0, y: 0 }, change: (fn) => fn(items) } };
  };

  it("two quick drops before either is claimed: BOTH cards still find their recorder", () => {
    const { items, ctx } = rig();
    VoiceBrush.behavior.up(ctx);
    VoiceBrush.behavior.up(ctx); // the second click must not orphan the first
    expect(items.map((i) => i.id)).toEqual(["v1", "v2"]);
    expect(items.every((i) => i.recording)).toBe(true);
    expect(claimVoice("v1")).toBe(true); // first card: still claimable → its client records + finalises it
    expect(claimVoice("v2")).toBe(true);
  });

  it("a claim is one-shot, and an unknown id never claims", () => {
    const { ctx } = rig();
    VoiceBrush.behavior.up(ctx);
    expect(claimVoice("v1")).toBe(true);
    expect(claimVoice("v1")).toBe(false); // peers viewing the same card don't record
    expect(claimVoice("nope")).toBe(false);
  });
});
