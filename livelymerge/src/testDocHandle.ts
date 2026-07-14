import * as Automerge from '@automerge/automerge';
import { LivelymergeDatatype } from './datatype';
import type { LivelymergeDocHandle } from './livelymergeRuntime';
import type { LivelymergeDoc } from './types';

export type TestDocHandle = LivelymergeDocHandle & { doc(): LivelymergeDoc };

/** Automerge doc handle matching production: every mutation goes through Automerge.change. */
export function createAutomergeTestDocHandle(): TestDocHandle {
  let doc = Automerge.from({} as LivelymergeDoc);
  doc = Automerge.change(doc, (d) => {
    LivelymergeDatatype.init(d);
  });

  return {
    doc() {
      return doc;
    },
    change(fn) {
      doc = Automerge.change(doc, fn);
    },
  };
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
