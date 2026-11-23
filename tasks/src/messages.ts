// How the framework's own messages (heartbeats, "work on") travel.
//
// Each one goes out twice. Once as an ephemeral message on a document, which
// the sync server passes to everyone who has that document open: that is how
// it reaches other people's computers. And once on a BroadcastChannel, which
// reaches this browser's own tabs and shared workers directly: that is how the
// router, the pool and the workers on one computer still hear each other when
// there is no server to go through, on a plane, say.
//
// A neighbour on the same computer therefore hears most messages twice, so
// `listen` passes each on once. Senders already stamp what they send (see
// delivery-stats.ts), and the stamp is what tells a repeat from a new message.

import type { DocHandle } from '@automerge/automerge-repo/slim';
import type { Stamp } from './delivery-stats';

/** The BroadcastChannel that carries messages between this origin's tabs and workers. */
export const LOCAL_MESSAGES_CHANNEL = 'patchwork-tasks-messages';

/** A message as it crosses the local channel: which document's channel it's for, and the message. */
interface LocalEnvelope {
  channel: string;
  message: Stamp;
}

// One per context. A BroadcastChannel never hears itself, which is what's
// wanted: nothing here needs its own messages back.
let local: BroadcastChannel | undefined;
const localListeners = new Set<(envelope: LocalEnvelope) => void>();

function localChannel() {
  if (!local) {
    local = new BroadcastChannel(LOCAL_MESSAGES_CHANNEL);
    local.onmessage = ({ data }: MessageEvent<LocalEnvelope>) => {
      for (const listener of localListeners) {
        listener(data);
      }
    };
  }
  return local;
}

/** Sends `message` to everyone listening on `handle`'s channel, near and far. */
export function send<M extends Stamp>(handle: DocHandle<any>, message: M) {
  handle.broadcast(message);
  localChannel().postMessage({ channel: handle.url, message } satisfies LocalEnvelope);
}

/**
 * Calls `onMessage` once for each stamped message sent on `handle`'s channel,
 * by either route. Other tools broadcast on the same documents (presence, for
 * one); what they send carries no stamp and isn't passed on. Returns how to
 * stop.
 */
export function listen<M extends Stamp>(handle: DocHandle<any>, onMessage: (message: M) => void) {
  const seen = new Seen();
  const deliver = (message: unknown) => {
    if (isStamped(message) && seen.firstTime(message)) {
      onMessage(message as M);
    }
  };

  const onEphemeral = (payload: { message: unknown }) => deliver(payload.message);
  const onLocal = (envelope: LocalEnvelope) => {
    if (envelope?.channel === handle.url) {
      deliver(envelope.message);
    }
  };

  handle.on('ephemeral-message', onEphemeral);
  localChannel();
  localListeners.add(onLocal);
  return () => {
    handle.off('ephemeral-message', onEphemeral);
    localListeners.delete(onLocal);
  };
}

function isStamped(message: unknown): message is Stamp {
  const stamp = message as Stamp | null;
  return typeof stamp?.from === 'string' && typeof stamp?.seq === 'number';
}

/** How many recent stamps to remember; far more than can be in flight at once. */
const REMEMBERED = 500;

/** Remembers the stamps it has been shown lately, to tell a repeat from a new message. */
export class Seen {
  private readonly stamps = new Set<string>();

  /** True the first time a stamp is shown, false for a repeat. */
  firstTime({ from, seq }: Stamp) {
    const key = `${from}#${seq}`;
    if (this.stamps.has(key)) {
      return false;
    }
    this.stamps.add(key);
    if (this.stamps.size > REMEMBERED) {
      // a Set keeps the order things were added in, so this is the oldest
      this.stamps.delete(this.stamps.values().next().value!);
    }
    return true;
  }
}
