// @vitest-environment node
//
// The pipe (pool-host.ts), with real Repos and no network: a page's Repo of
// the site's version and a worker's, joined only by a MessageChannel. The
// page offers the worker nothing; what the worker asks for reaches it, and
// what it writes reaches the page; taken out, the pipe carries nothing more.

import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { Repo as SiteRepo, initSubduction } from 'site-automerge-repo';
import { expect, it } from 'vitest';
import { WORKER_PEER } from '../ids';
import { pipe } from './pool-host';

await initSubduction();

const until = async (done: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
  return done();
};

it("joins a page's Repo and a worker's: nothing offered, what is asked and what is written crosses, and nothing once it is taken out", async () => {
  const page = new SiteRepo({ peerId: 'page' } as any);
  const open = page.create({ n: 1 });
  page.create({ other: true });
  const { port1, port2 } = new MessageChannel();
  const unpipe = pipe(page as any, port1);
  const worker = new SiteRepo({ peerId: `${WORKER_PEER}run-1`, network: [new MessageChannelNetworkAdapter(port2)] } as any);

  expect(await until(() => worker.peers.length === 1)).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(Object.keys(worker.handles)).toEqual([]);

  const asked = await worker.find<{ n: number }>(open.url);
  expect(asked.doc().n).toBe(1);
  const made = worker.create({ by: 'worker' });
  const atPage = await page.find<{ by: string }>(made.url);
  expect(atPage.doc().by).toBe('worker');
  asked.change((doc) => void (doc.n = 2));
  expect(await until(() => open.doc().n === 2)).toBe(true);

  unpipe();
  expect(await until(() => page.peers.length === 0)).toBe(true);
  open.change((doc) => void (doc.n = 3));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(asked.doc().n).toBe(2);
  port2.close();
});
