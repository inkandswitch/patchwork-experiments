import type { Repo } from '@automerge/automerge-repo/slim';
import { startPoolHost } from './browser/pool-host';

/**
 * The component that puts this page in the browser's pool, and does nothing
 * else: it draws nothing. Frames mount every component tagged `background`
 * once, for as long as they show (see index.ts), so a page serves its
 * person's queues wherever such a frame is, whatever else is on screen; the
 * badge and the queue browser only show what it is doing. Letting it go lets
 * go of the page's hold on the pool (see pool-host.ts).
 */
export const PoolStarter = (element: HTMLElement, repo?: Repo) =>
  startPoolHost(repo ?? (element as any).repo ?? (window as any).repo);
