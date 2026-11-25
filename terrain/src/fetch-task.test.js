// @vitest-environment node
// Fetch data as a task (fetch-task.js) on the made-up place of the test
// fixture, with a stand-in for the network and a ctx like a pool's: what it
// stores and returns, the two guards (the frame moved meanwhile; a stop), a
// fetch error as a person reads it, and the key a fetch is asked under.
import { describe, it, expect } from "vitest";
import { fetchTerrain, MOVED, STAGES } from "./fetch-task.js";
import { fetchSpec, fetchKey, canonicalJson } from "./fetch-spec.js";
import { nceiUrl, OVERPASS, STOPPED } from "./fetch-data.js";
import { readTerrainData, dataFits } from "./store.js";
import { FakeRepo } from "./test/fake-repo.js";
import { GRID, OSM, frame, heightAtLocal, terrainDoc } from "./test/fixture.js";
import { writeTiff } from "./test/tiff-writer.js";

/** The fixture's DEM as NCEI sends it: a TIFF in the frame, tied at the grid's north-west cell corner. */
function nceiTiff() {
  const { n, cell, x0, z0 } = GRID;
  const v = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = heightAtLocal(x0 + i * cell, z0 + j * cell) + 0.68;
  return writeTiff(n, n, v, { scale: [cell, cell, 0], tie: [0, 0, 0, x0 - cell / 2, -z0 + cell / 2, 0], crs: 32767 });
}

/**
 * The network, standing in: NCEI's answer for the fixture's grid, the
 * fixture's OSM for the shore query, nothing for the look. `on` may hold or
 * change an answer: on(kind, init) → undefined (the usual answer), a Response,
 * or a promise of one.
 */
