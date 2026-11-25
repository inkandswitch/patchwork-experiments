// What code a pool will run.
//
// A task says where its code is (import-url.ts), and whoever can write a
// queue can put any task in it. So lending a queue your workers is a decision
// about whose code runs on your computer, and it is made queue by queue:
//
// - `any`: whatever the queue's tasks bring. Right for a queue only you write
//   to, where the code is yours, `data:` URLs and all. On a queue you share,
//   it trusts everyone who can write the queue.
// - a list of packages: only code that is in one of those packages, at any
//   version. A `data:` URL is in none, so it is never run.
//
// A pool checks a queue entry's package before it opens the task, and the
// task's own `importUrl` before it takes it; the run worker is handed the
// string it checked.

import { packageOf } from './import-url';

/** What a pool runs from one queue. */
export type Acceptance = 'any' | readonly string[];

/**
 * How a queue is listed among those an account's browsers work on. `true` is
 * what it has always been, and means what it always has: any code.
 */
export type QueueSetting = true | { packages: string[] };

/** The acceptance a queue's setting amounts to; undefined for no setting at all (not working on it). */
export function acceptanceOf(setting: unknown): Acceptance | undefined {
  if (setting === true) {
    return 'any';
  }
  const packages = (setting as { packages?: unknown } | null)?.packages;
  if (Array.isArray(packages)) {
    return packages.filter((url): url is string => typeof url === 'string');
  }
  return undefined;
}

/** Whether code at `importUrl` may run under this acceptance. */
export function accepts(acceptance: Acceptance | undefined, importUrl: string): boolean {
  if (acceptance === undefined) {
    return false;
  }
  if (acceptance === 'any') {
    return true;
  }
  const from = packageOf(importUrl);
  return from !== null && acceptance.includes(from);
}

/** The same question of a queue's entry, which names a task's package (or that it has none) but not its URL. */
export function acceptsPackage(acceptance: Acceptance | undefined, packageUrl: string | null): boolean {
  if (acceptance === undefined) {
    return false;
  }
  return acceptance === 'any' || (packageUrl !== null && acceptance.includes(packageUrl));
}
