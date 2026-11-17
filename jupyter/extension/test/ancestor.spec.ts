import * as Automerge from '@automerge/automerge';
import { ancestorHolds, commonAncestor } from '../src/ancestor';

type Doc = { text: string; items: string[] };

describe('commonAncestor', () => {
  test('is theirs when ours builds on it', () => {
    const theirs = start();
    const ours = edit(Automerge.clone(theirs), doc => doc.items.push('ours'));
    expect(commonAncestor(Automerge, ours, theirs)).toEqual(Automerge.getHeads(theirs));
  });

  test('is ours when theirs builds on it', () => {
    const ours = start();
    const theirs = edit(Automerge.clone(ours), doc => doc.items.push('theirs'));
    expect(commonAncestor(Automerge, ours, theirs)).toEqual(Automerge.getHeads(ours));
  });

  test('is where they forked when both changed', () => {
    const base = start();
    const forked = Automerge.getHeads(base);
    const ours = edit(Automerge.clone(base), doc => doc.items.push('ours'));
    const theirs = edit(edit(Automerge.clone(base), doc => doc.items.push('theirs')), doc => doc.items.push('more'));
    const ancestor = commonAncestor(Automerge, ours, theirs);
    expect(ancestor).toEqual(forked);
    expect(commonAncestor(Automerge, theirs, ours)).toEqual(forked);
    expect(Automerge.view(ours, ancestor).items).toEqual(['a']);
    expect(Automerge.view(theirs, ancestor).items).toEqual(['a']);
  });

  test('takes in what was merged between the drafts since they forked', () => {
    const base = start();
    let ours = edit(Automerge.clone(base), doc => doc.items.push('ours'));
    let theirs = edit(Automerge.clone(base), doc => doc.items.push('theirs'));
    ours = Automerge.merge(ours, theirs);
    ours = edit(ours, doc => doc.items.push('ours again'));
    const shared = Automerge.getHeads(ours);
    theirs = edit(Automerge.merge(theirs, ours), doc => doc.items.push('theirs again'));
    ours = edit(ours, doc => doc.items.push('ours last'));
    const ancestor = commonAncestor(Automerge, ours, theirs);
    expect(ancestor).toEqual(expect.arrayContaining(shared));
    const now = Automerge.getHeads(theirs);
    expect(Automerge.diff(theirs, ancestor, now)).toEqual(Automerge.diff(theirs, shared, now));
    expect([...Automerge.view(ours, ancestor).items].sort()).toEqual(['a', 'ours', 'ours again', 'theirs']);
  });

  test('may name a shared change and its descendant, which view and diff take', () => {
    // Theirs builds on two points ours has, one an ancestor of the other.
    const base = start();
    const first = Automerge.getHeads(base);
    const shared = edit(Automerge.clone(base), doc => doc.items.push('shared'));
    const second = Automerge.getHeads(shared);
    const theirs = Automerge.merge(
      edit(Automerge.clone(base), doc => doc.items.push('t1')),
      edit(Automerge.clone(shared), doc => doc.items.push('t2'))
    );
    const ours = edit(Automerge.clone(shared), doc => doc.items.push('ours'));
    const ancestor = commonAncestor(Automerge, ours, theirs);
    expect(ancestor).toEqual([...first, ...second].sort());
    expect(Automerge.hasHeads(ours, ancestor)).toBe(true);
    expect(Automerge.hasHeads(theirs, ancestor)).toBe(true);
    expect(Automerge.view(ours, ancestor).items).toEqual(['a', 'shared']);
    expect(Automerge.view(theirs, ancestor).items).toEqual(['a', 'shared']);
    // The redundant heads behave like the minimal ones.
    const now = Automerge.getHeads(ours);
    expect(Automerge.diff(ours, ancestor, now)).toEqual(Automerge.diff(ours, second, now));
    expect(Automerge.diffPath(ours, ['items'], ancestor, now)).toEqual(Automerge.diffPath(ours, ['items'], second, now));
    expect(Automerge.diff(theirs, ancestor, Automerge.getHeads(theirs))).toEqual(
      Automerge.diff(theirs, second, Automerge.getHeads(theirs))
    );
  });

  test('is nothing for documents with no history in common', () => {
    const ours = start();
    const theirs = start();
    expect(commonAncestor(Automerge, ours, theirs)).toEqual([]);
  });
});

describe('ancestorHolds', () => {
  test('holds while ours only adds its own changes', () => {
    const base = start();
    const ours = edit(Automerge.clone(base), doc => doc.items.push('ours'));
    const theirs = edit(Automerge.clone(base), doc => doc.items.push('theirs'));
    const since = Automerge.getHeads(ours);
    expect(ancestorHolds(Automerge, edit(ours, doc => doc.items.push('more')), theirs, since)).toBe(true);
  });

  test("breaks when ours takes in theirs' changes", () => {
    const base = start();
    const ours = edit(Automerge.clone(base), doc => doc.items.push('ours'));
    const theirs = edit(Automerge.clone(base), doc => doc.items.push('theirs'));
    const since = Automerge.getHeads(ours);
    expect(ancestorHolds(Automerge, Automerge.merge(ours, theirs), theirs, since)).toBe(false);
  });

  test('breaks when ours is replaced with an unrelated document', () => {
    const ours = start();
    expect(ancestorHolds(Automerge, start(), ours, Automerge.getHeads(ours))).toBe(false);
  });
});

function start(): Automerge.Doc<Doc> {
  return Automerge.from<Doc>({ text: 'hello', items: ['a'] });
}

function edit(doc: Automerge.Doc<Doc>, change: (doc: Doc) => void): Automerge.Doc<Doc> {
  return Automerge.change(doc, change);
}

