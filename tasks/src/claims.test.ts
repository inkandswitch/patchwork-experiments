import { describe, expect, it } from 'vitest';
import { assignmentId, claimIsSettled, CLAIM_TIMEOUT_MS, type Claim } from './claims';

const claim: Claim = { taskUrl: 'automerge:task', assignment: 'router#7', issuedAt: 1_000 };
// a worker that reports the hand-outs it finishes, and hasn't finished one yet
const idle = { docTaskUrl: null, heartbeatTaskUrl: null, lastFinished: null };
// a worker from before there was anything to report
const olderIdle = { docTaskUrl: null, heartbeatTaskUrl: null };
const justAfter = claim.issuedAt + 50;

describe('assignmentId', () => {
  it('tells two hand-outs of the same task apart', () => {
    expect(assignmentId({ from: 'router', seq: 7 })).toBe('router#7');
    expect(assignmentId({ from: 'router', seq: 7 })).not.toBe(
      assignmentId({ from: 'router', seq: 8 }),
    );
  });
});

describe('claimIsSettled', () => {
  it('holds while nothing has been heard and the timeout has not passed', () => {
    expect(claimIsSettled(claim, idle, justAfter)).toBe(false);
    expect(claimIsSettled(claim, idle, claim.issuedAt + CLAIM_TIMEOUT_MS)).toBe(false);
  });

  it('settles at once when the worker reports this hand-out finished', () => {
    expect(claimIsSettled(claim, { ...idle, lastFinished: { assignment: 'router#7', done: true } }, justAfter)).toBe(true);
  });

  it("doesn't mistake an earlier hand-out of the same task for this one", () => {
    // the worker failed this task a moment ago, as hand-out 6, and was given it again
    expect(claimIsSettled(claim, { ...idle, lastFinished: { assignment: 'router#6', done: false } }, justAfter)).toBe(false);
  });

  it('holds while the worker is running the task, until it says it has finished', () => {
    const later = claim.issuedAt + 10 * 60_000;
    expect(claimIsSettled(claim, { ...idle, docTaskUrl: claim.taskUrl }, later)).toBe(false);
    expect(claimIsSettled(claim, { ...idle, heartbeatTaskUrl: claim.taskUrl }, later)).toBe(false);
    const finished = { ...idle, lastFinished: { assignment: 'router#7', done: true } };
    expect(claimIsSettled(claim, finished, later)).toBe(true);
  });

  it('settles as soon as an older worker, which never says it has finished, is seen running it', () => {
    expect(claimIsSettled(claim, { ...olderIdle, docTaskUrl: claim.taskUrl }, justAfter)).toBe(
      true,
    );
    expect(
      claimIsSettled(claim, { ...olderIdle, heartbeatTaskUrl: claim.taskUrl }, justAfter),
    ).toBe(true);
  });

  it('gives up on a hand-out that was never heard of again', () => {
    expect(claimIsSettled(claim, idle, claim.issuedAt + CLAIM_TIMEOUT_MS + 1)).toBe(true);
  });

  it("doesn't give up while the worker is busy with something else", () => {
    const busyElsewhere = { ...idle, docTaskUrl: 'automerge:other' };
    expect(claimIsSettled(claim, busyElsewhere, claim.issuedAt + 60_000)).toBe(false);
  });
});
