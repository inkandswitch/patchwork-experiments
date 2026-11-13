// chartroom-link.js's RULE, over every provider set in a finite universe.
//
// A provider is a kind: how it claims the datatype (by name, by wildcard,
// or another datatype), what it says it offers (the table, only
// marine-geometry, or no `formats` at all), what its fingerprint says
// against the mesh's (the same hull, none, another hull, or it throws),
// and what its table is (valid, invalid, it throws, or it has no
// hydrostaticTable). For every set the result must be the oracle's, a
// function of the set alone, written here independently of the module:
//
// - candidates: claim by name or wildcard, and the table in `formats`;
// - refused: a candidate whose fingerprint names another hull;
// - the rest ranked (name before wildcard, same before unknown, then id);
//   the first whose table checks out is read; the ones ranked before it
//   failed, the ones after it were never asked;
// - a table is computed for exactly the ranked candidates up to the one
//   read (never for a refused one, never after one is read);
// - absent exactly when there are no candidates.
//
// Every single kind (144), every ordered pair of the 32 candidate kinds
// in both registration orders, and every ordered triple of them in all six
// registration orders; and singles and pairs again against a GLB that
// states no fingerprint (then nothing is refused and nothing is "same").

import { describe, it, expect } from "vitest";
import { chartroomTableFor, chartroomProviders, rankCompare, sameHull, claimOf, offers, TABLE_FORMAT } from "./chartroom-link.js";
import { boxTable } from "../test/tables.js";

const DATATYPE = "camber-hull";
const MESH_PRINT = "camber-hull-surface/6:hull";
const VALID = boxTable({ L: 10, B: 3, D: 2 });
const INVALID = { ...VALID, format: "not-a-table" };

const CLAIMS = ["exact", "wildcard", "other"];
const FORMATS = ["listed", "unlisted", "absent"];
const PRINTS = ["same", "unknown", "different", "throws"];
const TABLES = ["valid", "invalid", "throws", "missing"];

const KINDS = CLAIMS.flatMap((claim) => FORMATS.flatMap((formats) => PRINTS.flatMap((print) => TABLES.map((table) => ({ claim, formats, print, table })))));
const CANDIDATE_KINDS = KINDS.filter((k) => k.claim !== "other" && k.formats === "listed");

/** A provider of a kind, with an id; `calls` records every table asked for. */
function provider(kind, id, calls) {
  const supportedDatatypes = kind.claim === "exact" ? [DATATYPE] : kind.claim === "wildcard" ? "*" : ["other-hull"];
  const formats = kind.formats === "listed" ? [TABLE_FORMAT, "marine-geometry/1"] : kind.formats === "unlisted" ? ["marine-geometry/1"] : undefined;
  const mod = {
    fingerprint:
      kind.print === "same" ? () => "hull" : kind.print === "different" ? () => "another" : kind.print === "throws" ? () => { throw new Error("no"); } : () => null,
  };
  if (kind.table !== "missing")
    mod.hydrostaticTable = async () => {
      calls.push(id);
      if (kind.table === "throws") throw new Error("it broke");
      return kind.table === "valid" ? VALID : INVALID;
    };
  return { type: "chartroom:source", id, name: `P-${id}`, supportedDatatypes, ...(formats ? { formats } : {}), version: 1, load: async () => mod, kind };
}

/** A registry holding these providers, registered in this order. */
const registryOf = (providers) => () => ({
  filter: (fn) => providers.filter(fn),
  load: async (id) => {
    const p = providers.find((x) => x.id === id);
    return p && { ...p, module: await p.load() };
  },
});

/** The oracle: what THE RULE says, from the set alone. */
function oracle(providers, meshPrint = MESH_PRINT) {
  const cands = providers.filter((p) => p.kind.claim !== "other" && p.kind.formats === "listed").sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!cands.length) return { absent: true, read: null, offers: [], calls: [] };
  // with no mesh fingerprint there is nothing to match or refuse: every verdict is "unknown"
  const verdict = (p) => (meshPrint == null ? "unknown" : p.kind.print === "same" ? "same" : p.kind.print === "different" ? "different" : "unknown");
  const refused = cands.filter((p) => verdict(p) === "different");
  const ranked = cands
    .filter((p) => verdict(p) !== "different")
    .map((p) => ({ p, claim: p.kind.claim, verdict: verdict(p), id: p.id }))
    .sort((a, b) => ({ exact: 0, wildcard: 1 })[a.claim] - ({ exact: 0, wildcard: 1 })[b.claim] || ({ same: 0, unknown: 1 })[a.verdict] - ({ same: 0, unknown: 1 })[b.verdict] || (a.id < b.id ? -1 : 1));
  let read = null;
  const out = [], calls = [];
  for (const r of ranked) {
    if (read) out.push([r.id, "not asked"]);
    else {
      if (r.p.kind.table !== "missing") calls.push(r.id);
      if (r.p.kind.table === "valid") {
        read = r;
        out.push([r.id, "read"]);
      } else out.push([r.id, "failed"]);
    }
  }
  for (const p of refused) out.push([p.id, "refused"]);
  return { absent: false, read: read && { id: read.id, verdict: read.verdict }, offers: out, calls };
}

async function run(providers, meshPrint = MESH_PRINT) {
  const calls = [];
  const ps = providers.map((p) => ({ ...p, load: provider(p.kind, p.id, calls).load }));
  const r = await chartroomTableFor({ doc: { title: "hull" }, datatype: DATATYPE, meshFingerprint: meshPrint, getRegistry: registryOf(ps) });
  return {
    absent: !r.ok && r.absent,
    read: r.ok ? { id: r.providerId, verdict: r.verdict } : null,
    offers: r.offers.map((o) => [o.id, o.outcome]),
    calls: [...calls].sort(),
    table: r.ok ? r.table : null,
  };
}

