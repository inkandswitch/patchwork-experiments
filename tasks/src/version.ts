// Moving a browser on to a newer build of this package without anyone having
// to reload.
//
// A shared worker is found by its script's url and its name, and the url
// changes with every build. So a newer build doesn't replace the workers that
// are running: it starts workers of its own beside them, and the old ones live
// on for as long as any tab that started them stays open. Two things put that
// right.
//
// Tabs tell each other which build's workers they are running (a `Release`,
// on VERSION_CHANNEL). A tab that hears of a newer one switches to it: it has
// the scripts' urls from the announcement, so it doesn't need the newer build's
// own code to start them. See worker-handover.ts.
//
// And workers step down for newer ones. A pool says which build it is every
// time it reports its status, and the pool, router and workers of an older
// build that hear it finish what they're doing and close. See retire.ts.

declare const __TASKS_BUILD__: number | undefined;

/**
 * When this copy of the package was built, in milliseconds since 1970: of two
 * builds, the one with the larger number is the newer. 0 where nothing stamped
 * it (the tests).
 */
export const BUILD: number = typeof __TASKS_BUILD__ === 'number' ? __TASKS_BUILD__ : 0;

/**
 * What a tab says to the shared workers to get them going. Raised whenever
 * that changes in a way an older tab couldn't follow, which is what stops such
 * a tab from trying to start a newer build's workers.
 */
export const START_PROTOCOL = 1;

/** BroadcastChannel on which this origin's tabs tell each other what they're running. */
export const VERSION_CHANNEL = 'patchwork-tasks-version';

/** Where a build's shared worker scripts are. */
export interface WorkerScripts {
  pool: string;
  router: string;
  worker: string;
}

/** One build's workers, described well enough for any tab to start them. */
export interface Release {
  build: number;
  startProtocol: number;
  scripts: WorkerScripts;
}

/**
 * What a tab running `current` should do on hearing that `offered` is running
 * somewhere on this origin:
 *
 * - `keep`: it's no newer than what this tab has.
 * - `adopt`: it's newer, and this tab knows how to start it.
 * - `reload`: it's newer, but only its own code knows how to start it. This
 *   tab's workers will have stepped down for it, so the tab should say that it
 *   needs reloading.
 */
export function decideHandover(
  current: Release,
  offered: Release,
  startProtocol = START_PROTOCOL,
): 'keep' | 'adopt' | 'reload' {
  if (!(offered.build > current.build)) {
    return 'keep';
  }
  return offered.startProtocol === startProtocol ? 'adopt' : 'reload';
}
