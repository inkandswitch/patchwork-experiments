import { describe, expect, it } from 'vitest';
import { Hearing } from './hearing';
import { LAPSE_MS } from './rules';

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
