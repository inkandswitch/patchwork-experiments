import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findClassSpan, mirrorFragmentIntoSource } from '../pwm/mirrorFragment';

function stripLeadingComments(src: string): string {
  const lines = src.split('\n');
  while (lines.length && (lines[0].trim() === '' || lines[0].trim().startsWith('//'))) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

describe('PWM mirrorFragment', () => {
  it('finds WorldMorph in newdefs.js and can (re)splice pwmPing', () => {
    const defs = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
    const span = findClassSpan(defs, 'WorldMorph');
    expect(span).not.toBeNull();
    expect(span!.text.startsWith('class WorldMorph')).toBe(true);

    const frag = stripLeadingComments(
      readFileSync(join(__dirname, '..', 'pwm', 'fragments', 'WorldMorph_pwmPing.js'), 'utf8'),
    );
    // Already mirrored live into newdefs; ensure WorldMorph still carries it.
    expect(defs.includes('pwmPing()')).toBe(true);

    const next = mirrorFragmentIntoSource(defs, 'WorldMorph', frag);
    expect(next.includes('pwmPing()')).toBe(true);
    expect(findClassSpan(next, 'WorldMorph')!.text.includes('return \'pong\'')).toBe(true);
  });

  it('inserts a brand-new method into a toy class source', () => {
    const toy = `class Toy extends Morph {
  existing() { return 1; }
}
`;
    const next = mirrorFragmentIntoSource(toy, 'Toy', 'fresh() { return 2; }');
    expect(next).toContain('fresh() { return 2; }');
    expect(next).toContain('existing() { return 1; }');
  });
});
