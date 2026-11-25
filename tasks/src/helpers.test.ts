import { describe, expect, it } from 'vitest';
import { getTaskQueues, isOnTaskQueue, joinTaskQueue, leaveTaskQueue, setAcceptance, getAcceptance } from './helpers';

const one = 'automerge:one' as any;
const other = 'automerge:other' as any;

describe("an account's task queues", () => {
  it('serves nothing until it joins a queue', () => {
    expect(getTaskQueues({})).toEqual({});
    expect(isOnTaskQueue({}, one)).toBe(false);
  });

  it('copes with an account that has not loaded', () => {
    expect(getTaskQueues(undefined)).toEqual({});
  });

  it('joins and leaves without disturbing the rest of its list', () => {
    const account: any = {};
    joinTaskQueue(account, one);
    joinTaskQueue(account, other);
    leaveTaskQueue(account, one);
    expect(getTaskQueues(account)).toEqual({ [other]: true });
  });

  it('makes nothing of joining twice, or of leaving a queue it was never on', () => {
    const account: any = {};
    joinTaskQueue(account, one);
    joinTaskQueue(account, one);
    leaveTaskQueue(account, other);
    expect(getTaskQueues(account)).toEqual({ [one]: true });
  });

  it('keeps whose code it runs from each queue', () => {
    const account: any = {};
    setAcceptance(account, one, ['automerge:pkg']);
    joinTaskQueue(account, one);
    expect(getAcceptance(account, one)).toEqual(['automerge:pkg']);
    setAcceptance(account, one, 'any');
    expect(getAcceptance(account, one)).toBe('any');
    expect(getAcceptance(account, other)).toBeUndefined();
  });
});
