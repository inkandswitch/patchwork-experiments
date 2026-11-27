// A pool's plugin registry. A pool is a headless Patchwork: the same
// documents, the same installed packages, the same plugin registry, and no
// DOM. Its workers cannot find out what is installed themselves (a worker has
// no account, and the link passes no protected document), so the realm that
// knows sends them its registry: the page that holds the pool (core fills its
// registry), or a Node host's main thread (which runs core's ModuleWatcher
// itself, node/host.ts).
//
// What crosses is a snapshot: every plugin of every registry type, as its
// plain description, with `importUrl`, the url (pinned to heads) of the
// package it is imported from. It is sent whole, at a worker's start and again
// whenever it changes, never as a list of edits. A worker makes its own
// registry agree with the latest it has (`mirror`) and gives each plugin a
// load() that imports its package in that worker, as core's page does with
// what its discovery worker sends (bootloader/src/module-loader.ts). Task
// code then writes what page code writes: `getRegistry(type).load(id)`.
//
// A plugin whose code needs the DOM is listed like any other, and fails only
// when something in a worker loads it.

import type { PluginRegistry } from '@inkandswitch/patchwork-plugins';

/** A plugin as it crosses between realms: its description, and the url, pinned to heads, its package is imported from. */
export type Description = { type: string; id: string; importUrl: string } & Record<string, unknown>;

/** Every plugin of a realm's registry that another realm can load. */
export type Snapshot = Description[];

/** The registry module's way to every registry type there is. */
interface Registries {
  getAllRegistries(): Map<string, PluginRegistry<any>>;
}

/** The plugins of `plugins`' registries that came from a package kept in automerge, as plain descriptions. */
export function snapshotOf(plugins: Registries): Snapshot {
  const snapshot: Snapshot = [];
  for (const [type, registry] of plugins.getAllRegistries()) {
    for (const plugin of registry.all()) {
      if (typeof plugin.importUrl !== 'string' || !plugin.importUrl.startsWith('automerge:')) {
        continue;
      }
      const { load: _load, import: _import, module: _module, ...description } = plugin;
      try {
        snapshot.push({ ...JSON.parse(JSON.stringify(description)), type, id: plugin.id });
      } catch {
        // a description that cannot be written down cannot cross
      }
    }
  }
  return snapshot;
}

/**
 * Calls `send` with the snapshot of `plugins`' registries now, and again
 * whenever it changes: once after any registry says it changed (a package's
 * plugins register one by one), and, for a registry type made later, at the
 * next look, every `everyMs`. Returns how to stop.
 */
export function followRegistries(plugins: Registries, send: (snapshot: Snapshot) => void, everyMs = 250): () => void {
  const heard = new Map<PluginRegistry<any>, () => void>();
  let last: string | undefined;
  let queued = false;
  const look = () => {
    queued = false;
    for (const registry of plugins.getAllRegistries().values()) {
      if (!heard.has(registry)) {
        heard.set(registry, registry.on('changed', soon));
      }
    }
    const snapshot = snapshotOf(plugins);
    const key = JSON.stringify(snapshot);
    if (key !== last) {
      last = key;
      send(snapshot);
    }
  };
  const soon = () => {
    if (!queued) {
      queued = true;
      queueMicrotask(look);
    }
  };
  const timer = setInterval(() => plugins.getAllRegistries().size !== heard.size && look(), everyMs);
  look();
  return () => {
    clearInterval(timer);
    for (const off of heard.values()) {
      off();
    }
  };
}

/**
 * Makes the registries `getRegistry` gives agree with each snapshot it is
 * handed: registers what is new or changed, each with a load() that is
 * `load(importUrl, type, id)`, and removes what is gone. Only what it
 * registered itself is its to remove.
 */
export function mirror(
  getRegistry: (type: string) => PluginRegistry<any>,
  load: (importUrl: string, type: string, id: string) => Promise<unknown>,
): (snapshot: Snapshot) => void {
  /** What this mirror registered, by `<type> <id>`: its description, as JSON. */
  const had = new Map<string, string>();
  return (snapshot) => {
    const now = new Map(snapshot.map((description) => [`${description.type} ${description.id}`, description]));
    for (const [key, description] of now) {
      const json = JSON.stringify(description);
      if (had.get(key) !== json) {
        had.set(key, json);
        const { type, id, importUrl } = description;
        getRegistry(type).register({ ...description, load: () => load(importUrl, type, id) }, importUrl);
      }
    }
    for (const key of had.keys()) {
      if (!now.has(key)) {
        had.delete(key);
        const space = key.indexOf(' ');
        getRegistry(key.slice(0, space)).remove(key.slice(space + 1));
      }
    }
  };
}
