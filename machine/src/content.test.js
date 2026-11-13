// Content provisioning (content.js): packing as the engines do, identifying
// files, the cache in IndexedDB and every way of reaching it failing, and
// provide() over every ordering of a fixed set of candidates, against a rule
// stated separately. Small synthetic WADs and ROMs for the enumerations; the
// real Freedoom IWADs and Unarmed where they are named.
import { existsSync, readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { content as doomContent } from "./doom.js";
import { contentCache, fileCandidate, identify, KNOWN, pack, provide, recipe, sha256 } from "./content.js";

const dir = new URL("../engines/doom/test/", import.meta.url);
const iwadPath = process.env.FREEDOOM1 ?? new URL("freedoom1.wad", dir).pathname;
const iwad2Path = process.env.FREEDOOM2 ?? new URL("freedoom2.wad", dir).pathname;
const haveIwad = existsSync(iwadPath);
const ROM = readFileSync(new URL("../engines/snes/test/unarmed.sfc", import.meta.url));

/** A WAD of the named empty lumps. */
function wad(type, names) {
  const out = new Uint8Array(12 + 16 * names.length);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode(type));
  v.setInt32(4, names.length, true);
  v.setInt32(8, 12, true);
  names.forEach((n, i) => {
    v.setInt32(12 + 16 * i, 12, true);
    out.set(new TextEncoder().encode(n), 12 + 16 * i + 8);
  });
  return out;
}

describe("packing", () => {
  test("'parts' is doom.js content()'s layout, byte for byte, and recipe() reads it back", async () => {
    const wads = [wad("IWAD", ["E1M1", "THINGS"]), wad("PWAD", ["MAP01"])];
    for (const args of [[], ["-warp", "1", "1"], ["-skill", "5", "-players", "4"]]) {
      const c = pack("parts", args, wads);
      expect(Buffer.compare(Buffer.from(c), Buffer.from(doomContent({ wads, args })))).toBe(0);
      const r = await recipe(c, "parts", ["doom.wad", "mod.wad"]);
      expect(r).toEqual({
        content: await sha256(c),
        pack: "parts",
        args,
        files: [
          { name: "doom.wad", size: wads[0].length, sha256: await sha256(wads[0]) },
          { name: "mod.wad", size: wads[1].length, sha256: await sha256(wads[1]) },
        ],
      });
    }
  });

  test("'raw' is the one file (the Super NES's content is its ROM)", async () => {
    expect(pack("raw", [], [ROM])).toBe(ROM);
    expect(() => pack("raw", ["-x"], [ROM])).toThrow("one file and no arguments");
    expect(() => pack("raw", [], [ROM, ROM])).toThrow("one file and no arguments");
    const r = await recipe(ROM, "raw", ["unarmed.sfc"]);
    expect(r).toEqual({ content: await sha256(ROM), pack: "raw", files: [{ name: "unarmed.sfc", size: ROM.length, sha256: r.content }] });
    await expect(recipe(ROM, "parts")).rejects.toThrow('content is not "parts"');
  });
});

describe("identify", () => {
  test("Unarmed: a LoROM cartridge, its title and checksum; with a copier header; modified", () => {
    expect(identify(ROM)).toMatchObject({ kind: "snes", title: "Unarmed", mapping: "LoROM", copier: false, size: 262144, checksum: true });
    expect(identify(ROM).summary).toBe('a Super NES cartridge, "Unarmed" (LoROM), 256 KB');
    const copier = new Uint8Array(512 + ROM.length);
    copier.set(ROM, 512);
    expect(identify(copier)).toMatchObject({ kind: "snes", title: "Unarmed", copier: true, checksum: true });
    const changed = Uint8Array.from(ROM);
    changed[0x1234] ^= 1;
    expect(identify(changed)).toMatchObject({ kind: "snes", checksum: false });
    expect(identify(changed).summary).toContain("checksum wrong");
  });

  test("WADs, packed content and the rest", () => {
    expect(identify(wad("PWAD", ["MAP01", "THINGS", "MAP02"]))).toMatchObject({ kind: "wad", type: "PWAD", lumps: 3, maps: ["MAP01", "MAP02"] });
    const c = pack("parts", ["-warp", "1"], [wad("IWAD", ["E1M1"])]);
    const p = identify(c);
    expect(p).toMatchObject({ kind: "parts", args: ["-warp", "1"], files: [{ kind: "wad", type: "IWAD", maps: ["E1M1"] }] });
    expect(identify(new TextEncoder().encode("hello, world"))).toMatchObject({ kind: "unknown", summary: "an unrecognised file, 12 bytes" });
    expect(identify(new Uint8Array())).toMatchObject({ kind: "unknown" });
  });

  test.skipIf(!haveIwad)("Freedoom's IWADs, by their known hashes", async () => {
    const one = readFileSync(iwadPath);
    const sha = await sha256(one);
    expect(KNOWN[sha]).toBe("Freedoom: Phase 1, 0.13.0 (freedoom1.wad)");
    expect(identify(one, sha).summary).toBe("Freedoom: Phase 1, 0.13.0 (freedoom1.wad): 3163 lumps, 36 maps (E1M1–E4M9), 27.46 MB");
    if (existsSync(iwad2Path)) {
      const two = readFileSync(iwad2Path);
      expect(identify(two, await sha256(two)).summary).toMatch(/^Freedoom: Phase 2, 0\.13\.0 \(freedoom2\.wad\): \d+ lumps, 32 maps \(MAP01–MAP32\)/);
    }
  });
});

