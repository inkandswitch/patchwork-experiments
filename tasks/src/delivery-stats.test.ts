import { describe, expect, it } from 'vitest';
import { DeliveryStats, Sequencer } from './delivery-stats';

const channel = 'automerge:queue';
const from = 'router-1';

describe('Sequencer', () => {
  it('counts up separately on each channel', () => {
    const sequencer = new Sequencer(from);
    expect(sequencer.stamp('a')).toEqual({ from, seq: 0 });
    expect(sequencer.stamp('a')).toEqual({ from, seq: 1 });
    expect(sequencer.stamp('b')).toEqual({ from, seq: 0 });
    expect(sequencer.stamp('a')).toEqual({ from, seq: 2 });
  });
});

describe('DeliveryStats', () => {
  it('counts an unbroken run as received, with nothing missed', () => {
    const stats = new DeliveryStats();
    for (let seq = 0; seq < 5; seq++) stats.record(channel, { from, seq });
    expect(stats.totals()).toEqual({ received: 5, missed: 0, late: 0, duplicates: 0 });
  });

  it("doesn't count what a sender sent before the receiver was listening", () => {
    const stats = new DeliveryStats();
    stats.record(channel, { from, seq: 40 });
    stats.record(channel, { from, seq: 41 });
    expect(stats.totals()).toEqual({ received: 2, missed: 0, late: 0, duplicates: 0 });
  });

  it('counts skipped sequence numbers as missed', () => {
    const stats = new DeliveryStats();
    stats.record(channel, { from, seq: 0 });
    stats.record(channel, { from, seq: 4 });
    expect(stats.totals()).toEqual({ received: 2, missed: 3, late: 0, duplicates: 0 });
  });

  it('moves a message from missed to late when it turns up out of order', () => {
    const stats = new DeliveryStats();
    stats.record(channel, { from, seq: 0 });
    stats.record(channel, { from, seq: 2 });
    stats.record(channel, { from, seq: 1 });
    expect(stats.totals()).toEqual({ received: 3, missed: 0, late: 1, duplicates: 0 });
  });

  it("counts a message overtaken by the first one heard as late, not as a duplicate", () => {
    const stats = new DeliveryStats();
    stats.record(channel, { from, seq: 5 });
    stats.record(channel, { from, seq: 4 });
    stats.record(channel, { from, seq: 6 });
    expect(stats.totals()).toEqual({ received: 3, missed: 0, late: 1, duplicates: 0 });
    stats.record(channel, { from, seq: 4 });
    expect(stats.totals()).toEqual({ received: 3, missed: 0, late: 1, duplicates: 1 });
  });

  it('counts a repeat as a duplicate, not as received', () => {
    const stats = new DeliveryStats();
    stats.record(channel, { from, seq: 0 });
    stats.record(channel, { from, seq: 1 });
    stats.record(channel, { from, seq: 1 });
    stats.record(channel, { from, seq: 0 });
    expect(stats.totals()).toEqual({ received: 2, missed: 0, late: 0, duplicates: 2 });
  });

  it('keeps senders and channels apart', () => {
    const stats = new DeliveryStats();
    stats.record(channel, { from, seq: 0 });
    stats.record(channel, { from: 'router-2', seq: 0 });
    stats.record('automerge:other', { from, seq: 0 });
    stats.record(channel, { from, seq: 2 });
    expect(stats.summary()).toEqual({
      'router-1 → automerge:queue': { received: 2, missed: 1, late: 0, duplicates: 0 },
      'router-2 → automerge:queue': { received: 1, missed: 0, late: 0, duplicates: 0 },
      'router-1 → automerge:other': { received: 1, missed: 0, late: 0, duplicates: 0 },
    });
  });

  it('still counts a gap too wide to remember message by message', () => {
    const stats = new DeliveryStats();
    stats.record(channel, { from, seq: 0 });
    stats.record(channel, { from, seq: 5_000 });
    expect(stats.totals().missed).toBe(4_999);
  });
});
