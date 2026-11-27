// The served queues and one's own queue, in the task system's tool storage
// document: the readers and the one writer in task-client.js, and helpers.ts
// on top of them. Each writer is called on a plain object, as it would be
// inside a change to that document; task-client.test.ts has them on real
// documents changed at once on two replicas.

import { describe, expect, it } from 'vitest';
import {
  getAccountDocUrl,
  getTaskQueues,
  isOnTaskQueue,
  joinTaskQueue,
  leaveTaskQueue,
} from './helpers';
import { QUEUE_DATATYPE_ID, TASKS_STORAGE_ID } from './ids';
import { ownQueueOf, servedOf, setServed, storageUrlOf } from './task-client.js';

// queues are named by documents' urls, and only a key of that shape is read as one
const one = 'automerge:3Fm8QhPjBbiN2wZxkT6sUoYvLa1d' as any;
const other = 'automerge:4Gn9RiQkCcjP3xAymU7tVpZwMb2e' as any;
const STORAGE = 'automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P';

describe("where an account's task storage is", () => {
  it("is the account's toolStorage entry under the task system's own tool id", () => {
    expect(TASKS_STORAGE_ID).toBe('tasks-next');
    expect(QUEUE_DATATYPE_ID).toBe('task-queue-next');
    expect(storageUrlOf({ toolStorage: { [TASKS_STORAGE_ID]: STORAGE, other: 'automerge:x' } })).toBe(STORAGE);
  });

  it('is nowhere for an account that has not loaded, has no toolStorage, or names none for this tool', () => {
    for (const account of [undefined, null, {}, { toolStorage: null }, { toolStorage: {} }, { toolStorage: { other: STORAGE } }]) {
      expect(storageUrlOf(account)).toBeNull();
    }
  });

  it('is nowhere when what the account names is no automerge url, or is inherited rather than its own', () => {
    for (const named of [42, '', 'https://example.com', { url: STORAGE }]) {
      expect(storageUrlOf({ toolStorage: { [TASKS_STORAGE_ID]: named } })).toBeNull();
    }
    expect(storageUrlOf({ toolStorage: Object.create({ [TASKS_STORAGE_ID]: STORAGE }) })).toBeNull();
  });

  it('reads nothing off the account but its tool storage', () => {
    expect(storageUrlOf({ __servedQueues__: { [one]: true } })).toBeNull();
  });
});

describe('the served list', () => {
  it('serves nothing without a storage document, or one that names no queue', () => {
    for (const storage of [undefined, null, 'x', 7, {}, [], { '@patchwork': { type: 'patchwork:tool-storage' } }]) {
      expect(getTaskQueues(storage)).toEqual({});
      expect(servedOf(storage)).toEqual({});
      expect(isOnTaskQueue(storage, one)).toBe(false);
    }
  });

  it('keys on the document that are not queue urls are never read as served, whatever they hold', () => {
    // `__proto__` as a key of the document's own, as a document read from JSON can have it
    const storage = Object.assign(JSON.parse('{"__proto__": true}'), {
      '@patchwork': { type: 'patchwork:tool-storage' },
      own: one,
      served: { [other]: true },
      other: true,
      'Automerge:x': true,
      ' automerge:x': true,
      [one]: true,
    });
    expect(Object.hasOwn(storage, '__proto__')).toBe(true);
    expect(servedOf(storage)).toEqual({ [one]: true });
    expect(getTaskQueues(storage)).toEqual({ [one]: true });
    expect(isOnTaskQueue(storage, other)).toBe(false);
    expect(isOnTaskQueue(storage, 'own' as any)).toBe(false);
  });

  it("counts only the document's own keys", () => {
    const storage = Object.create({ [one]: true });
    expect(servedOf(storage)).toEqual({});
    expect(isOnTaskQueue(storage, one)).toBe(false);
  });

  it('a queue is served under any truthy setting, an old { packages } one included, and not under a falsy one', () => {
    const storage = { [one]: false, [other]: { packages: ['automerge:pkg'] } };
    expect(isOnTaskQueue(storage, one)).toBe(false);
    expect(isOnTaskQueue(storage, other)).toBe(true);
    expect(getTaskQueues(storage)).toEqual({ [other]: true });
  });

  it("joining writes the queue's own key, and nothing else", () => {
    const storage: any = { '@patchwork': { type: 'patchwork:tool-storage' } };
    joinTaskQueue(storage, one);
    expect(storage).toEqual({ '@patchwork': { type: 'patchwork:tool-storage' }, [one]: true });
    expect(isOnTaskQueue(storage, one)).toBe(true);
  });

  it('joins and leaves without disturbing the other queues, or `own`', () => {
    const storage: any = { own: other };
    joinTaskQueue(storage, one);
    joinTaskQueue(storage, other);
    leaveTaskQueue(storage, one);
    expect(storage).toEqual({ own: other, [other]: true });
    expect(ownQueueOf(storage)).toBe(other);
  });

  it('makes nothing of joining twice, or of leaving a queue it does not serve', () => {
    const storage: any = {};
    leaveTaskQueue(storage, one);
    expect(storage).toEqual({});
    joinTaskQueue(storage, one);
    joinTaskQueue(storage, one);
    leaveTaskQueue(storage, other);
    expect(storage).toEqual({ [one]: true });
  });

  it('joining a queue already served under an old { packages } setting leaves it as it is', () => {
    const storage: any = { [one]: { packages: ['automerge:pkg'] } };
    joinTaskQueue(storage, one);
    expect(storage).toEqual({ [one]: { packages: ['automerge:pkg'] } });
  });

  it('never writes a key that is not a queue url', () => {
    for (const key of ['own', '@patchwork', 'served', '__proto__', '', 'https://example.com']) {
      const storage: any = { own: one };
      expect(() => setServed(storage, key, true)).toThrow();
      expect(() => joinTaskQueue(storage, key as any)).toThrow();
      expect(() => leaveTaskQueue(storage, key as any)).toThrow();
      expect(storage).toEqual({ own: one });
    }
  });
});

describe("one's own queue", () => {
  it('is what `own` names, when that is an automerge url', () => {
    expect(ownQueueOf({ own: one })).toBe(one);
    for (const storage of [undefined, null, {}, { own: null }, { own: 7 }, { own: 'elsewhere' }, Object.create({ own: one })]) {
      expect(ownQueueOf(storage)).toBeNull();
    }
  });

  it('is not a served queue for being named: only its own key serves it', () => {
    expect(servedOf({ own: one })).toEqual({});
  });
});

describe('the account open on the page', () => {
  it("is the one whose handle the site sets, before anything else that says so", () => {
    const g = globalThis as any;
    localStorage.setItem('tinyPatchworkAccountUrl', 'automerge:fromStorage');
    try {
      expect(getAccountDocUrl()).toBe('automerge:fromStorage');
      g.accountDocHandle = { url: 'automerge:fromHandle' };
      expect(getAccountDocUrl()).toBe('automerge:fromHandle');
    } finally {
      delete g.accountDocHandle;
      localStorage.removeItem('tinyPatchworkAccountUrl');
    }
  });
});
