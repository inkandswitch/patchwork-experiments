/**
 * Immutable-string document encoding (docStrings.ts).
 *
 * Automerge's default string representation is collaborative Text: one op per
 * character. The runtime stores every document string as an ImmutableString
 * instead (single op, any length) — these tests pin the op economy, the
 * plain-string read boundary, reload, and compatibility with documents written
 * before the encoding existed.
 */
import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { DocString, isDocString, strVal, typeTag, wrapStoredVal } from './docStrings';
import { createLivelymergeRuntime } from './livelymergeRuntime';
import { createAutomergeTestDocHandle, roundTripDocHandle } from './testDocHandle';

function opsDuring(handle: ReturnType<typeof createAutomergeTestDocHandle>, act: () => void) {
  const before = Automerge.getHeads(handle.doc() as any);
  act();
  const changes = Automerge.getChanges(
    Automerge.view(handle.doc() as any, before) as any,
    handle.doc() as any,
  );
  let count = 0;
  for (const ch of changes) count += Automerge.decodeChange(ch).ops.length;
  return count;
}

describe('docStrings helpers', () => {
  it('wrapStoredVal wraps strings and ref/accessor internals, passes leaves through', () => {
    expect(isDocString(wrapStoredVal('hi'))).toBe(true);
    expect(strVal(wrapStoredVal('hi'))).toBe('hi');
    expect(wrapStoredVal(42)).toBe(42);
    expect(wrapStoredVal(null)).toBe(null);

    const ref = wrapStoredVal({ $type: 'ref', $id: 'x' });
    expect(typeTag(ref)).toBe('ref');
    expect(isDocString(ref.$id)).toBe(true);
    expect(strVal(ref.$id)).toBe('x');

    const acc = wrapStoredVal({ $type: 'accessor', $get: { $type: 'ref', $id: 'g' } });
    expect(typeTag(acc)).toBe('accessor');
    expect(strVal(acc.$get.$id)).toBe('g');

    // Plain-JSON leaves are stored verbatim (their nested strings stay Text).
    const leaf = { parts: ['a', 'b'] };
    expect(wrapStoredVal(leaf)).toBe(leaf);
  });

  it('typeTag and strVal accept both encodings', () => {
    expect(typeTag({ $type: 'obj' })).toBe('obj');
    expect(typeTag({ $type: new DocString('obj') })).toBe('obj');
    expect(strVal('plain')).toBe('plain');
    expect(strVal(new DocString('wrapped'))).toBe('wrapped');
  });
});

describe('immutable-string encoding in the document', () => {
  it('a string property write costs one op regardless of length', () => {
    const handle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(handle);
    rt.eval('$global.o = {}');

    const longString = 'x'.repeat(200);
    const ops = opsDuring(handle, () => rt.eval(`$global.o.s = '${longString}'`));
    expect(ops).toBe(1);

    // ...and reads come back as a plain JS string.
    expect(rt.eval('$global.o.s')).toBe(longString);
    expect(rt.eval('$global.o.s.length')).toBe(200);
  });

  it('promoting an object costs ops per field, not per character', () => {
    const handle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(handle);
    rt.eval('1'); // warm-up: ensureHeapRoots installs the JS-global stand-ins once
    // Entry ({$type, $id, $protoId, @a, @name} = makeMap + 5) + the @p ref on
    // global (makeMap + 2). Under the text encoding the ids alone were ~40 ops.
    const ops = opsDuring(handle, () => rt.eval(`$global.p = { a: 1, name: 'hello world' }`));
    expect(ops).toBe(9);
  });

  it('raw document entries hold immutable strings; materialized reads are plain', () => {
    const handle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(handle);
    rt.eval(`$global.q = { tag: 'colored' }`);
    const id = rt.eval('$global.q.$id') as string;
    const raw = handle.doc().objectTable[id] as Record<string, any>;
    expect(isDocString(raw.$type)).toBe(true);
    expect(strVal(raw.$type)).toBe('obj');
    expect(isDocString(raw.$id)).toBe(true);
    expect(isDocString(raw['@tag'])).toBe(true);
    expect(rt.eval('$global.q.tag')).toBe('colored');
  });

  it('functions (code, scopes, prototypes) survive save/load', () => {
    const handle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(handle);
    rt.eval(`
      $global.makeCounter = function (start) {
        let n = start;
        return function () { n = n + 1; return n; };
      };
      $global.c = $global.makeCounter(10);
      $global.c();
    `);
    expect(rt.eval('$global.c()')).toBe(12);

    const reloaded = roundTripDocHandle(handle);
    const rt2 = createLivelymergeRuntime(reloaded);
    expect(rt2.eval('$global.c()')).toBe(13);
    expect(rt2.eval('$global.makeCounter(100)()')).toBe(101);
  });

  it('documents written in the old (text) encoding still read and write', () => {
    const handle = createAutomergeTestDocHandle();
    // A legacy entry, written with plain strings (Automerge Text encoding),
    // linked from global — as an old build of the runtime would have left it.
    handle.change((d: any) => {
      d.objectTable['legacy-obj'] = {
        $type: 'obj',
        $id: 'legacy-obj',
        $protoId: 'object-prototype',
        '@msg': 'hello from the past',
      };
      d.objectTable['global']['@legacy'] = { $type: 'ref', $id: 'legacy-obj' };
    });
    const rt = createLivelymergeRuntime(handle);
    expect(rt.eval('$global.legacy.msg')).toBe('hello from the past');

    // Writes onto the legacy entry use the new encoding; reads stay plain.
    rt.eval(`$global.legacy.msg = 'updated'`);
    expect(rt.eval('$global.legacy.msg')).toBe('updated');
    const raw = handle.doc().objectTable['legacy-obj'] as Record<string, any>;
    expect(isDocString(raw['@msg'])).toBe(true);
    expect(strVal(raw.$type)).toBe('obj'); // untouched field keeps the old encoding
    expect(isDocString(raw.$type)).toBe(false);
  });
});
