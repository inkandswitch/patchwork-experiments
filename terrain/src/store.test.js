// @vitest-environment node
// What a store writes on a Terrain doc, on real automerge documents where two
// machines write it at once: one value, `data`, holding the files' records,
// the sources and credits, and the hash of what was fetched; and dataFits,
// which compares that hash with what the doc asks for now. And the
// synchronous SHA-256 that hash is made with.
import { describe, it, expect } from "vitest";
import { initSubduction, Repo } from "@automerge/automerge-repo";
import { storeTerrainData, dataFits } from "./store.js";
import { fetchKey, fetchSpec, specHash } from "./fetch-spec.js";
import { sha256Hex, sha256HexNow } from "./hash.js";
import { terrainDoc } from "./test/fixture.js";

await initSubduction();

const newRepo = () => new Repo({ network: [] });

/** A Terrain doc with no data, as the datatype makes it. */
function bare(extra = {}) {
  const d = terrainDoc();
  delete d.sources;
  delete d.attribution;
  return { ...d, data: null, ...extra };
}

/** Fetched data as fetchTerrainData gives it, made up, told apart by `name` in every part. */
async function fetchedAs(name, grid) {
  const demBytes = new TextEncoder().encode(`${name} heights`);
  const featBytes = new TextEncoder().encode(JSON.stringify({ name }));
  return {
    dem: { bytes: demBytes, record: { encoding: "int16le", n: grid.n, cell: grid.cell, x0: grid.x0, z0: grid.z0, sha256: await sha256Hex(demBytes) } },
    features: { bytes: featBytes, record: { encoding: "json", sha256: await sha256Hex(featBytes) } },
    sources: [{ id: name, name, licence: `${name}'s`, attribution: `by ${name}` }],
    summary: { fetched: `${name} time` },
    attribution: `all by ${name}`,
    credit: `© ${name}`,
  };
}

/** A doc made in a Repo of its own: one machine. */
function made(doc) {
  const repo = newRepo();
  return { repo, handle: repo.create(doc) };
}

/** The same doc on another machine that has synced it once. */
async function replicaOf({ repo, handle }) {
  const other = newRepo();
  return { repo: other, handle: other.import(await repo.export(handle.documentId), { docId: handle.documentId }) };
}

const plainData = (handle) => JSON.parse(JSON.stringify(handle.doc().data));

