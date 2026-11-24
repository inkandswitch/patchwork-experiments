import { describe, expect, it } from 'vitest';
import {
  decideAvailability,
  FOCUS_REPORT_FRESH_MS,
  IDLE_REPORT_FRESH_MS,
  QUIET_AFTER_INPUT_MS,
  type TabReport,
} from './availability';

const now = 10_000_000;

function tab(report: Partial<TabReport> = {}): TabReport {
  return { sentAt: now, mode: 'polite', lastInputAt: null, focused: false, idle: null, ...report };
}

describe('always', () => {
  it('is available whatever the host is doing', () => {
    const busy = { tabs: [tab({ lastInputAt: now, focused: true, idle: 'active' })], pressure: 'critical' } as const;
    expect(decideAvailability('always', busy, now).available).toBe(true);
    expect(decideAvailability('always', { tabs: [], pressure: null }, now).available).toBe(true);
  });
});

describe('polite', () => {
  it('is available when nothing says the host is busy', () => {
    expect(decideAvailability('polite', { tabs: [tab()], pressure: null }, now).available).toBe(true);
    // no tab has reported yet
    expect(decideAvailability('polite', { tabs: [], pressure: null }, now).available).toBe(true);
  });

  it('stays out of the way while the user is working in Patchwork', () => {
    const signals = { tabs: [tab({ lastInputAt: now - 1_000 })], pressure: null };
    expect(decideAvailability('polite', signals, now)).toEqual({
      available: false,
      reason: "you're using Patchwork",
    });
  });

  it('counts input in any tab', () => {
    const signals = {
      tabs: [tab({ lastInputAt: now - 10 * 60_000 }), tab({ lastInputAt: now - 5_000 })],
      pressure: null,
    };
    expect(decideAvailability('polite', signals, now).available).toBe(false);
  });

  it('comes back once the user has been quiet for a while', () => {
    const signals = { tabs: [tab({ lastInputAt: now - QUIET_AFTER_INPUT_MS })], pressure: null };
    expect(decideAvailability('polite', signals, now).available).toBe(true);
  });

  it('backs off when the CPU is under serious pressure', () => {
    for (const pressure of ['serious', 'critical'] as const) {
      const signals = { tabs: [tab({ focused: true })], pressure };
      expect(decideAvailability('polite', signals, now)).toEqual({
        available: false,
        reason: 'the computer is busy',
      });
    }
    for (const pressure of ['nominal', 'fair'] as const) {
      const signals = { tabs: [tab({ focused: true })], pressure };
      expect(decideAvailability('polite', signals, now).available).toBe(true);
    }
  });

  it("doesn't trust a pressure reading once no tab has focus to keep it current", () => {
    const unfocused = { tabs: [tab({ focused: false })], pressure: 'critical' } as const;
    expect(decideAvailability('polite', unfocused, now).available).toBe(true);

    const wentQuiet = {
      tabs: [tab({ focused: true, sentAt: now - FOCUS_REPORT_FRESH_MS })],
      pressure: 'critical',
    } as const;
    expect(decideAvailability('polite', wentQuiet, now).available).toBe(true);
  });
});

describe('away', () => {
  it("doesn't work when it can't tell whether the user is away", () => {
    expect(decideAvailability('away', { tabs: [tab()], pressure: null }, now)).toEqual({
      available: false,
      reason: "can't tell whether you're away",
    });
    expect(decideAvailability('away', { tabs: [], pressure: null }, now).available).toBe(false);
  });

  it("doesn't work while the user is at the computer, even if they aren't in Patchwork", () => {
    const signals = { tabs: [tab({ idle: 'active', lastInputAt: null })], pressure: null };
    expect(decideAvailability('away', signals, now)).toEqual({
      available: false,
      reason: "you're at the computer",
    });
  });

  it('works once the user is idle or the screen is locked', () => {
    expect(decideAvailability('away', { tabs: [tab({ idle: 'idle' })], pressure: null }, now)).toEqual({
      available: true,
      reason: "you're away",
    });
    expect(
      decideAvailability('away', { tabs: [tab({ idle: 'locked' })], pressure: null }, now),
    ).toEqual({ available: true, reason: 'the screen is locked' });
  });

  it('goes by the most recent report when tabs disagree', () => {
    const signals = {
      tabs: [tab({ idle: 'idle', sentAt: now - 20_000 }), tab({ idle: 'active', sentAt: now - 1_000 })],
      pressure: null,
    };
    expect(decideAvailability('away', signals, now).available).toBe(false);
  });

  it("stops believing a tab that hasn't reported for too long", () => {
    // it said the user was idle, then was closed without saying goodbye
    const signals = {
      tabs: [tab({ idle: 'idle', sentAt: now - IDLE_REPORT_FRESH_MS })],
      pressure: null,
    };
    expect(decideAvailability('away', signals, now).available).toBe(false);
  });
});
