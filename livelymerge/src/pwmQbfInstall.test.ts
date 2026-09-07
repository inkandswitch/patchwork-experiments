/**
 * PWM QBF: replaceMethod install of pwmTag on QBFMorph inside a real game harness.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeGame } from './qbfHarness';

function stripLeadingComments(src: string): string {
  const lines = src.split('\n');
  while (lines.length && (lines[0].trim() === '' || lines[0].trim().startsWith('//'))) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

describe('PWM QBF install', () => {
  it('installs pwmTag on QBFMorph and shows a banner on the board', () => {
    const { rt } = makeGame();
    const frag = stripLeadingComments(
      readFileSync(join(__dirname, '..', 'pwm', 'fragments', 'QBFMorph_pwmTag.js'), 'utf8'),
    );
    expect(rt.eval(`replaceMethod('QBFMorph', ${JSON.stringify(frag)})`)).toBe(true);
    expect(rt.eval(`qbfGame.pwmTag()`)).toBe('qbf-pong');
    const note = rt.eval(`
(() => {
  let found = qbfGame.submorphs.find((m) =>
    m.className === 'TextMorph' && m.shape && String(m.shape.string).indexOf('QBF collab') >= 0);
  return found ? String(found.shape.string) : 'missing';
})()
`) as string;
    expect(note).toContain('QBF collab');
  }, 120_000);
});