describe("the cache", () => {
  test("keeps content by hash, and hands it back in a later session of the page", async () => {
    const indexedDB = new IDBFactory();
    const a = contentCache({ indexedDB });
    expect(await a.get("x")).toBe(null);
    expect(await a.put("x", ROM)).toBe(true);
    const b = contentCache({ indexedDB }); // another page, the same browser
    expect(Buffer.compare(Buffer.from(await b.get("x")), ROM)).toBe(0);
    await b.delete("x");
    expect(await b.get("x")).toBe(null);
    expect(a.stats).toEqual({ hits: 0, misses: 1, puts: 1, failed: 0 });
    expect(b.stats).toEqual({ hits: 1, misses: 1, puts: 0, failed: 0 });
  });

  test("every way of not reaching storage keeps nothing, counts it, and throws nothing", async () => {
    const thrower = (where) => {
      const real = new IDBFactory();
      return {
        open(...a) {
          if (where === "open") throw new DOMException("blocked", "SecurityError");
          const req = real.open(...a);
          if (where === "error") {
            const fail = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
            queueMicrotask(() => fail.onerror?.());
            return fail;
          }
          if (where === "transaction")
            req.addEventListener("success", () => {
              req.result.transaction = () => {
                throw new DOMException("quota", "QuotaExceededError");
              };
            });
          return req;
        },
      };
    };
    for (const indexedDB of [undefined, null, thrower("open"), thrower("error"), thrower("transaction")]) {
      const c = contentCache({ indexedDB });
      expect(await c.put("x", ROM)).toBe(false);
      expect(await c.get("x")).toBe(null);
      await c.delete("x");
      expect(c.stats).toMatchObject({ hits: 0, puts: 0, failed: 2 });
    }
  });
});