const describeKind = (k) => `${k.claim}/${k.formats}/${k.print}/${k.table}`;
const permutations = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

async function check(kinds, orders, meshPrint = MESH_PRINT) {
  const ids = ["a", "b", "c"];
  const providers = kinds.map((k, i) => provider(k, ids[i], []));
  const want = oracle(providers, meshPrint);
  for (const order of orders(providers)) {
    const got = await run(order, meshPrint);
    const label = `${kinds.map(describeKind).join(" + ")} registered ${order.map((p) => p.id).join("")}`;
    expect({ absent: got.absent, read: got.read, offers: got.offers, calls: got.calls }, label).toEqual({ ...want, calls: [...want.calls].sort() });
    if (got.read) expect(got.table, label).toBe(VALID);
  }
}

describe("chartroom:source: no provider is the provider", () => {
  it(`every single provider kind (${KINDS.length}): a candidate exactly when it claims the datatype and lists the table`, async () => {
    for (const k of KINDS) await check([k], (ps) => [ps]);
  });

  it(`every ordered pair of the ${CANDIDATE_KINDS.length} candidate kinds, in both registration orders (${CANDIDATE_KINDS.length ** 2} sets)`, async () => {
    for (const a of CANDIDATE_KINDS) for (const b of CANDIDATE_KINDS) await check([a, b], (ps) => permutations(ps));
  }, 60_000);

  it(`every ordered triple of the ${CANDIDATE_KINDS.length} candidate kinds, in all six registration orders (${CANDIDATE_KINDS.length ** 3} sets)`, async () => {
    for (const a of CANDIDATE_KINDS) for (const b of CANDIDATE_KINDS) for (const c of CANDIDATE_KINDS) await check([a, b, c], (ps) => permutations(ps));
  }, 240_000);

  it(`a GLB that states no fingerprint: every single kind, and every ordered pair of candidates in both orders, none refused, ranked by claim then id`, async () => {
    for (const k of KINDS) await check([k], (ps) => [ps], null);
    for (const a of CANDIDATE_KINDS) for (const b of CANDIDATE_KINDS) await check([a, b], (ps) => permutations(ps), null);
  }, 60_000);

  it("a candidate that isn't a candidate never changes the answer: each pair of one candidate and one non-candidate is the candidate alone", async () => {
    const non = KINDS.filter((k) => !(k.claim !== "other" && k.formats === "listed"));
    for (const c of CANDIDATE_KINDS)
      for (const n of non) {
        const alone = oracle([provider(c, "a", [])]);
        const both = await run([provider(n, "b", []), provider(c, "a", [])]);
        expect({ absent: both.absent, read: both.read, offers: both.offers }, `${describeKind(c)} + ${describeKind(n)}`).toEqual({ absent: alone.absent, read: alone.read, offers: alone.offers });
      }
  }, 60_000);

  it("the pieces: claims, offers, the rank's total order, and two providers with one id count once", () => {
    expect(claimOf({ supportedDatatypes: [DATATYPE] }, DATATYPE)).toBe("exact");
    expect(claimOf({ supportedDatatypes: [DATATYPE, "*"] }, DATATYPE)).toBe("exact");
    expect(claimOf({ supportedDatatypes: ["*"] }, DATATYPE)).toBe("wildcard");
    expect(claimOf({ supportedDatatypes: "*" }, null)).toBe("wildcard");
    expect(claimOf({ supportedDatatypes: [DATATYPE] }, null)).toBeNull();
    expect(claimOf({}, DATATYPE)).toBeNull();
    expect(offers({ formats: [TABLE_FORMAT] }, TABLE_FORMAT)).toBe(true);
    expect(offers({}, TABLE_FORMAT)).toBe(false);
    // rankCompare is a total order on (claim, verdict, id): antisymmetric and transitive over every triple
    const items = ["exact", "wildcard"].flatMap((claim) => ["same", "unknown"].flatMap((verdict) => ["a", "b"].map((id) => ({ claim, verdict, id }))));
    for (const x of items)
      for (const y of items) {
        expect(Math.sign(rankCompare(x, y)) + Math.sign(rankCompare(y, x))).toBe(0);
        if (x !== y) expect(rankCompare(x, y)).not.toBe(0);
        for (const z of items) if (rankCompare(x, y) < 0 && rankCompare(y, z) < 0) expect(rankCompare(x, z)).toBeLessThan(0);
      }
    // two descriptions under one id are one provider, with the stronger claim, in either order
    const exact = { id: "x", supportedDatatypes: [DATATYPE], formats: [TABLE_FORMAT] };
    const wild = { id: "x", supportedDatatypes: "*", formats: [TABLE_FORMAT] };
    const unlisted = { id: "x", supportedDatatypes: [DATATYPE], formats: ["marine-geometry/1"] };
    for (const list of permutations([exact, wild, unlisted])) expect(chartroomProviders(list, DATATYPE).map((c) => [c.id, c.claim])).toEqual([["x", "exact"]]);
    for (const list of permutations([wild, unlisted])) expect(chartroomProviders(list, DATATYPE).map((c) => [c.id, c.claim])).toEqual([["x", "wildcard"]]);
    expect(sameHull(MESH_PRINT, "hull")).toBe("same");
  });

  it("no registry, or nothing registered: absent, nothing offered", async () => {
    expect(await chartroomTableFor({ doc: {}, datatype: DATATYPE, getRegistry: registryOf([]) })).toMatchObject({ ok: false, absent: true, offers: [] });
    expect(await chartroomTableFor({ doc: {}, datatype: DATATYPE, getRegistry: () => { throw new Error("none"); } })).toMatchObject({ ok: false, absent: true, offers: [] });
  });
});
