import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_QUEUE_URL,
  getTaskQueues,
  isOnTaskQueue,
  joinTaskQueue,
  leaveTaskQueue,
} from './helpers';

const other = 'automerge:other' as any;
const third = 'automerge:third' as any;

describe("an account's task queues", () => {
  it('is on the default queue until it says otherwise', () => {
    const account = {};
    expect(getTaskQueues(account)).toEqual({ [DEFAULT_TASK_QUEUE_URL]: true });
    expect(isOnTaskQueue(account, DEFAULT_TASK_QUEUE_URL)).toBe(true);
    expect(isOnTaskQueue(account, other)).toBe(false);
  });

  it('stays on the default queue when it joins another', () => {
    const account: any = {};
    joinTaskQueue(account, other);
    expect(isOnTaskQueue(account, other)).toBe(true);
    expect(isOnTaskQueue(account, DEFAULT_TASK_QUEUE_URL)).toBe(true);
  });

  it('can leave the default queue, and is then on none', () => {
    const account: any = {};
    leaveTaskQueue(account, DEFAULT_TASK_QUEUE_URL);
    expect(getTaskQueues(account)).toEqual({});
    expect(isOnTaskQueue(account, DEFAULT_TASK_QUEUE_URL)).toBe(false);
  });

  it("doesn't come back to the default queue after leaving it and joining another", () => {
    const account: any = {};
    leaveTaskQueue(account, DEFAULT_TASK_QUEUE_URL);
    joinTaskQueue(account, other);
    expect(getTaskQueues(account)).toEqual({ [other]: true });
  });

  it('joins and leaves without disturbing the rest of its list', () => {
    const account: any = {};
    joinTaskQueue(account, other);
    joinTaskQueue(account, third);
    leaveTaskQueue(account, other);
    expect(isOnTaskQueue(account, other)).toBe(false);
    expect(isOnTaskQueue(account, third)).toBe(true);
    expect(isOnTaskQueue(account, DEFAULT_TASK_QUEUE_URL)).toBe(true);
  });

  it('makes nothing of joining twice, or of leaving a queue it was never on', () => {
    const account: any = {};
    joinTaskQueue(account, other);
    joinTaskQueue(account, other);
    leaveTaskQueue(account, third);
    expect(getTaskQueues(account)).toEqual({ [DEFAULT_TASK_QUEUE_URL]: true, [other]: true });
  });

  it('copes with an account that has not loaded', () => {
    expect(getTaskQueues(undefined)).toEqual({ [DEFAULT_TASK_QUEUE_URL]: true });
  });
});