function network(on = () => undefined) {
  const asked = [];
  const dem = nceiTiff();
  const fetch = async (url, init = {}) => {
    const kind = init.method === "POST" ? (decodeURIComponent(init.body).includes('"natural"="coastline"') ? "shore" : "look") : url === nceiUrl(GRID, frame) ? "dem" : "other";
    asked.push({ kind, signal: init.signal ?? null });
    const special = await on(kind, init);
    if (special) return special;
    if (kind === "dem") return new Response(dem, { status: 200, headers: { "content-type": "image/tiff" } });
    if (kind === "shore") return new Response(JSON.stringify(OSM), { status: 200 });
    if (kind === "look") return new Response(JSON.stringify({ elements: [] }), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  return { fetch, asked };
}

/** A Terrain doc with no data in a stand-in Repo, and a ctx like a pool's for it. */
function world() {
  const repo = new FakeRepo();
  const doc = terrainDoc();
  doc.data = null;
  const handle = repo.add(doc);
  const lines = [];
  const stages = [];
  const controller = new AbortController();
  const ctx = { repo, log: (...a) => lines.push(a.join(" ")), progress: (v) => stages.push(v), signal: controller.signal, key: "k", taskUrl: null, run: "r" };
  return { repo, handle, ctx, lines, stages, controller };
}

describe("the fetch task", () => {
  it("fetches what the doc asks for, stores it in file docs the doc points at, and returns their urls and a line, never the data", async () => {
    const { repo, handle, ctx, lines, stages } = world();
    const net = network();
    const result = await fetchTerrain({ terrain: handle.url }, ctx, net.fetch);
    expect(result).toEqual({ stored: true, message: expect.stringMatching(/^Done: 2 coastline ways, \d+ structures, \d+ marks; heights /), dem: expect.any(String), features: expect.any(String), layers: null, look: expect.any(String) });
    expect(JSON.stringify(result).length).toBeLessThan(1000);
    const d = handle.doc();
    expect([d.data.dem.url, d.data.features.url, d.data.look.url]).toEqual([result.dem, result.features, result.look]);
    expect(dataFits(d)).toBe(true);
    // the bytes are what the doc records (readTerrainData checks each against its SHA-256)
    const back = await readTerrainData(repo, d);
    expect(back.dem.length).toBe(GRID.n ** 2);
    expect(back.features.coast.length).toBe(2);
    expect(stages).toEqual([STAGES.finding, STAGES.fetching, STAGES.storing]);
    expect(lines[0]).toMatch(/^Asking NCEI for 65 × 65 heights/);
    expect(lines).toContain("Storing…");
    expect(lines.at(-1)).toBe(result.message);
    // every request carried the stop
    expect(net.asked.every((a) => a.signal === ctx.signal)).toBe(true);
  });

  const moves = [
    ["the frame's west edge", (d) => (d.grid.x0 += 8)],
    ["the grid's size", (d) => (d.grid.n = 129)],
    ["the origin", (d) => (d.origin.lat += 0.001)],
    ["OpenStreetMap's date", (d) => (d.osmDate = "2026-01-01T00:00:00Z")],
  ];
  for (const [what, move] of moves) {
    it(`stores nothing when ${what} changed while it fetched, and says so in its log and result`, async () => {
      const { repo, handle, ctx, lines } = world();
      const net = network((kind) => void (kind === "dem" && handle.change(move)));
      const before = handle.doc();
      const result = await fetchTerrain({ terrain: handle.url }, ctx, net.fetch);
      expect(result).toEqual({ stored: false, message: MOVED });
      expect(lines.at(-1)).toBe(MOVED);
      expect(handle.doc().data).toBeNull();
      expect(handle.doc().sources).toEqual(before.sources);
      expect(repo.created).toEqual([]);
    });
  }

  it("stores nothing when the frame moves while the file docs are being made: the doc is looked at again in the change that points at them", async () => {
    const { repo, handle, ctx } = world();
    const create2 = repo.create2.bind(repo);
    repo.create2 = async (doc) => {
      handle.change((d) => (d.grid.z0 -= 8));
      return create2(doc);
    };
    const result = await fetchTerrain({ terrain: handle.url }, ctx, network().fetch);
    expect(result).toEqual({ stored: false, message: MOVED });
    expect(handle.doc().data).toBeNull();
  });

  it("stores when only what a fetch does not read changed meanwhile (title, exaggeration, places, wind)", async () => {
    const { handle, ctx } = world();
    const net = network((kind) => void (kind === "dem" && handle.change((d) => {
      d.title = "Renamed";
      d.exaggeration = 2;
      d.places = [];
      d.wind = { speed: 9, from: 90 };
    })));
    const result = await fetchTerrain({ terrain: handle.url }, ctx, net.fetch);
    expect(result.stored).toBe(true);
    expect(handle.doc().data.dem.url).toBe(result.dem);
  });

  it("stopped mid-fetch, by a request that never answers and ignores its signal: rejects at once and stores nothing", async () => {
    const { repo, handle, ctx, controller } = world();
    let asked;
    const heard = new Promise((resolve) => (asked = resolve));
    const net = network((kind) => {
      if (kind !== "shore") return undefined;
      asked();
      return new Promise(() => {});
    });
    const running = fetchTerrain({ terrain: handle.url }, ctx, net.fetch);
    await heard;
    const t0 = performance.now();
    controller.abort("cancelled");
    await expect(running).rejects.toThrow(STOPPED);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(handle.doc().data).toBeNull();
    expect(repo.created).toEqual([]);
  });

  it("stopped while it waits to ask Overpass again: rejects at once, without waiting out the retry or asking again", async () => {
    const { repo, handle, ctx, controller, lines } = world();
    let busy;
    const heard = new Promise((resolve) => (busy = resolve));
    const net = network((kind) => {
      if (kind !== "shore") return undefined;
      busy();
      return new Response("busy", { status: 504 });
    });
    const running = fetchTerrain({ terrain: handle.url }, ctx, net.fetch);
    await heard;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lines).toContain("Overpass answered 504; trying again in 3 s");
    const t0 = performance.now();
    controller.abort("cancelled");
    await expect(running).rejects.toThrow(STOPPED);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(net.asked.filter((a) => a.kind === "shore")).toHaveLength(1);
    expect(repo.created).toEqual([]);
  });

  it("stopped before it starts: asks nothing and stores nothing", async () => {
    const { repo, handle, ctx, controller } = world();
    const net = network();
    controller.abort("cancelled");
    await expect(fetchTerrain({ terrain: handle.url }, ctx, net.fetch)).rejects.toThrow(STOPPED);
    expect(net.asked).toEqual([]);
    expect(repo.created).toEqual([]);
  });

  it("a source's error fails it with the message a person sees (NCEI answered 500), and stores nothing", async () => {
    const { repo, handle, ctx } = world();
    const net = network((kind) => (kind === "dem" ? new Response("oops", { status: 500 }) : undefined));
    await expect(fetchTerrain({ terrain: handle.url }, ctx, net.fetch)).rejects.toThrow(/^NCEI answered 500$/);
    expect(handle.doc().data).toBeNull();
    expect(repo.created).toEqual([]);
  });

  it("an input that names no terrain fails plainly", async () => {
    const { ctx } = world();
    await expect(fetchTerrain({}, ctx, network().fetch)).rejects.toThrow("No terrain was named to fetch data for.");
    expect(OVERPASS.service).toMatch(/^https:/);
  });
});

describe("the key a fetch is asked under", () => {
  const URL_A = "automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P";
  const keyOf = (doc, url = URL_A) => fetchKey(url, fetchSpec(doc));
  const base = () => terrainDoc();

  it("names the doc and the SHA-256 of what it asks for", async () => {
    expect(await keyOf(base())).toMatch(/^terrain-fetch:automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P:[0-9a-f]{64}$/);
  });

  it("is the same for the same place and grid, asked twice or written in another key order", async () => {
    const a = base();
    const reordered = Object.fromEntries(Object.entries(base()).reverse());
    reordered.grid = Object.fromEntries(Object.entries(a.grid).reverse());
    reordered.origin = { lon: a.origin.lon, lat: a.origin.lat };
    expect(await keyOf(a)).toBe(await keyOf(base()));
    expect(await keyOf(reordered)).toBe(await keyOf(a));
  });

  const asks = {
    "grid.n": (d) => (d.grid.n = 129),
    "grid.cell": (d) => (d.grid.cell = 16),
    "grid.x0": (d) => (d.grid.x0 += 1),
    "grid.z0": (d) => (d.grid.z0 -= 1),
    "origin.lat": (d) => (d.origin.lat += 1e-5),
    "origin.lon": (d) => (d.origin.lon += 1e-5),
    osmDate: (d) => (d.osmDate = "2026-01-01T00:00:00Z"),
    demToMWL: (d) => (d.demToMWL = 1),
    look: (d) => (d.look = null),
  };
  for (const [field, change] of Object.entries(asks)) {
    it(`changes with ${field}`, async () => {
      const d = base();
      change(d);
      expect(await keyOf(d)).not.toBe(await keyOf(base()));
    });
  }

  const unrelated = {
    title: (d) => (d.title = "Another name"),
    exaggeration: (d) => (d.exaggeration = 3),
    places: (d) => (d.places = []),
    wind: (d) => (d.wind = { speed: 1, from: 0 }),
    data: (d) => (d.data = null),
    sources: (d) => (d.sources = []),
    "attribution of a place that is not layered": (d) => (d.attribution = "someone"),
  };
  for (const [field, change] of Object.entries(unrelated)) {
    it(`does not change with ${field}`, async () => {
      const d = base();
      change(d);
      expect(await keyOf(d)).toBe(await keyOf(base()));
    });
  }

  it("differs between two docs asking for the same place", async () => {
    expect(await keyOf(base(), "automerge:3mv3rTpAcL5aUfYiQqb1RnQkQi3P")).not.toBe(await keyOf(base()));
  });

  it("reads JSON in one canonical form", () => {
    expect(canonicalJson({ b: [1, { d: 2, c: null }], a: "x", u: undefined })).toBe('{"a":"x","b":[1,{"c":null,"d":2}]}');
  });
});
