import { describe, expect, it } from 'vitest';
import { compatible, decideHandover, protocolOf, type Release } from './version';

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

describe('compatible', () => {
  it('takes a build that says nothing to be on the first protocol', () => {
    expect(protocolOf(undefined)).toBe(1);
    expect(compatible(undefined, 1)).toBe(true);
    expect(compatible(undefined, 2)).toBe(false);
  });

  it('is only ever the same protocol, newer or older', () => {
    expect(compatible(2, 2)).toBe(true);
    expect(compatible(1, 2)).toBe(false);
    expect(compatible(3, 2)).toBe(false);
  });
});
