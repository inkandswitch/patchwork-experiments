// The pool's registry as it crosses between realms (registry-snapshot.ts),
// on core's real PluginRegistry: a snapshot makes an empty registry agree;
// a second, with one plugin gone, one changed (its package at new heads) and
// one new, makes it agree again; load() gives the module, through the load
// the realm gives, at the heads the snapshot names; a plugin whose load fails
// fails alone; two mirrors do not share what they hold; and the sending side
// sends the snapshot now, once per change, and for a registry type made
// later, and nothing when only a load happened. Every url is made up here.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeHeads, generateAutomergeUrl, parseAutomergeUrl, stringifyAutomergeUrl } from '@automerge/automerge-repo/slim';
import { PluginRegistry } from '@inkandswitch/patchwork-plugins';
import { followRegistries, mirror, snapshotOf, type Description, type Snapshot } from './registry-snapshot';

/** A made-up package, and its url at heads number `n`. */
const aPackage = () => {
  const { documentId } = parseAutomergeUrl(generateAutomergeUrl());
  return (n: number) => stringifyAutomergeUrl({ documentId, heads: encodeHeads([n.toString(16).padStart(64, '0')]) });
};

/** Registries of a realm of the test's own, as the registry module keeps them. */
const realm = () => {
  const registries = new Map<string, PluginRegistry<any>>();
  const getRegistry = (type: string) => {
    if (!registries.has(type)) {
      registries.set(type, new PluginRegistry());
    }
    return registries.get(type)!;
  };
  const ids = () => Object.fromEntries([...registries].map(([type, registry]) => [type, registry.all().map((p) => `${p.id} ${p.importUrl}`).sort()]));
  return { getRegistry, getAllRegistries: () => new Map(registries), ids };
};

const plugin = (type: string, id: string, importUrl: string, more: Record<string, unknown> = {}): Description => ({ type, id, name: id, importUrl, ...more });

describe('mirror', () => {
  const lib = aPackage();
  const tools = aPackage();
  const later = aPackage();
  /** What each load was asked, and what it gives: the module of that package at those heads. */
  const loads: string[] = [];
  const load = async (importUrl: string, type: string, id: string) => {
    loads.push(`${type} ${id} ${importUrl}`);
    if (id === 'broken') {
      throw new Error('this one will not load');
    }
    return { from: importUrl, id };
  };

  const first: Snapshot = [
    plugin('patchwork:library', 'maths', lib(1)),
    plugin('patchwork:library', 'words', lib(1)),
    plugin('agent:tool', 'say', tools(1), { risk: 'read' }),
    plugin('agent:tool', 'broken', tools(1)),
  ];

  it('makes an empty registry agree with a snapshot, and a second snapshot with one gone, one changed and one new', async () => {
    const here = realm();
    const agree = mirror(here.getRegistry, load);
    agree(first);
    expect(here.ids()).toEqual({
      'patchwork:library': [`maths ${lib(1)}`, `words ${lib(1)}`],
      'agent:tool': [`broken ${tools(1)}`, `say ${tools(1)}`],
    });
    expect(await here.getRegistry('patchwork:library').load('maths')).toMatchObject({ id: 'maths', module: { from: lib(1), id: 'maths' } });

    // words gone, maths at new heads, a new package's plugin of a new type
    agree([
      plugin('patchwork:library', 'maths', lib(2)),
      plugin('agent:tool', 'say', tools(1), { risk: 'read' }),
      plugin('agent:tool', 'broken', tools(1)),
      plugin('scene:source', 'shape', later(1)),
    ]);
    expect(here.ids()).toEqual({
      'patchwork:library': [`maths ${lib(2)}`],
      'agent:tool': [`broken ${tools(1)}`, `say ${tools(1)}`],
      'scene:source': [`shape ${later(1)}`],
    });
    // the changed one loads anew, from its new heads
    expect(await here.getRegistry('patchwork:library').load('maths')).toMatchObject({ module: { from: lib(2) } });
    expect(await here.getRegistry('scene:source').load('shape')).toMatchObject({ module: { from: later(1), id: 'shape' } });
    expect(loads.filter((l) => l.startsWith('patchwork:library maths'))).toEqual([
      `patchwork:library maths ${lib(1)}`,
      `patchwork:library maths ${lib(2)}`,
    ]);
  });

  it('leaves what did not change as it was: loaded, and not registered again', async () => {
    const here = realm();
    const agree = mirror(here.getRegistry, load);
    agree(first);
    await here.getRegistry('agent:tool').load('say');
    const registered = vi.fn();
    here.getRegistry('agent:tool').on('registered', registered);
    agree(first.map((p) => ({ ...p })));
    expect(registered).not.toHaveBeenCalled();
    expect(here.getRegistry('agent:tool').get('say')).toHaveProperty('module');
  });

  it('a plugin whose load fails fails alone', async () => {
    const here = realm();
    mirror(here.getRegistry, load)(first);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(here.getRegistry('agent:tool').load('broken')).rejects.toThrow('this one will not load');
    expect(await here.getRegistry('agent:tool').load('say')).toMatchObject({ risk: 'read', module: { id: 'say' } });
    expect(here.getRegistry('agent:tool').has('broken')).toBe(true);
  });

  it('two mirrors do not share what they hold', () => {
    const one = realm();
    const two = realm();
    const agreeOne = mirror(one.getRegistry, load);
    const agreeTwo = mirror(two.getRegistry, load);
    agreeOne(first);
    agreeTwo([plugin('patchwork:library', 'maths', lib(3))]);
    expect(one.ids()['patchwork:library']).toEqual([`maths ${lib(1)}`, `words ${lib(1)}`]);
    expect(two.ids()).toEqual({ 'patchwork:library': [`maths ${lib(3)}`] });
    // the second forgets maths; the first still has it, and its other plugins
    agreeTwo([]);
    expect(two.ids()).toEqual({ 'patchwork:library': [] });
    expect(one.ids()['patchwork:library']).toEqual([`maths ${lib(1)}`, `words ${lib(1)}`]);
    expect(one.ids()['agent:tool']).toHaveLength(2);
  });
});

