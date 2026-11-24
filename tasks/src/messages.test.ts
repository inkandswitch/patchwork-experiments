import { describe, expect, it } from 'vitest';
import { Seen } from './messages';

describe('Seen', () => {
  it('lets a message through the first time and not the second', () => {
    const seen = new Seen();
    expect(seen.firstTime({ from: 'router', seq: 1 })).toBe(true);
    expect(seen.firstTime({ from: 'router', seq: 1 })).toBe(false);
  });

  it('tells senders and sequence numbers apart', () => {
    const seen = new Seen();
    expect(seen.firstTime({ from: 'router', seq: 1 })).toBe(true);
    expect(seen.firstTime({ from: 'router', seq: 2 })).toBe(true);
    expect(seen.firstTime({ from: 'pool', seq: 1 })).toBe(true);
  });

  it("doesn't mind messages arriving out of order", () => {
    const seen = new Seen();
    expect(seen.firstTime({ from: 'pool', seq: 5 })).toBe(true);
    expect(seen.firstTime({ from: 'pool', seq: 4 })).toBe(true);
    expect(seen.firstTime({ from: 'pool', seq: 5 })).toBe(false);
    expect(seen.firstTime({ from: 'pool', seq: 4 })).toBe(false);
  });

  it('still catches a repeat that turns up a few hundred messages later', () => {
    const seen = new Seen();
    seen.firstTime({ from: 'pool', seq: 0 });
    for (let seq = 1; seq <= 400; seq++) seen.firstTime({ from: 'pool', seq });
    expect(seen.firstTime({ from: 'pool', seq: 0 })).toBe(false);
  });

  it('forgets the oldest rather than growing without end', () => {
    const seen = new Seen();
    for (let seq = 0; seq < 2_000; seq++) seen.firstTime({ from: 'pool', seq });
    // long gone, so it reads as new again; nothing is in flight for that long
    expect(seen.firstTime({ from: 'pool', seq: 0 })).toBe(true);
    expect(seen.firstTime({ from: 'pool', seq: 1_999 })).toBe(false);
  });
});
