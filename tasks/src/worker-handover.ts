// The tab's side of moving to a newer build (see version.ts): starting this
// browser's task workers, and switching to a newer build's when one turns up.

import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { WorkerPoolProxy } from './worker-pool-proxy';
import {
  BUILD,
  decideHandover,
  START_PROTOCOL,
  VERSION_CHANNEL,
  type Release,
} from './version';

import poolScript from './worker-pool.ts?sharedworker&url';
import routerScript from './router.ts?sharedworker&url';
import workerScript from './worker.ts?sharedworker&url';

const absolute = (url: string) => new URL(url, import.meta.url).href;

/** The workers that come with this copy of the package. */
const OWN_RELEASE: Release = {
  build: BUILD,
  startProtocol: START_PROTOCOL,
  scripts: {
    pool: absolute(poolScript),
    router: absolute(routerScript),
    worker: absolute(workerScript),
  },
};

/** Fired on `window` when this tab can't follow a newer build without a reload. */
export const NEEDS_RELOAD_EVENT = 'patchwork-tasks-needs-reload';

type Announcement = { type: 'release'; release: Release } | { type: 'who' };

/** What this tab is running. */
interface Running {
  release: Release;
  contactUrl: AutomergeUrl;
  proxy: WorkerPoolProxy;
  /**
   * The build of the copy of this package whose code made `proxy`. Not always
   * the workers' build: a tab starts a newer build's workers with whatever
   * copy of the package it has. Missing where a copy from before this made it.
   */
  madeBy?: number;
  /** Stops announcing it and listening for others. */
  stop(): void;
}

// On `window`, because more than one copy of this package can be at work in a
// tab: the host loads a newer one beside the old without a reload. Whichever
// copy runs next must find what the last one started.
const tab = window as any;
const running = (): Running | undefined => tab.patchworkTasks?.workers;

/**
 * Sees to it that this browser's task workers are running, for this user.
 *
 * Called whenever the badge mounts, which is often: a title bar tool is mounted
 * afresh for every document. Most calls find the workers already running and
 * do nothing. The ones that matter are the first in a tab, and the first by a
 * newer copy of the package than the one whose workers are running, which
 * takes over from it.
 */
export async function ensureWorkers(contactUrl: AutomergeUrl) {
  const current = running();
  if (current?.contactUrl === contactUrl) {
    if (decideHandover(current.release, OWN_RELEASE) === 'adopt') {
      start(OWN_RELEASE, contactUrl);
    } else if ((current.madeBy ?? 0) < BUILD && current.release.startProtocol === START_PROTOCOL) {
      // The workers are as new as this copy's (another tab's word brought this
      // tab to them), but what speaks to them here was made by an older copy
      // of the package, which doesn't tell them everything this one does: which
      // job handlers the registry holds, for one. Made again by this copy, it
      // joins the same workers and tells them.
      start(current.release, contactUrl);
    }
    return;
  }

  // First time in this tab. Other tabs may already be on a newer build than
  // this copy of the package (a tab can be handed an old copy from a cache), so
  // ask before starting anything: starting the older workers only for them to
  // step down a moment later would be a waste of four workers' start-up.
  start(await newestOf(OWN_RELEASE), contactUrl);
}

/** `mine`, or a newer release that another tab says it's running and this tab can start. */
function newestOf(mine: Release) {
  return new Promise<Release>((resolve) => {
    let newest = mine;
    const channel = new BroadcastChannel(VERSION_CHANNEL);
    channel.onmessage = ({ data }: MessageEvent<Announcement>) => {
      if (data?.type === 'release' && decideHandover(newest, data.release) === 'adopt') {
        newest = data.release;
      }
    };
    channel.postMessage({ type: 'who' } satisfies Announcement);
    setTimeout(() => {
      channel.close();
      resolve(newest);
    }, 250);
  });
}

function start(release: Release, contactUrl: AutomergeUrl) {
  const previous = running();
  previous?.stop();
  previous?.proxy.dispose();

  // Workers of an older build don't need telling: they step down by themselves
  // when they hear the newer pool (see retire.ts).
  const proxy = new WorkerPoolProxy(contactUrl, release.scripts, importMap(), document.baseURI);
  console.log('tasks: running the workers of build', release.build, proxy);

  const channel = new BroadcastChannel(VERSION_CHANNEL);
  const announce = () => channel.postMessage({ type: 'release', release } satisfies Announcement);
  channel.onmessage = ({ data }: MessageEvent<Announcement>) => {
    if (data?.type === 'who') {
      announce();
    } else if (data?.type === 'release') {
      consider(data.release);
    }
  };
  // now, and every so often for a tab that wasn't listening yet
  const timer = setInterval(announce, 5_000);
  announce();

  tab.patchworkTasks ??= {};
  tab.patchworkTasks.workers = {
    release,
    contactUrl,
    proxy,
    madeBy: BUILD,
    stop() {
      clearInterval(timer);
      channel.close();
    },
  } satisfies Running;
}

/** Another tab says it's running `offered`. */
function consider(offered: Release) {
  const current = running();
  if (!current) {
    return;
  }
  switch (decideHandover(current.release, offered)) {
    case 'adopt':
      start(offered, current.contactUrl);
      break;
    case 'reload':
      // This tab's workers will step down for the newer ones, and this copy of
      // the package doesn't know how to start those. Only a reload does.
      tab.patchworkTasks.needsReload = true;
      window.dispatchEvent(new Event(NEEDS_RELOAD_EVENT));
      break;
  }
}

/** Whether this tab has to be reloaded to rejoin this browser's task workers. */
export const needsReload = (): boolean => !!tab.patchworkTasks?.needsReload;

function importMap() {
  const importMapElement = document.querySelector('script[type="importmap"]');
  if (!importMapElement) {
    return {};
  }

  try {
    return JSON.parse(importMapElement.textContent || '{}');
  } catch (e) {
    console.warn('Failed to parse import map:', e);
    return {};
  }
}
