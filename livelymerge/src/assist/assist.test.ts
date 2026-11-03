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

// ---- M3: pen geometry, word anchors, synthetic input helpers -----------------

import { animatePath, naturalDurationMs, pathLength, pointAt, resample, shapeToPaths, wobble } from './pen';
import { parseAnchors, spanWords, speak } from './say';
import { codeFor } from './events';

describe('pen', () => {
  it('pathLength / pointAt / resample', () => {
    const p = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ];
    expect(pathLength(p)).toBe(70);
    expect(pointAt(p, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(p, 50)).toEqual({ x: 30, y: 20 });
    expect(pointAt(p, 999)).toEqual({ x: 30, y: 40 });
    const r = resample(p, 10);
    expect(r.length).toBe(8);
    expect(r[r.length - 1]).toEqual({ x: 30, y: 40 });
    expect(r[3]).toEqual({ x: 30, y: 0 });
  });
  it('shapes: circle closes, arrow has shaft + head, box closes, underline is a line', () => {
    const [c] = shapeToPaths({ shape: 'circle', center: { x: 100, y: 100 }, r: 50 }, 'crisp');
    expect(c.length).toBe(57);
    expect(c[0].x).toBeCloseTo(c[c.length - 1].x, 6);
    expect(c[0].y).toBeCloseTo(c[c.length - 1].y, 6);
    for (const p of c) expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(50, 6);
    const arrow = shapeToPaths({ shape: 'arrow', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }, 'crisp');
    expect(arrow.length).toBe(2);
    expect(arrow[0]).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(arrow[1][1]).toEqual({ x: 100, y: 0 });
    expect(arrow[1][0].x).toBeLessThan(100);
    expect(arrow[1][2].x).toBeLessThan(100);
    expect(Math.sign(arrow[1][0].y)).toBe(-Math.sign(arrow[1][2].y));
    expect(Math.abs(arrow[1][0].y)).toBeGreaterThan(5);
    const [box] = shapeToPaths({ shape: 'box', x0: 1, y0: 2, x1: 11, y1: 22 }, 'crisp');
    expect(box.length).toBe(5);
    expect(box[4]).toEqual({ x: 1, y: 2 });
    expect(shapeToPaths({ shape: 'underline', from: { x: 0, y: 5 }, to: { x: 9, y: 5 } }, 'crisp')).toEqual([
      [{ x: 0, y: 5 }, { x: 9, y: 5 }],
    ]);
  });
  it('hand-drawn wobble stays close to the path and overshoots the circle', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const w = wobble([{ x: 0, y: 0 }, { x: 200, y: 0 }], 1.6, rnd);
    expect(w.length).toBeGreaterThan(30);
    for (const p of w) expect(Math.abs(p.y)).toBeLessThan(3);
    const [c] = shapeToPaths({ shape: 'circle', center: { x: 0, y: 0 }, r: 40 }, 'hand-drawn', rnd);
    expect(pathLength(c)).toBeGreaterThan(2 * Math.PI * 40 * 1.03);
  });
  it('naturalDurationMs paces at the default speed with a floor', () => {
    expect(naturalDurationMs([[{ x: 0, y: 0 }, { x: 10, y: 0 }]])).toBe(300);
    expect(naturalDurationMs([[{ x: 0, y: 0 }, { x: 800, y: 0 }]])).toBe(2000);
  });
  it('animatePath with duration 0 emits the whole path at once', async () => {
    const got: { x: number; y: number }[] = [];
    await animatePath([{ x: 0, y: 0 }, { x: 9, y: 0 }], 0, (pts) => got.push(...pts));
    expect(got[0]).toEqual({ x: 0, y: 0 });
    expect(got[got.length - 1]).toEqual({ x: 9, y: 0 });
  });
});

describe('say anchors', () => {
  it('parses spans and point markers out of the text', () => {
    const p = parseAnchors("I'll move {s1}this window{/} over {p2}here{/}. Then {x}spin it.");
    expect(p.text).toBe("I'll move this window over here. Then spin it.");
    expect(p.spans).toEqual([
      { id: 's1', start: 10, end: 21 },
      { id: 'p2', start: 27, end: 31 },
      { id: 'x', start: 38, end: 42 },
    ]);
    expect(spanWords(p, p.spans[0])).toEqual({ first: 2, last: 3 });
    expect(spanWords(p, p.spans[1])).toEqual({ first: 5, last: 5 });
    expect(spanWords(p, p.spans[2])).toEqual({ first: 7, last: 7 });
  });
  it('without a speech engine, estimated pacing still fires anchors in order', async () => {
    const p = parseAnchors('{a}one{/} two {b}three{/}');
    const log: string[] = [];
    await speak(
      p,
      {
        onWord: (i) => log.push(`w${i}`),
        onSpanStart: (s) => log.push(`+${s.id}`),
        onSpanEnd: (s) => log.push(`-${s.id}`),
      },
      { estimatedCharsPerSec: 400 },
    );
    expect(log).toEqual(['w0', '+a', '-a', 'w1', 'w2', '+b', '-b']);
  });
});

