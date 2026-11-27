// A checker's cases of a browser run worker's registry as it is made
// (pluginMirror in webworker-lib.ts, 2c0cbed7), written apart from the
// builder's, which make a Node run thread's: with the page's registry module
// and filesystem module through the import map (`importShim`, stood in for
// here), nothing installed gives the pool's own build; and where the
// filesystem module cannot be had (it is needed only to load an installed
// package), the pool's own is still there.

import { afterEach, describe, expect, it } from 'vitest';
import * as plugins from '@inkandswitch/patchwork-plugins';
import * as client from './client.js';
import { TASKS_LIBRARY } from './ids';
import { pluginMirror } from './webworker-lib';

const shim = (filesystem: () => Promise<unknown>) =>
  ((self as any).importShim = (name: string) =>
    name === '@inkandswitch/patchwork-plugins' ? Promise.resolve(plugins) : name === '@inkandswitch/patchwork-filesystem' ? filesystem() : Promise.reject(new Error(`no ${name}`)));

afterEach(() => {
  delete (self as any).importShim;
  plugins.getRegistry('patchwork:library').remove('tasks-next');
});

describe("a browser run worker's registry, as pluginMirror makes it", () => {
  it("with nothing installed, gives the pool's own build", async () => {
    shim(async () => ({ importPluginFromFolderDocUrl: async () => ({ from: 'installed' }) }));
    const agree = await pluginMirror([TASKS_LIBRARY]);
    agree({ snapshot: [] });
    expect((await plugins.getRegistry('patchwork:library').loadWhenReady('tasks-next')).module).toBe(client);
  });

  // DEFECT (minor): pluginMirror waits for both modules before it registers
  // anything, so a run worker whose import map cannot give it
  // @inkandswitch/patchwork-filesystem has no registry at all ("this run
  // worker has no plugin registry"), and task code that asks for tasks-next
  // waits for ever, though the pool's own needs only the registry module.
  it.fails("where the filesystem module cannot be had, still gives the pool's own build", async () => {
    shim(() => Promise.reject(new Error('offline, not kept')));
    const agree = await pluginMirror([TASKS_LIBRARY]);
    agree({ snapshot: [] });
    expect((await plugins.getRegistry('patchwork:library').loadWhenReady('tasks-next')).module).toBe(client);
  });
});
