// @vitest-environment node
//
// A run thread's Repo (webworker-lib.node.ts) over a worker_threads
// MessageChannel to a host's Repo, as host.ts joins them: it has no storage
// and one network adapter, the pipe; what it asks for comes from the host's
// Repo, and what it writes reaches it.

import { Repo, initSubduction } from '@automerge/automerge-repo-node';
import type { Repo as SlimRepo } from '@automerge/automerge-repo/slim';
import { expect, it } from 'vitest';
import { pipe } from '../pipe';
import { getRepo } from './webworker-lib.node';

await initSubduction();

const until = async (done: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
  return done();
};

it("has no storage and only the pipe, and reads and writes through the host's Repo", async () => {
  const host = new Repo({ network: [] } as any);
  const there = host.create({ n: 1 });
  const { port1, port2 } = new MessageChannel();
  const unpipe = pipe(host as any, port1 as unknown as MessagePort);
  const thread: SlimRepo = await getRepo('task-worker-run-1', port2 as unknown as MessagePort);

  expect((thread as any).storageSubsystem).toBeUndefined();
  expect((thread as any).networkSubsystem.adapters).toHaveLength(1);

  expect(await until(() => thread.peers.length === 1)).toBe(true);
  expect(Object.keys(thread.handles)).toEqual([]);
  const found = await thread.find<{ n: number }>(there.url);
  expect(found.doc().n).toBe(1);
  const made = thread.create({ by: 'thread' });
  expect((await host.find<{ by: string }>(made.url)).doc().by).toBe('thread');

  unpipe();
});
