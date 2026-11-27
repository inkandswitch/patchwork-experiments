// A checker's cases of the pool's registry (registry-snapshot.ts), on core's
// real PluginRegistry, written apart from the builder's.
//
// Every sequence of three snapshots over three plugins, each absent, at its
// package's first heads or at its second (27 snapshots, so 27³ sequences),
// each sequence then repeating its last snapshot: after every step the
// receiving registries hold exactly the snapshot's plugins, each with the
// snapshot's description and url, and at the end each loads the module of the
// package at the heads its description names. Two of the three plugins share
// an id across two types, which a page's registries allow.
//
// What work already running sees when a package updates: a module the code
// already has stays the old version's; a load in flight as the new version
// arrives resolves to nothing (core's registry drops a load whose plugin was
// re-registered meanwhile), so code written `const { module } = await
// load(id)` throws there, and `loadWhenReady(id)` gives the new version.
//
// Every url is made up here.

import { describe, expect, it, vi } from 'vitest';
import { encodeHeads, generateAutomergeUrl, parseAutomergeUrl, stringifyAutomergeUrl } from '@automerge/automerge-repo/slim';
import { PluginRegistry } from '@inkandswitch/patchwork-plugins';
import { followRegistries, mirror, type Description, type Snapshot } from './registry-snapshot';

const aPackage = () => {
  const { documentId } = parseAutomergeUrl(generateAutomergeUrl());
  return (n: number) => stringifyAutomergeUrl({ documentId, heads: encodeHeads([n.toString(16).padStart(64, '0')]) });
};

const realm = () => {
  const registries = new Map<string, PluginRegistry<any>>();
  const getRegistry = (type: string) => {
    if (!registries.has(type)) {
      registries.set(type, new PluginRegistry());
    }
    return registries.get(type)!;
  };
  return { getRegistry, getAllRegistries: () => new Map(registries), registries };
};

/** What a realm's registries hold, as `<type> <id> <importUrl> <name>`, sorted. */
const held = (registries: Map<string, PluginRegistry<any>>) =>
  [...registries].flatMap(([type, registry]) => registry.all().map((p) => `${type} ${p.id} ${p.importUrl} ${p.name}`)).sort();
const expected = (snapshot: Snapshot) => snapshot.map((p) => `${p.type} ${p.id} ${p.importUrl} ${p.name}`).sort();

describe('a mirror, after any sequence of snapshots', () => {
  const pkgA = aPackage();
  const pkgB = aPackage();
  // Three plugins: two in one package, and one of another package with the first one's id in another type.
  const slots = [
    (v: number): Description => ({ type: 'patchwork:library', id: 'shared', name: `lib v${v}`, importUrl: pkgA(v) }),
    (v: number): Description => ({ type: 'patchwork:library', id: 'other', name: `other v${v}`, importUrl: pkgA(v) }),
    (v: number): Description => ({ type: 'agent:tool', id: 'shared', name: `tool v${v}`, importUrl: pkgB(v) }),
  ];
  // Each plugin absent (0), at its package's first heads (1), or at its second (2).
  const snapshots: Snapshot[] = [];
  for (let n = 0; n < 27; n++) {
    const states = [n % 3, Math.floor(n / 3) % 3, Math.floor(n / 9)];
    snapshots.push(states.flatMap((v, i) => (v === 0 ? [] : [slots[i](v)])));
  }
  const load = async (importUrl: string, type: string, id: string) => ({ importUrl, type, id });

  it('holds exactly the latest snapshot at every step, 27³ sequences each ending in a repeat, and loads what it names', async () => {
    let steps = 0;
    let loads = 0;
    const wrong: string[] = [];
    for (const a of snapshots) {
      for (const b of snapshots) {
        for (const c of snapshots) {
          const here = realm();
          const agree = mirror(here.getRegistry, load);
          for (const snapshot of [a, b, c, c]) {
            // each crosses as a structured clone would, and is handed whole
            agree(structuredClone(snapshot));
            steps++;
            if (JSON.stringify(held(here.registries)) !== JSON.stringify(expected(snapshot))) {
              wrong.push(`${JSON.stringify([a, b, c].map(expected))}: ${JSON.stringify(held(here.registries))}`);
            }
          }
          for (const p of c) {
            const loaded = await here.getRegistry(p.type).load(p.id);
            loads++;
            if (loaded?.module?.importUrl !== p.importUrl || loaded?.module?.type !== p.type) {
              wrong.push(`load ${p.type} ${p.id}: ${JSON.stringify(loaded?.module)}`);
            }
          }
        }
      }
    }
    expect(wrong.slice(0, 3)).toEqual([]);
    expect(steps).toBe(27 ** 3 * 4);
    expect(loads).toBeGreaterThan(27 ** 3);
  });
});

describe('work already running when a package updates', () => {
  it('keeps a module it has; a load in flight resolves to nothing; loadWhenReady gives the new version', async () => {
    const pkg = aPackage();
    const here = realm();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const agree = mirror(here.getRegistry, async (importUrl) => {
      if (importUrl === pkg(1)) {
        await gate;
      }
      return { version: importUrl === pkg(1) ? 1 : 2 };
    });
    const v1: Snapshot = [{ type: 'patchwork:library', id: 'lib', name: 'Lib', importUrl: pkg(1) }];
    const v2: Snapshot = [{ type: 'patchwork:library', id: 'lib', name: 'Lib', importUrl: pkg(2) }];
    agree(v1);
    const registry = here.getRegistry('patchwork:library');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // in flight when the update arrives
    const inFlight = registry.load('lib');
    agree(v2);
    release();
    expect(await inFlight).toBeUndefined();
    // so code written as the README writes it throws there
    await expect(
      (async () => {
        const { module } = (await inFlight) as any;
        return module;
      })(),
    ).rejects.toThrow(TypeError);

    // a module already in hand stays what it was
    const there = realm();
    const agreeThere = mirror(there.getRegistry, async (importUrl) => ({ version: importUrl === pkg(1) ? 1 : 2 }));
    agreeThere(v1);
    const { module: inHand } = (await there.getRegistry('patchwork:library').load('lib'))!;
    agreeThere(v2);
    expect(inHand).toEqual({ version: 1 });
    expect((await there.getRegistry('patchwork:library').loadWhenReady('lib')).module).toEqual({ version: 2 });
  });
});

describe('the sending side', () => {
  it('a registry type made later is sent within the look, and a plugin from an http url never crosses', async () => {
    vi.useFakeTimers();
    try {
      const pkg = aPackage();
      const page = realm();
      const sent: string[][] = [];
      const stop = followRegistries(page, (s) => sent.push(s.map((p) => `${p.type} ${p.id}`)));
      expect(sent).toEqual([[]]);
      page.getRegistry('later:kind').register({ id: 'x', type: 'later:kind', name: 'X' } as any, pkg(1));
      page.getRegistry('web:kind').register({ id: 'w', type: 'web:kind', name: 'W' } as any, 'https://example.invalid/pkg/');
      vi.advanceTimersByTime(250);
      expect(sent).toEqual([[], ['later:kind x']]);
      // the http one changes nothing that crosses
      page.getRegistry('web:kind').register({ id: 'w2', type: 'web:kind', name: 'W2' } as any, 'https://example.invalid/pkg/');
      await Promise.resolve();
      expect(sent).toHaveLength(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
