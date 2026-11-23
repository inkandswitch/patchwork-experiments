import { describe, expect, it } from 'vitest';
import { decideHandover, type Release } from './version';

const scripts = { pool: 'pool.js', router: 'router.js', worker: 'worker.js' };
const release = (build: number, startProtocol = 1): Release => ({ build, startProtocol, scripts });

describe('decideHandover', () => {
  it('keeps what it has when offered the same build', () => {
    expect(decideHandover(release(100), release(100), 1)).toBe('keep');
  });

  it('keeps what it has when offered an older build', () => {
    // a stale tab announcing itself must not drag everyone backwards
    expect(decideHandover(release(100), release(90), 1)).toBe('keep');
  });

  it('adopts a newer build it knows how to start', () => {
    expect(decideHandover(release(100), release(101), 1)).toBe('adopt');
  });

  it('asks for a reload when a newer build has to be started some other way', () => {
    expect(decideHandover(release(100), release(101, 2), 1)).toBe('reload');
  });

  it("doesn't ask for a reload over an older build that is started some other way", () => {
    expect(decideHandover(release(100), release(90, 2), 1)).toBe('keep');
  });

  it('keeps what it has when the offer carries no usable build', () => {
    expect(decideHandover(release(100), release(NaN), 1)).toBe('keep');
  });
});
