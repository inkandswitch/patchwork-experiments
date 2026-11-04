/** ElevenLabs alignment → word times (src/assist/tts.ts), the pure part. */
import { describe, expect, it } from 'vitest';
import { wordsFromAlignment } from './tts';

describe('wordsFromAlignment', () => {
  it('maps each word to the start of its first and the end of its last character', () => {
    const text = 'Hi there, you.';
    const characters = text.split('');
    const starts = characters.map((_, i) => i * 0.1);
    const ends = characters.map((_, i) => i * 0.1 + 0.1);
    const words = wordsFromAlignment(text, { characters, character_start_times_seconds: starts, character_end_times_seconds: ends });
    expect(words.map((w) => w.charIndex)).toEqual([0, 3, 10]);
    expect(words[0]).toEqual({ charIndex: 0, t0: 0, t1: 0.2 });
    expect(words[1].t0).toBeCloseTo(0.3);
    expect(words[1].t1).toBeCloseTo(0.9);
    expect(words[2].t0).toBeCloseTo(1.0);
    expect(words[2].t1).toBeCloseTo(1.4);
  });
  it('copes with characters the alignment dropped, and with no alignment', () => {
    const text = 'a  b';
    // The API collapsed the double space.
    const characters = ['a', ' ', 'b'];
    const words = wordsFromAlignment(text, { characters, character_start_times_seconds: [0, 0.1, 0.2], character_end_times_seconds: [0.1, 0.2, 0.3] });
    expect(words).toEqual([
      { charIndex: 0, t0: 0, t1: 0.1 },
      { charIndex: 3, t0: 0.2, t1: 0.3 },
    ]);
    expect(wordsFromAlignment(text, null)).toEqual([]);
  });
});