describe("what a store writes on the Terrain doc", () => {
  it("one value, data: the files, the sources, the credits and the hash of what was asked for; nothing else on the doc changes", async () => {
    const { repo, handle } = made(bare());
    const before = JSON.parse(JSON.stringify(handle.doc()));
    const spec = fetchSpec(handle.doc());
    const urls = await storeTerrainData(repo, handle, await fetchedAs("x", spec.grid), { spec });
    const after = JSON.parse(JSON.stringify(handle.doc()));
    expect({ ...after, data: null }).toEqual(before);
    expect(after.data).toEqual({
      request: specHash(spec),
      dem: expect.objectContaining({ url: urls.dem }),
      features: expect.objectContaining({ url: urls.features }),
      fetched: "x time",
      summary: { fetched: "x time" },
      sources: [{ id: "x", name: "x", licence: "x's", attribution: "by x" }],
      attribution: "all by x",
      credit: "© x",
    });
    expect(dataFits(handle.doc())).toBe(true);
  });

  it("two stores at once on two machines keep one of them whole on both, never a mixture; with the same two machines the other way round, the other whole", async () => {
    const one = made(bare());
    const two = await replicaOf(one);
    const spec = fetchSpec(one.handle.doc());
    const x = await fetchedAs("x", spec.grid);
    const y = await fetchedAs("y", spec.grid);
    const winners = [];
    for (const [first, second] of [[x, y], [y, x]]) {
      await storeTerrainData(one.repo, one.handle, first, { spec });
      await storeTerrainData(two.repo, two.handle, second, { spec });
      const ofFirst = plainData(one.handle);
      const ofSecond = plainData(two.handle);
      one.handle.merge(two.handle);
      two.handle.merge(one.handle);
      const kept = plainData(one.handle);
      expect(plainData(two.handle)).toEqual(kept);
      // the whole of one store: its files, its sources and its credits together
      expect([ofFirst, ofSecond]).toContainEqual(kept);
      expect(dataFits(one.handle.doc())).toBe(true);
      winners.push(kept.credit);
    }
    // the same machine's write wins both times, so each value has been the one kept once
    expect(winners.sort()).toEqual(["© x", "© y"]);
  });

  it("a store made by a machine that had not heard the frame move reads as stale on both once they meet", async () => {
    const here = made(bare());
    const there = await replicaOf(here);
    const spec = fetchSpec(there.handle.doc());
    here.handle.change((d) => (d.grid.x0 += 8));
    await storeTerrainData(there.repo, there.handle, await fetchedAs("old", spec.grid), { spec });
    expect(dataFits(there.handle.doc())).toBe(true);
    here.handle.merge(there.handle);
    there.handle.merge(here.handle);
    for (const handle of [here.handle, there.handle]) {
      expect(handle.doc().data.credit).toBe("© old");
      expect(handle.doc().grid.x0).toBe(spec.grid.x0 + 8);
      expect(dataFits(handle.doc())).toBe(false);
    }
  });

  const asks = {
    "the frame": (d) => (d.grid.x0 += 8),
    "the origin": (d) => (d.origin.lat += 0.001),
    "OpenStreetMap's date": (d) => (d.osmDate = "2026-01-01T00:00:00Z"),
    "the look": (d) => (d.look = null),
  };
  for (const [what, change] of Object.entries(asks)) {
    it(`data stored for the doc reads as stale once ${what} changes, and fits again when it is changed back`, async () => {
      const { repo, handle } = made(bare());
      const spec = fetchSpec(handle.doc());
      await storeTerrainData(repo, handle, await fetchedAs("x", spec.grid), { spec });
      const was = JSON.parse(JSON.stringify(handle.doc()));
      handle.change(change);
      expect(dataFits(handle.doc())).toBe(false);
      handle.change((d) => {
        for (const k of ["grid", "origin", "osmDate", "look"]) {
          if (k in was) d[k] = was[k];
          else delete d[k];
        }
      });
      expect(dataFits(handle.doc())).toBe(true);
    });
  }

  it("data that does not say what it was fetched for never fits; nor does no data", () => {
    const d = terrainDoc();
    expect(d.data.request).toBeUndefined();
    expect(dataFits(d)).toBe(false);
    expect(dataFits(bare())).toBe(false);
    expect(dataFits({ ...bare(), data: { request: 42 } })).toBe(false);
  });

  it("a layered place's own credits are part of what it asks for, and storing leaves them, so its key is the same after a store as before", async () => {
    const { repo, handle } = made(bare({ heights: { kind: "layered" }, attribution: "the place's credit", credit: "the place's short credit" }));
    const spec = fetchSpec(handle.doc());
    expect(spec.attribution).toBe("the place's credit");
    const key = fetchKey(handle.url, spec);
    await storeTerrainData(repo, handle, await fetchedAs("x", spec.grid), { spec });
    expect(handle.doc().attribution).toBe("the place's credit");
    expect(fetchKey(handle.url, fetchSpec(handle.doc()))).toBe(key);
    expect(dataFits(handle.doc())).toBe(true);
  });

  it("refuses to store without the spec the data was fetched for", async () => {
    const { repo, handle } = made(bare());
    await expect(storeTerrainData(repo, handle, await fetchedAs("x", handle.doc().grid), {})).rejects.toThrow(/spec/);
    expect(handle.doc().data).toBeNull();
  });
});

describe("the SHA-256 computed at once", () => {
  it("is WebCrypto's SHA-256 for every length up to five blocks, across each padding boundary", async () => {
    for (let n = 0; n <= 320; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 255);
      expect(sha256HexNow(bytes), `${n} bytes`).toBe(await sha256Hex(bytes));
    }
  });

  it("gives FIPS 180-4's digest of 'abc'", () => {
    expect(sha256HexNow(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
