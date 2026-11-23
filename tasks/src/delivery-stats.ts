// Ephemeral messages are best-effort, and the framework's coordination rides on
// them, so it needs a way to see how many actually arrive. Every message a
// shared worker broadcasts carries who sent it (`from`) and a sequence number
// (`seq`) that counts up per channel; the receiver feeds those to a
// `DeliveryStats`, which turns gaps into a count of lost messages.

/** The fields a sender stamps onto every ephemeral message. */
export interface Stamp {
  /** Unique to one run of the sender, so a restart starts a new stream. */
  from: string;
  /** Counts up by one per message this sender broadcasts on this channel. */
  seq: number;
}

/** Hands out sequence numbers, one series per channel. */
export class Sequencer {
  private readonly next = new Map<string, number>();

  constructor(private readonly from: string) {}

  stamp(channel: string): Stamp {
    const seq = this.next.get(channel) ?? 0;
    this.next.set(channel, seq + 1);
    return { from: this.from, seq };
  }
}

export interface StreamStats {
  /** Distinct messages that arrived. */
  received: number;
  /** Sequence numbers skipped and never seen since. */
  missed: number;
  /** Messages that arrived after a later one (they stop counting as missed). */
  late: number;
  /** Messages that arrived more than once. */
  duplicates: number;
}

interface Stream extends StreamStats {
  /** The first sequence number heard, which is rarely the first one sent. */
  first: number;
  highest: number;
  missing: Set<number>;
  /** Sequence numbers below `first` that turned up afterwards. */
  early: Set<number>;
}

// A gap wider than this is a sender we stopped hearing for a long while, not
// thousands of messages worth remembering one by one.
const MAX_TRACKED_MISSING = 1_000;

export class DeliveryStats {
  private readonly streams = new Map<string, Stream>();

  /** Record one inbound message. `channel` is the doc it was broadcast on. */
  record(channel: string, { from, seq }: Stamp) {
    const key = `${from} → ${channel}`;
    const stream = this.streams.get(key);
    if (!stream) {
      // The first message heard from a sender is rarely its first: don't count
      // everything it sent before this receiver was listening as missed.
      this.streams.set(key, {
        first: seq,
        highest: seq,
        missing: new Set(),
        early: new Set(),
        received: 1,
        missed: 0,
        late: 0,
        duplicates: 0,
      });
      return;
    }

    if (seq > stream.highest) {
      for (let s = stream.highest + 1; s < seq; s++) {
        if (stream.missing.size < MAX_TRACKED_MISSING) {
          stream.missing.add(s);
        }
      }
      stream.missed += seq - stream.highest - 1;
      stream.highest = seq;
      stream.received++;
    } else if (stream.missing.delete(seq)) {
      stream.missed--;
      stream.late++;
      stream.received++;
    } else if (seq < stream.first && !stream.early.has(seq)) {
      // Sent before the first message heard, and overtaken by it. It was never
      // counted as missed, so it's only late.
      if (stream.early.size < MAX_TRACKED_MISSING) {
        stream.early.add(seq);
      }
      stream.late++;
      stream.received++;
    } else {
      stream.duplicates++;
    }
  }

  /** Per-stream counts, keyed by "sender → channel". */
  summary(): Record<string, StreamStats> {
    const summary: Record<string, StreamStats> = {};
    for (const [key, { received, missed, late, duplicates }] of this.streams) {
      summary[key] = { received, missed, late, duplicates };
    }
    return summary;
  }

  totals(): StreamStats {
    const totals: StreamStats = { received: 0, missed: 0, late: 0, duplicates: 0 };
    for (const stream of this.streams.values()) {
      totals.received += stream.received;
      totals.missed += stream.missed;
      totals.late += stream.late;
      totals.duplicates += stream.duplicates;
    }
    return totals;
  }
}

/** The BroadcastChannel the shared workers post their delivery reports on. */
export const DELIVERY_STATS_CHANNEL = 'patchwork-tasks-delivery-stats';

/** What one shared worker has counted so far. */
export interface DeliveryReport {
  /** Which worker this is, e.g. "router" or "task-next-worker-0". */
  label: string;
  totals: StreamStats;
  streams: Record<string, StreamStats>;
}

/**
 * Makes a shared worker's delivery stats visible: in its own console as
 * `deliveryStats`, with a warning there once a minute if a message has gone
 * missing or arrived twice since the last one, and to this origin's tabs,
 * which can't see into a shared worker, as a {@link DeliveryReport} every few
 * seconds on {@link DELIVERY_STATS_CHANNEL}.
 */
export function reportDeliveryStats(label: string, stats: DeliveryStats) {
  (globalThis as any).deliveryStats = stats;

  const channel = new BroadcastChannel(DELIVERY_STATS_CHANNEL);
  setInterval(() => {
    channel.postMessage({
      label,
      totals: stats.totals(),
      streams: stats.summary(),
    } satisfies DeliveryReport);
  }, 5_000);

  let reported = '';
  setInterval(() => {
    const totals = stats.totals();
    const line = `${totals.missed} missed, ${totals.duplicates} duplicates`;
    if (totals.missed + totals.duplicates > 0 && line !== reported) {
      reported = line;
      console.warn(`${label}: ephemeral delivery so far:`, totals, stats.summary());
    }
  }, 60_000);
}