describe('events', () => {
  it('codeFor maps printable keys to KeyboardEvent codes', () => {
    expect(codeFor('a')).toBe('KeyA');
    expect(codeFor('Z')).toBe('KeyZ');
    expect(codeFor('5')).toBe('Digit5');
    expect(codeFor(' ')).toBe('Space');
    expect(codeFor('Enter')).toBe('Enter');
  });
});

// ---- M4: what the model receives ------------------------------------------------

import { buildUserContent } from './agent';
import { TOOLS, systemPrompt } from './prompt';

describe('agent message', () => {
  it('turns a session into text + labelled image blocks', () => {
    const content = buildUserContent({
      version: 1,
      startedAt: '2026-11-03T18:00:00.000Z',
      durationMs: 2400,
      canvas: { width: 1440, height: 900 },
      image: { width: 1280, height: 800, scale: 0.889 },
      transcript: [{ word: 'move', t0: 0, t1: 0.2 }],
      transcriptStatus: 'whisper',
      transcriptText: 'move this',
      audio: { status: 'recorded' },
      strokes: [],
      images: [
        { label: 'start', t: 0, width: 1280, height: 800, dataUrl: 'data:image/png;base64,AAAA' },
        { label: 'final', t: 2400, width: 1280, height: 800, dataUrl: 'data:image/png;base64,BBBB' },
      ],
      timeline: 'Timeline (seconds from session start):\n[0.00] move',
    });
    expect(content.map((c) => c.type)).toEqual(['text', 'text', 'text', 'image', 'text', 'image']);
    expect((content[1] as { type: 'text'; text: string }).text).toContain('Shared notes about this system: none yet');
    const head = content[0] as { type: 'text'; text: string };
    expect(head.text).toContain('Canvas 1440x900, images 1280x800 (scale 0.889)');
    expect(head.text).toContain('Transcript: "move this"');
    expect(head.text).toContain('[0.00] move');
    const img = content[3] as { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
    expect(img.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'AAAA' });
  });
  it('says when the transcript is missing', () => {
    const head = buildUserContent({
      version: 1, startedAt: '2026-11-03T18:00:00.000Z', durationMs: 1000,
      canvas: { width: 10, height: 10 }, image: { width: 10, height: 10, scale: 1 },
      transcript: [], transcriptStatus: 'failed', transcriptInfo: 'boom', audio: { status: 'none' },
      strokes: [], images: [], timeline: '',
    })[0] as { type: 'text'; text: string };
    expect(head.text).toContain('Transcript: unavailable (failed: boom)');
  });
  it('tools: perform/screenshot/eval, and the step enum covers every executor step type', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(['perform', 'screenshot', 'remember', 'forget', 'eval']);
    const schema = TOOLS[0].input_schema as any;
    const types: string[] = schema.properties.steps.items.properties.type.enum;
    for (const t of ['mouse_move', 'mouse_down', 'mouse_up', 'scroll', 'key_down', 'key_up', 'type', 'wait', 'pen', 'say', 'speech_bubble', 'thought_bubble', 'dismiss', 'eval', 'screenshot']) {
      expect(types).toContain(t);
    }
    expect(systemPrompt('BE WEIRD')).toContain('## Vibe\nBE WEIRD');
    expect(systemPrompt()).toContain('IMAGE pixels');
  });
});

// ---- bubble tails ----------------------------------------------------------------

import { bubbleTail } from './overlay';

describe('bubbleTail', () => {
  it('starts on the edge facing the anchor and stays short', () => {
    const below = bubbleTail(100, 100, 200, 60, { x: 150, y: 400 })!;
    expect(below.base).toEqual({ x: 150, y: 160 });
    expect(Math.hypot(below.tip.x - below.base.x, below.tip.y - below.base.y)).toBeLessThanOrEqual(22.001);
    expect(below.tip.y).toBeGreaterThan(160);
    const above = bubbleTail(100, 100, 200, 60, { x: 50, y: 10 })!;
    expect(above.base.y).toBe(100);
    expect(above.base.x).toBe(116); // clamped away from the corner
    expect(above.tip.y).toBeLessThan(100);
    const left = bubbleTail(100, 100, 200, 60, { x: 20, y: 130 })!;
    expect(left.base).toEqual({ x: 100, y: 130 });
    expect(left.tip.x).toBeLessThan(100);
    expect(bubbleTail(100, 100, 200, 60, { x: 150, y: 130 })).toBeNull();
  });
});

// ---- closing speech cap ----------------------------------------------------------

import { capSpeech } from './agent';

describe('capSpeech', () => {
  it('keeps short text, cuts long text at a sentence boundary, never exceeds the cap by much', () => {
    expect(capSpeech('Done.')).toBe('Done.');
    const long =
      'I rotated the ladybug by 45 degrees counterclockwise using the halo. ' +
      'First I opened the halo with a cmd-click, then I dragged the R handle around the center, ' +
      'and finally I clicked on the background to dismiss it. Let me know if you want more!';
    const cut = capSpeech(long, 120);
    expect(cut).toBe('I rotated the ladybug by 45 degrees counterclockwise using the halo.');
    const oneHuge = 'word '.repeat(80).trim();
    expect(capSpeech(oneHuge, 50).length).toBeLessThanOrEqual(50);
    expect(capSpeech(oneHuge, 50).endsWith('…')).toBe(true);
  });
});

