/**
 * Talk & Draw (src/assist): the pure parts — image scaling, stroke geometry, the
 * dissolve curve, hotkeys, and the timeline text the model will read.
 */
import { describe, expect, it } from 'vitest';
import { FADE_MS, LINGER_MS, dissolveAlpha, strokeBBox } from './ink';
import { isEndHotkey, isStartHotkey } from './hotkey';
import { formatTimeline, summarizeStroke } from './message';
import { MAX_LONG_EDGE, MAX_PIXELS, imageScale } from './snapshot';

describe('imageScale', () => {
  it('leaves a small canvas alone', () => {
    expect(imageScale(800, 600)).toEqual({ scale: 1, width: 800, height: 600 });
  });
  it('keeps the long edge and the pixel count under the API thresholds', () => {
    for (const [w, h] of [
      [1440, 900],
      [4000, 1000],
      [1000, 4000],
      [2560, 1600],
    ]) {
      const s = imageScale(w, h);
      expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(MAX_LONG_EDGE);
      expect(s.width * s.height).toBeLessThanOrEqual(MAX_PIXELS + 2 * MAX_LONG_EDGE); // rounding slack
      expect(s.width / s.height).toBeCloseTo(w / h, 1);
      expect(s.scale).toBeLessThan(1);
    }
  });
});

describe('ink', () => {
  it('strokeBBox', () => {
    expect(
      strokeBBox([
        { x: 5, y: 9, t: 0 },
        { x: 1, y: 20, t: 1 },
        { x: 7, y: 3, t: 2 },
      ]),
    ).toEqual({ x0: 1, y0: 3, x1: 7, y1: 20 });
    expect(strokeBBox([])).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });
  it('dissolveAlpha lingers, then fades linearly to 0', () => {
    expect(dissolveAlpha(0)).toBe(1);
    expect(dissolveAlpha(LINGER_MS - 1)).toBe(1);
    expect(dissolveAlpha(LINGER_MS + FADE_MS / 2)).toBeCloseTo(0.5);
    expect(dissolveAlpha(LINGER_MS + FADE_MS)).toBe(0);
    expect(dissolveAlpha(LINGER_MS + FADE_MS * 5)).toBe(0);
  });
});

describe('hotkeys', () => {
  const k = (o: Partial<Parameters<typeof isStartHotkey>[0]>) => ({
    key: '',
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...o,
  });
  it('cmd-space and ctrl-space start; plain space, tab, and extra modifiers do not', () => {
    expect(isStartHotkey(k({ key: ' ', code: 'Space', metaKey: true }))).toBe(true);
    expect(isStartHotkey(k({ key: ' ', code: 'Space', ctrlKey: true }))).toBe(true);
    expect(isStartHotkey(k({ key: ' ', code: 'Space' }))).toBe(false);
    expect(isStartHotkey(k({ key: 'Tab', metaKey: true, altKey: true }))).toBe(false);
    expect(isStartHotkey(k({ key: ' ', code: 'Space', ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isStartHotkey(k({ key: ' ', code: 'Space', metaKey: true, shiftKey: true }))).toBe(false);
  });
  it('esc ends', () => {
    expect(isEndHotkey(k({ key: 'Escape' }))).toBe(true);
    expect(isEndHotkey(k({ key: 'Enter' }))).toBe(false);
  });
});

describe('formatTimeline', () => {
  it('interleaves words and stroke markers; a stroke sits at its end time', () => {
    const words = [
      { word: 'move', t0: 0.0, t1: 0.2 },
      { word: 'this', t0: 0.31, t1: 0.5 },
      { word: 'over', t0: 1.1, t1: 1.25 },
      { word: 'here', t0: 1.3, t1: 1.5 },
    ];
    const strokes = [
      summarizeStroke({
        id: 1,
        t0: 250,
        t1: 900,
        points: [
          { x: 412, y: 230, t: 250 },
          { x: 610, y: 380, t: 900 },
        ],
      }),
      summarizeStroke({ id: 2, t0: 1400, t1: 1750, points: [{ x: 900, y: 500, t: 1400 }] }),
    ];
    const images = [{ label: 'start' }, { label: 'after stroke 1' }, { label: 'after stroke 2' }, { label: 'final' }];
    expect(formatTimeline(words, strokes, images, 2.4)).toBe(
      [
        'Timeline (seconds from session start):',
        '[0.00] move [0.31] this',
        '[stroke 1, 0.25–0.90, bbox (412,230)-(610,380)]   → image "after stroke 1"',
        '[1.10] over [1.30] here',
        '[stroke 2, 1.40–1.75, bbox (900,500)-(900,500)]   → image "after stroke 2"',
        '--- end of session at 2.40s ---   → image "final"',
      ].join('\n'),
    );
  });
  it('works with no words (stubbed transcript) and no strokes', () => {
    expect(formatTimeline([], [], [], 1)).toBe(
      'Timeline (seconds from session start):\n--- end of session at 1.00s ---   → image "final"',
    );
  });
});