describe('the sending side', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a snapshot is every plugin from a package kept in automerge, as plain data with its type and url', async () => {
    const pkg = aPackage();
    const page = realm();
    page.getRegistry('patchwork:library').register({ id: 'maths', type: 'patchwork:library', name: 'Maths', load: async () => ({}) }, pkg(1));
    page.getRegistry('patchwork:tool').register({ id: 'here', type: 'patchwork:tool', name: 'Here', load: async () => ({}) }, 'https://example.invalid/here/');
    page.getRegistry('patchwork:tool').register({ id: 'view', type: 'patchwork:tool', name: 'View', icon: 'eye', render: () => {}, load: async () => ({}) }, pkg(1));
    await page.getRegistry('patchwork:library').load('maths');
    const snapshot = snapshotOf(page);
    expect(snapshot).toEqual([
      { id: 'maths', type: 'patchwork:library', name: 'Maths', importUrl: pkg(1) },
      { id: 'view', type: 'patchwork:tool', name: 'View', icon: 'eye', importUrl: pkg(1) },
    ]);
    expect(structuredClone(snapshot)).toEqual(snapshot);
  });

  it('sends now, once after each change, for a registry type made later, and not for a load', async () => {
    vi.useFakeTimers();
    const pkg = aPackage();
    const page = realm();
    page.getRegistry('patchwork:library').register({ id: 'a', type: 'patchwork:library', name: 'A', load: async () => 1 }, pkg(1));
    const sent: string[][] = [];
    const stop = followRegistries(page, (snapshot) => sent.push(snapshot.map((p) => `${p.type} ${p.id}`)), 1_000);
    expect(sent).toEqual([['patchwork:library a']]);

    // two plugins registered at once are one change
    page.getRegistry('patchwork:library').register({ id: 'b', type: 'patchwork:library', name: 'B', load: async () => 2 }, pkg(1));
    page.getRegistry('patchwork:library').register({ id: 'c', type: 'patchwork:library', name: 'C', load: async () => 3 }, pkg(1));
    await Promise.resolve();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(['patchwork:library a', 'patchwork:library b', 'patchwork:library c']);

    // a load changes nothing that crosses
    await page.getRegistry('patchwork:library').load('a');
    await Promise.resolve();
    expect(sent).toHaveLength(2);

    // a registry type no one had: seen at the next look, and heard from then on
    page.getRegistry('scene:source').register({ id: 's', type: 'scene:source', name: 'S', load: async () => 4 }, pkg(2));
    await Promise.resolve();
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    expect(sent.at(-1)).toContain('scene:source s');
    page.getRegistry('scene:source').remove('s');
    await Promise.resolve();
    expect(sent.at(-1)).not.toContain('scene:source s');

    stop();
    page.getRegistry('patchwork:library').remove('a');
    await Promise.resolve();
    vi.advanceTimersByTime(5_000);
    expect(sent.at(-1)).toContain('patchwork:library a');
  });
});
