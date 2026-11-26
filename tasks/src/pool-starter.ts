import type { Repo } from '@automerge/automerge-repo/slim';
import { startPoolHost } from './browser/pool-host';
import { ownQueue } from './task-client.js';

/**
 * The component that puts this page in the browser's pool, and draws
 * nothing. Frames mount every component tagged `background` once, for as
 * long as they show (see index.ts), and a page that asks for work mounts it
 * if nothing has (`joinPool` in task-client.js), so a page serves its
 * person's queues wherever such a frame is, whatever else is on screen; the
 * badge and the queue browser only show what it is doing. Mounted, it also
 * asks for the person's own queue, which makes it if there is none, so that
 * the pool has it to serve; that asks the frame's tool-storage provider from
 * this element, and a failure is said in the console. Letting it go lets go
 * of the page's hold on the pool (see pool-host.ts).
 */
export const PoolStarter = (element: HTMLElement, repo?: Repo) => {
  const hostRepo = repo ?? (element as any).repo ?? (window as any).repo;
  const letGo = startPoolHost(hostRepo);
  if (hostRepo) {
    ownQueue(hostRepo, element).catch((error: Error) =>
      console.warn(`tasks: no queue of your own could be had here: ${error?.message ?? error}`),
    );
  }
  return letGo;
};
