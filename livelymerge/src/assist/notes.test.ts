/**
 * Shared notes (src/assist/notes.ts): the LM code that upserts / removes / reads
 * `aiNotes`, run against a real runtime, plus the text the model reads.
 */
import { describe, expect, it } from 'vitest';
import { createLivelymergeRuntime } from '../livelymergeRuntime';
import { createAutomergeTestDocHandle } from '../testDocHandle';
import { forgetSource, formatNotes, readSource, rememberSource, type Note } from './notes';

function read(rt: ReturnType<typeof createLivelymergeRuntime>): Note[] {
  const arr = rt.eval(readSource()) as any;
  if (!arr) return [];
  const out: Note[] = [];
  for (let i = 0; i < arr.length; i++) out.push({ topic: arr[i].topic, text: arr[i].text, author: arr[i].author, when: arr[i].when });
  return out;
}

describe('shared notes store', () => {
  it('creates the global on first remember, upserts by topic, forgets, survives quotes', () => {
    const rt = createLivelymergeRuntime(createAutomergeTestDocHandle());
    expect(rt.eval(readSource())).toBeNull();
    expect(rt.eval(rememberSource({ topic: 'halos', text: 'cmd-click a morph to show its halo', author: 'alex', when: '2026-11-03T18:00:00Z' }))).toBe(1);
    expect(rt.eval(rememberSource({ topic: 'rotate', text: 'drag the "R" handle; it\'s at the bottom', author: 'dan' }))).toBe(2);
    expect(rt.eval(rememberSource({ topic: 'halos', text: 'cmd-click (meta) a morph; click elsewhere to dismiss' }))).toBe(2);
    const notes = read(rt);
    expect(notes.map((n) => n.topic)).toEqual(['halos', 'rotate']);
    expect(notes[0].text).toBe('cmd-click (meta) a morph; click elsewhere to dismiss');
    expect(notes[1].text).toBe('drag the "R" handle; it\'s at the bottom');
    expect(notes[1].author).toBe('dan');
    expect(rt.eval(forgetSource('nope'))).toBe(false);
    expect(rt.eval(forgetSource('halos'))).toBe(true);
    expect(read(rt).map((n) => n.topic)).toEqual(['rotate']);
    // It is an ordinary persistent global: visible as such from LM code.
    expect(rt.eval('aiNotes.length')).toBe(1);
    expect(rt.eval('Object.keys(global).includes("aiNotes")')).toBe(true);
  });
  it('formatNotes renders a list the model can read, and an invitation when empty', () => {
    expect(formatNotes([])).toContain('none yet');
    const text = formatNotes([{ topic: 'halos', text: 'cmd-click a morph', author: 'alex', when: '2026-11-03T18:00:00Z' }, { topic: 'x', text: 'y' }]);
    expect(text).toContain('- halos: cmd-click a morph (alex, 2026-11-03)');
    expect(text).toContain('- x: y');
  });
});

// ---- the seed newdefs ships -------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('newdefs seedAiNotes', () => {
  it('adds the starter topics once and never overwrites an existing topic', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'newdefs.js'), 'utf8');
    const m = /function seedAiNotes\(\) \{[\s\S]*?\n\}\n/.exec(src);
    expect(m).not.toBeNull();
    const rt = createLivelymergeRuntime(createAutomergeTestDocHandle());
    rt.eval(m![0]);
    expect(rt.eval(readSource())).toBeNull();
    rt.eval('seedAiNotes()');
    const first = read(rt);
    expect(first.length).toBeGreaterThanOrEqual(7);
    expect(first.map((n) => n.topic)).toContain('rotating a morph');
    expect(first.every((n) => n.author === 'newdefs (seed)')).toBe(true);
    // Idempotent, and an agent's correction survives a re-seed.
    rt.eval(rememberSource({ topic: 'rotating a morph', text: 'corrected by an agent' }));
    rt.eval('seedAiNotes()');
    const again = read(rt);
    expect(again.length).toBe(first.length);
    expect(again.find((n) => n.topic === 'rotating a morph')!.text).toBe('corrected by an agent');
  });
});
