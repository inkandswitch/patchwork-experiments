import * as Automerge from '@automerge/automerge';
import { LivelymergeDatatype } from './datatype';
import type { LivelymergeDocHandle } from './livelymergeRuntime';
import type { LivelymergeDoc } from './types';

export type TestDocHandle = LivelymergeDocHandle & {
  doc(): LivelymergeDoc;
  /** Every message this handle broadcast, in order (production: DocHandle.broadcast). */
  sentEphemeral: unknown[];
  broadcast(message: unknown): void;
  on(event: string, fn: (payload: unknown) => void): void;
  off(event: string, fn: (payload: unknown) => void): void;
  /** Deliver an inbound ephemeral message to this handle's listeners, as if a peer
   * had broadcast it (production: the repo's network subsystem). */
  deliverEphemeral(message: unknown, senderId?: string): void;
};

/** Automerge doc handle matching production: every mutation goes through Automerge.change. */
export function createAutomergeTestDocHandle(): TestDocHandle {
  let doc = Automerge.from({} as LivelymergeDoc);
  doc = Automerge.change(doc, (d) => {
    LivelymergeDatatype.init(d);
  });

  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  const handle: TestDocHandle = {
    doc() {
      return doc;
    },
    change(fn) {
      doc = Automerge.change(doc, fn);
    },
    sentEphemeral: [],
    broadcast(message: unknown) {
      // Like production: goes to peers only, never echoed to this handle's listeners.
      handle.sentEphemeral.push(message);
    },
    on(event: string, fn: (payload: unknown) => void) {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
    },
    off(event: string, fn: (payload: unknown) => void) {
      const arr = listeners.get(event) ?? [];
      const ix = arr.indexOf(fn);
      if (ix >= 0) arr.splice(ix, 1);
    },
    deliverEphemeral(message: unknown, senderId = 'peer-test') {
      for (const fn of listeners.get('ephemeral-message') ?? []) {
        fn({ handle, senderId, message });
      }
    },
  };
  return handle;
}

/** Save + reload like sync/refresh — new handle, same persisted heap. */
export function roundTripDocHandle(handle: TestDocHandle): TestDocHandle {
  const reloaded = Automerge.load<LivelymergeDoc>(Automerge.save(handle.doc()));
  let doc = reloaded;
  return {
    doc() {
      return doc;
    },
    change(fn) {
      doc = Automerge.change(doc, fn);
    },
  };
}
