// @vitest-environment node
//
// The task system as a library (client.js, TASKS_LIBRARY in ids.ts): it gives
// every name the three files give, each the very same value; the package's
// entry for it is plain data and a load(); and in a pool, whose registry is
// made to agree with what is installed as a run worker's is (`mirror`, with
// the pool's own library as `own`), the lookup gives the pool's own build with
// nothing installed, an installed one once there is one, and its own again
// once that one is removed; and a Node run thread's registry, as it is made
// (pluginMirror in node/webworker-lib.node.ts), has the pool's own with nothing
// installed. Every url is made up here.

import { describe, expect, it } from 'vitest';
import { encodeHeads, generateAutomergeUrl, parseAutomergeUrl, stringifyAutomergeUrl } from '@automerge/automerge-repo/slim';
import { getRegistry as threadRegistry, PluginRegistry } from '@inkandswitch/patchwork-plugins';
import * as client from './client.js';
import * as asking from './task-client.js';
import * as rules from './task-rules.js';
import * as runs from './task-runs.js';
import { TASKS_LIBRARY } from './ids';
import { plugins } from './index';
import { mirror } from './registry-snapshot';
import { pluginMirror } from './node/webworker-lib.node';

describe('the task client as a library', () => {
  it('gives every name the three files export, each the same value', () => {
    const given: Record<string, unknown> = { ...rules, ...asking, ...runs };
    expect(Object.keys(client).sort()).toEqual(Object.keys(given).sort());
    for (const [name, value] of Object.entries(given)) {
      expect((client as Record<string, unknown>)[name], name).toBe(value);
    }
  });

  it("is in the package's entry as plain data and a load() that gives that module", async () => {
    const entry = plugins.find((plugin) => plugin.type === 'patchwork:library' && plugin.id === 'tasks-next');
    expect(entry).toBe(TASKS_LIBRARY);
    const { load, ...data } = entry as typeof TASKS_LIBRARY;
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(Object.keys(data).sort()).toEqual(['id', 'name', 'type']);
    expect(await load()).toBe(client);
  });

  it('in a pool: its own build with nothing installed, an installed one once there is one, its own again once that one is gone', async () => {
    const { documentId } = parseAutomergeUrl(generateAutomergeUrl());
    const installed = stringifyAutomergeUrl({ documentId, heads: encodeHeads(['1'.padStart(64, '0')]) });
    const registries = new Map<string, PluginRegistry<any>>();
    const getRegistry = (type: string) => registries.get(type) ?? registries.set(type, new PluginRegistry()).get(type)!;
    const agree = mirror(getRegistry, async (importUrl) => ({ from: importUrl }), [TASKS_LIBRARY]);
    const lookup = async () => {
      const plugin = await getRegistry('patchwork:library').loadWhenReady('tasks-next');
      return { importUrl: plugin.importUrl, ownBuild: plugin.module === client, from: plugin.module.from };
    };

    agree([]);
    expect(await lookup()).toEqual({ importUrl: undefined, ownBuild: true, from: undefined });

    const installedOne = { type: 'patchwork:library', id: 'tasks-next', name: 'Tasks client (experimental)', importUrl: installed };
    agree([installedOne]);
    expect(await lookup()).toEqual({ importUrl: installed, ownBuild: false, from: installed });

    agree([]);
    expect(await lookup()).toEqual({ importUrl: undefined, ownBuild: true, from: undefined });

    // installed from the first snapshot on: the pool's own is never registered
    registries.clear();
    const fresh = mirror(getRegistry, async (importUrl) => ({ from: importUrl }), [TASKS_LIBRARY]);
    fresh([installedOne]);
    expect(await lookup()).toEqual({ importUrl: installed, ownBuild: false, from: installed });
  });

  it("in a Node run thread's registry as it is made, with nothing installed: the pool's own build", async () => {
    const agree = await pluginMirror([TASKS_LIBRARY]);
    agree({ snapshot: [] });
    const plugin = await threadRegistry('patchwork:library').loadWhenReady('tasks-next');
    expect(plugin.module).toBe(client);
    expect(plugin.importUrl).toBeUndefined();
  });
});
