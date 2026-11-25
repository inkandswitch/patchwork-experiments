// The served list and one's own queue, in the task system's tool storage
// document: the readers in task-client.js and the writers in helpers.ts. Each
// writer is called as it would be inside a change to that document.

import { describe, expect, it } from 'vitest';
import {
  getAcceptance,
  getAccountDocUrl,
  getTaskQueues,
  isOnTaskQueue,
  joinTaskQueue,
  leaveTaskQueue,
  setAcceptance,
} from './helpers';
import { QUEUE_DATATYPE_ID, TASKS_STORAGE_ID } from './ids';
import { ownQueueOf, servedOf, storageUrlOf } from './task-client.js';

const one = 'automerge:one' as any;
const other = 'automerge:other' as any;
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

  it('ignores the field an earlier version kept on the account itself', () => {
    expect(storageUrlOf({ __servedQueues__: { [one]: true } })).toBeNull();
  });
});

describe('the served list', () => {
  it('serves nothing without a storage document, or one that lists nothing', () => {
    for (const storage of [undefined, null, {}, { served: null }, { served: [] }, { served: 'x' }]) {
      expect(getTaskQueues(storage)).toEqual({});
      expect(servedOf(storage)).toEqual({});
      expect(isOnTaskQueue(storage, one)).toBe(false);
    }
  });

  it('a queue whose setting is neither true nor a package list is not served', () => {
    const storage = { served: { [one]: false, [other]: { packages: 'x' } } };
    expect(isOnTaskQueue(storage, one)).toBe(false);
    expect(isOnTaskQueue(storage, other)).toBe(false);
    expect(getAcceptance(storage, one)).toBeUndefined();
  });

  it('joining makes the list the first time, and lists the queue for any code', () => {
    const storage: any = {};
    joinTaskQueue(storage, one);
    expect(storage).toEqual({ served: { [one]: true } });
    expect(isOnTaskQueue(storage, one)).toBe(true);
    expect(getAcceptance(storage, one)).toBe('any');
  });

  it('joins and leaves without disturbing the rest of the list, or `own`', () => {
    const storage: any = { own: other };
    joinTaskQueue(storage, one);
    joinTaskQueue(storage, other);
    leaveTaskQueue(storage, one);
    expect(storage).toEqual({ own: other, served: { [other]: true } });
    expect(ownQueueOf(storage)).toBe(other);
  });

  it('makes nothing of joining twice, of leaving a queue it does not serve, or of leaving with no list', () => {
    const storage: any = {};
    leaveTaskQueue(storage, one);
    expect(storage).toEqual({});
    joinTaskQueue(storage, one);
    joinTaskQueue(storage, one);
    leaveTaskQueue(storage, other);
    expect(storage).toEqual({ served: { [one]: true } });
  });

  it('joining a queue already served for named packages keeps that narrowing', () => {
    const storage: any = {};
    setAcceptance(storage, one, ['automerge:pkg']);
    joinTaskQueue(storage, one);
    expect(getAcceptance(storage, one)).toEqual(['automerge:pkg']);
  });

  it('keeps whose code it runs from each queue, and setting it serves the queue', () => {
    const storage: any = {};
    setAcceptance(storage, one, ['automerge:pkg']);
    expect(storage.served[one]).toEqual({ packages: ['automerge:pkg'] });
    expect(isOnTaskQueue(storage, one)).toBe(true);
    setAcceptance(storage, one, 'any');
    expect(storage.served[one]).toBe(true);
    expect(getAcceptance(storage, one)).toBe('any');
    expect(getAcceptance(storage, other)).toBeUndefined();
  });

  it('a list that is not a map is replaced by one when written', () => {
    const storage: any = { served: ['junk'] };
    joinTaskQueue(storage, one);
    expect(storage.served).toEqual({ [one]: true });
  });

  it("counts only the list's own keys", () => {
    const served = Object.create({ [one]: true });
    expect(isOnTaskQueue({ served }, one)).toBe(false);
    expect(getTaskQueues({ served })).toEqual({});
  });
});

describe('one\'s own queue', () => {
  it('is what `own` names, when that is an automerge url', () => {
    expect(ownQueueOf({ own: one })).toBe(one);
    for (const storage of [undefined, null, {}, { own: null }, { own: 7 }, { own: 'elsewhere' }]) {
      expect(ownQueueOf(storage)).toBeNull();
    }
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
