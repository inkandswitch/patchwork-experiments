import { describe, expect, it } from 'vitest';
import { Hearing } from './task-rules.js';
import { LAPSE_MS } from './task-rules.js';

const clockAt = (start: number) => {
  const clock = { t: start, now: () => clock.t };
  return clock;
};

describe('Hearing', () => {
  it('counts a run never heard from as heard for LAPSE_MS after it was first seen', () => {
    const clock = clockAt(1_000);
    const hearing = new Hearing(clock);
    hearing.saw([{ id: 'r' }]);
    clock.t += LAPSE_MS - 1;
    expect(hearing.heard('r')).toBe(true);
    clock.t += 1;
    expect(hearing.heard('r')).toBe(false);
  });

  it('keeps the first sight: seeing a run again does not restart its lapse', () => {
    const clock = clockAt(0);
    const hearing = new Hearing(clock);
    hearing.saw([{ id: 'r' }]);
    clock.t = LAPSE_MS - 1;
    hearing.saw([{ id: 'r' }]);
    clock.t = LAPSE_MS;
    expect(hearing.heard('r')).toBe(false);
  });

  it('counts a run heard from for LAPSE_MS after the last word, whenever it was first seen', () => {
    const clock = clockAt(0);
    const hearing = new Hearing(clock);
    hearing.saw([{ id: 'r' }]);
    clock.t = 50_000;
    expect(hearing.heard('r')).toBe(false);
    hearing.heardFrom('r');
    clock.t = 50_000 + LAPSE_MS - 1;
    expect(hearing.heard('r')).toBe(true);
    clock.t = 50_000 + LAPSE_MS;
    expect(hearing.heard('r')).toBe(false);
  });

  it('counts a word that came before the run was seen in a document', () => {
    const clock = clockAt(0);
    const hearing = new Hearing(clock);
    hearing.heardFrom('r');
    clock.t = 5_000;
    hearing.saw([{ id: 'r' }]);
    clock.t = LAPSE_MS;
    // the last word, not the later first sight, is what counts
    expect(hearing.heard('r')).toBe(false);
  });

  it('takes a run asked about but never shown as seen when first asked', () => {
    const clock = clockAt(0);
    const hearing = new Hearing(clock);
    clock.t = 7_000;
    expect(hearing.heard('r')).toBe(true);
    clock.t = 7_000 + LAPSE_MS;
    expect(hearing.heard('r')).toBe(false);
  });

  it('keeps each run apart', () => {
    const clock = clockAt(0);
    const hearing = new Hearing(clock);
    hearing.saw([{ id: 'a' }]);
    clock.t = LAPSE_MS;
    hearing.saw([{ id: 'a' }, { id: 'b' }]);
    expect(hearing.heard('a')).toBe(false);
    expect(hearing.heard('b')).toBe(true);
  });

  it('shares nothing with another Hearing: a copy of a task, followed with its own, is not heard by what the original says', () => {
    // One per task followed: a copy carries the original's run names.
    const clock = clockAt(0);
    const original = new Hearing(clock);
    const copy = new Hearing(clock);
    original.saw([{ id: 'r' }]);
    clock.t = LAPSE_MS;
    copy.saw([{ id: 'r' }]);
    original.heardFrom('r');
    clock.t = 2 * LAPSE_MS - 1;
    expect(original.heard('r')).toBe(true);
    expect(copy.heard('r')).toBe(true); // first seen by the copy's Hearing at LAPSE_MS
    clock.t = 2 * LAPSE_MS;
    original.heardFrom('r');
    expect(original.heard('r')).toBe(true);
    expect(copy.heard('r')).toBe(false);
    // and what one forgets, or is asked first, the other does not
    copy.forget('r');
    expect(original.heard('r')).toBe(true);
    expect(copy.heard('only asked of the copy')).toBe(true);
    expect([...original.firstSeen.keys()]).toEqual(['r']);
    expect(original.firstSeen).not.toBe(copy.firstSeen);
    expect(original.lastHeard).not.toBe(copy.lastHeard);
  });

  it('reads the clock it was given, and Date by default', () => {
    const hearing = new Hearing();
    expect(hearing.clock).toBe(Date);
    hearing.saw([{ id: 'r' }]);
    expect(hearing.heard('r')).toBe(true);
  });

  it('forgets a run: seen again, it starts afresh', () => {
    const clock = clockAt(0);
    const hearing = new Hearing(clock);
    hearing.saw([{ id: 'r' }]);
    hearing.heardFrom('r');
    clock.t = LAPSE_MS;
    hearing.forget('r');
    hearing.saw([{ id: 'r' }]);
    expect(hearing.heard('r')).toBe(true);
  });
});
