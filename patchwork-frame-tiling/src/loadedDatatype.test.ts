// The "+" menu holds the datatypes as they were listed. Loading one does not
// change the listed plugin: the registry puts a loaded one in its place. So the
// first pick of a datatype that has not been loaded yet has to use what the
// registry answers with, not the plugin the menu was holding.

import {
  getRegistry,
  isLoadedPlugin,
  type DatatypeDescription,
} from "@inkandswitch/patchwork-plugins";
import { afterEach, describe, expect, it } from "vitest";
import { loadedDatatype } from "./TopBar";

const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
const made: string[] = [];

const register = (id: string, load: () => Promise<unknown>) => {
  made.push(id);
  registry.register(
    {
      type: "patchwork:datatype",
      id,
      name: `Made up ${id}`,
      load,
    } as never,
    "made-up://test",
  );
  return registry.get(id)!;
};

afterEach(() => {
  for (const id of made.splice(0)) registry.remove(id);
});

describe("loadedDatatype", () => {
  it("answers with the loaded plugin on the first ask, while the listed one stays as it was", async () => {
    let loads = 0;
    const listed = register("made-up-first-pick", async () => {
      loads += 1;
      return { init: () => {}, getTitle: () => "A made-up title" };
    });
    expect(isLoadedPlugin(listed)).toBe(false);

    const loaded = await loadedDatatype(listed);

    expect(loaded && isLoadedPlugin(loaded)).toBe(true);
    expect(loaded!.id).toBe("made-up-first-pick");
    expect(loaded!.module.getTitle({} as never)).toBe("A made-up title");
    // The cause of the first click doing nothing: the plugin the menu held is
    // not the loaded one.
    expect(isLoadedPlugin(listed)).toBe(false);
    expect(loads).toBe(1);
  });

  it("answers with the plugin itself when it is already loaded, loading nothing", async () => {
    let loads = 0;
    const listed = register("made-up-second-pick", async () => {
      loads += 1;
      return { init: () => {}, getTitle: () => "Another" };
    });
    const first = await loadedDatatype(listed);
    const again = await loadedDatatype(first!);
    expect(again).toBe(first);
    expect(loads).toBe(1);
  });

  it("answers with nothing when the plugin's code fails to load", async () => {
    const listed = register("made-up-broken", async () => {
      throw new Error("made-up failure");
    });
    const loaded = await loadedDatatype(listed).catch(() => undefined);
    expect(loaded).toBeUndefined();
  });
});