describe("provide", () => {
  // The session plays content made of one IWAD and one PWAD with arguments.
  const iw = wad("IWAD", ["E1M1", "THINGS", "LINEDEFS"]);
  const pw = wad("PWAD", ["E1M1", "SECTORS"]);
  const ARGS = ["-warp", "1", "1"];
  const content = pack("parts", ARGS, [iw, pw]);
  const NAMES = ["doom.wad", "mod.wad"];
  // Candidates: the content, each file, a content packed with other arguments
  // (holding the same files), another IWAD of the same name, a modified copy
  // of the IWAD (same size), and a ROM.
  const other = wad("IWAD", ["MAP01", "THINGS"]);
  const modified = Uint8Array.from(iw);
  modified[modified.length - 1] ^= 1;
  const C = {
    content: { name: "session.content", bytes: content },
    iwad: { name: "doom.wad", bytes: iw },
    pwad: { name: "mod.wad", bytes: pw },
    repacked: { name: "other-game.content", bytes: pack("parts", ["-skill", "1"], [iw, pw]) },
    otherIwad: { name: "DOOM.WAD", bytes: other },
    modified: { name: "copy.wad", bytes: modified },
    rom: { name: "unarmed.sfc", bytes: ROM },
  };

  /** The rule, stated apart from the code: which candidate completes the content, if any. */
  function rule(order, withRecipe) {
    const have = new Set();
    for (const k of order) {
      if (k === "content") return k;
      if (!withRecipe) continue;
      if (k === "iwad" || k === "repacked") have.add("iwad");
      if (k === "pwad" || k === "repacked") have.add("pwad");
      if (have.has("iwad") && have.has("pwad")) return k;
    }
    return null;
  }

  test("every ordering of up to three of seven candidates, with and without the recipe: found exactly when the rule says, from the candidate it says", async () => {
    const r = await recipe(content, "parts", NAMES);
    const want = r.content;
    const keys = Object.keys(C);
    const orders = [[]];
    for (const a of keys) {
      orders.push([a]);
      for (const b of keys) {
        if (b === a) continue;
        orders.push([a, b]);
        for (const c of keys) if (c !== a && c !== b) orders.push([a, b, c]);
      }
    }
    expect(orders.length).toBe(1 + 7 + 42 + 210);
    let found = 0;
    for (const order of orders)
      for (const withRecipe of [false, true]) {
        const got = await provide(want, { recipe: withRecipe ? r : null, candidates: order.map((k) => C[k]) });
        const expected = rule(order, withRecipe);
        expect([order, withRecipe, got.ok ? got.from : null]).toEqual([order, withRecipe, expected ? C[expected].name : null]);
        if (got.ok) {
          found++;
          expect(Buffer.compare(Buffer.from(got.bytes), Buffer.from(content))).toBe(0);
          expect(got.made).toBe(expected !== "content");
        } else {
          // Every candidate that is no part of it is explained; what is still needed is listed.
          const useless = order.filter((k) => !(withRecipe && ["iwad", "pwad", "repacked"].includes(k)));
          expect(got.explain.map((e) => e.name)).toEqual(useless.map((k) => C[k].name));
          if (withRecipe) expect(got.needs.length).toBeGreaterThan(0);
        }
      }
    expect(found).toBe(297); // the rule's own count over the 260 orderings, twice
  });

  test("explains each wrong candidate: another file of the same name, a modified copy, an unrelated file, no recipe", async () => {
    const r = await recipe(content, "parts", NAMES);
    const got = await provide(r.content, { recipe: r, candidates: [C.otherIwad, C.modified, C.rom] });
    expect(got.ok).toBe(false);
    expect(got.needs.map((f) => f.name)).toEqual(NAMES);
    const [o, m, u] = got.explain;
    expect(o.why).toMatch(/^the session plays another doom\.wad: 60 bytes, SHA-256 [0-9a-f]{12}…; this one is 44 bytes/);
    expect(o.what).toBe("a Doom IWAD: 2 lumps, 1 maps (MAP01), 44 bytes");
    expect(m.why).toMatch(/^it is the size of doom\.wad but not that file .*another revision, or a modified copy$/);
    expect(u.why).toBe("it is not one of the session's files, which are doom.wad (60 bytes), mod.wad (44 bytes)");
    expect(u.what).toBe('a Super NES cartridge, "Unarmed" (LoROM), 256 KB');
    const bare = await provide(r.content, { candidates: [C.iwad] });
    expect(bare.explain[0].why).toContain("without the session's recipe");
    await expect(provide("0".repeat(64), { recipe: r })).rejects.toThrow("the recipe is for content");
  });

  test("a recipe whose files are all here but make other content says so; a recipe that is not one is refused by saying how", async () => {
    const r = await recipe(content, "parts", NAMES);
    // The right files under a recipe with other arguments, or another packing, claiming this content.
    for (const [forged, candidates] of [
      [{ ...r, args: ["-warp", "1", "2"] }, [C.iwad, C.pwad]],
      [{ ...r, pack: "raw", args: undefined, files: [r.files[0]] }, [C.iwad]],
    ]) {
      const got = await provide(r.content, { recipe: forged, candidates });
      expect(got).toMatchObject({ ok: false, needs: [], explain: [] });
      expect(got.recipe).toMatch(/^every file the recipe names is here, but packed as it says they make [0-9a-f]{12}…, not the session's [0-9a-f]{12}…: the recipe is not this content's$/);
    }
    // ...and the content itself still wins under it.
    expect(await provide(r.content, { recipe: { ...r, args: [] }, candidates: [C.iwad, C.pwad, C.content] })).toMatchObject({ ok: true, from: "session.content" });
    const bad = [
      ["a recipe", "not an object"], // (null is no recipe at all)
      [{ ...r, content: "x" }, "its content is not a SHA-256"],
      ...["constructor", "toString", "__proto__", "nope", 7].map((p) => [{ ...r, pack: p }, `no packing ${JSON.stringify(p)}`]),
      [{ ...r, files: "x" }, "it names no files"],
      [{ ...r, files: [] }, "it names no files"],
      [{ ...r, files: [{}] }, "a file is not { name, size, sha256 }"],
      [{ ...r, files: [{ ...r.files[0], sha256: "AB" }] }, "a file is not { name, size, sha256 }"],
      [{ ...r, args: "-warp 1 1" }, "its args are not strings"],
      [{ ...r, pack: "raw" }, "raw content is one file and no arguments"],
    ];
    for (const [rec, why] of bad) await expect(provide(r.content, { recipe: rec, candidates: [C.iwad] })).rejects.toThrow(`not a content recipe: ${why}`);
    expect(() => pack("constructor", [], [iw])).toThrow('no packing "constructor"');
  });

  test("the cache: what checks out is kept and found next time without candidates; what no longer checks out is forgotten", async () => {
    const indexedDB = new IDBFactory();
    const r = await recipe(content, "parts", NAMES);
    const first = contentCache({ indexedDB });
    expect(await provide(r.content, { recipe: r, cache: first, candidates: [C.iwad, C.pwad] })).toMatchObject({ ok: true, from: "mod.wad", made: true });
    const later = contentCache({ indexedDB });
    const again = await provide(r.content, { cache: later });
    expect(again).toMatchObject({ ok: true, from: "cache", made: false });
    expect(Buffer.compare(Buffer.from(again.bytes), Buffer.from(content))).toBe(0);
    // Storage hands back other bytes under the hash: forgotten, and the candidates are tried.
    await later.put(r.content, ROM);
    expect(await provide(r.content, { cache: later, candidates: [C.content] })).toMatchObject({ ok: true, from: "session.content" });
    expect(await provide(r.content, { cache: contentCache({ indexedDB }) })).toMatchObject({ ok: true, from: "cache" });
    // No storage at all: still found, from the candidates.
    const none = contentCache({ indexedDB: undefined });
    expect(await provide(r.content, { cache: none, candidates: [C.content] })).toMatchObject({ ok: true, from: "session.content" });
  });

  test("an asset doc the scene links is a candidate: its bytes, named with its extension", async () => {
    const r = await recipe(content, "parts", NAMES);
    const docs = [
      { "@patchwork": { type: "file" }, name: "doom", extension: "wad", mimeType: "application/octet-stream", content: iw },
      { "@patchwork": { type: "file" }, name: "mod.wad", extension: ".wad", content: pw.buffer },
      { "@patchwork": { type: "file" }, name: "notes", extension: "txt", content: "text, not bytes" },
      { "@patchwork": { type: "file" }, name: "empty" },
    ];
    const candidates = docs.map(fileCandidate);
    expect(candidates.map((c) => c?.name ?? null)).toEqual(["doom.wad", "mod.wad", null, null]);
    expect(await provide(r.content, { recipe: r, candidates: candidates.filter(Boolean) })).toMatchObject({ ok: true, from: "mod.wad", made: true });
  });

  test.skipIf(!haveIwad)("Freedoom from a dropped freedoom1.wad, by a recipe made from the session's content", async () => {
    const one = readFileSync(iwadPath);
    const args = ["-skill", "4", "-warp", "1", "1", "-players", "4"];
    const session = doomContent({ wads: [one], args });
    const r = await recipe(session, "parts", ["freedoom1.wad"]);
    expect(r.files[0]).toEqual({ name: "freedoom1.wad", size: 28795076, sha256: "7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d" });
    const candidates = [{ name: "freedoom1.wad", bytes: one }];
    if (existsSync(iwad2Path)) candidates.unshift({ name: "freedoom2.wad", bytes: readFileSync(iwad2Path) });
    const got = await provide(r.content, { recipe: r, candidates });
    expect(got).toMatchObject({ ok: true, from: "freedoom1.wad", made: true });
    const wrong = await provide(r.content, { recipe: r, candidates: candidates.slice(0, -1) });
    if (candidates.length > 1) expect(wrong.explain[0].why).toBe("it is not one of the session's files, which is freedoom1.wad (27.46 MB, Freedoom: Phase 1, 0.13.0 (freedoom1.wad))");
  });
});
