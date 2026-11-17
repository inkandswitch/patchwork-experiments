// The extension (extension.js): its offer as a function of the trait alone,
// the offer's identity while the trait is unchanged, and the Place and Now
// commands, over finite tables on a fake api.
import { afterEach, describe, expect, it, vi } from "vitest";
import { plugins } from "./index.js";
import { atmosphereOf } from "./atmosphere.js";
import { instantOf } from "./time.js";
import { DEFAULTS, PLACES, fetchedFields, provenance, weatherParams, windOf } from "./weather.js";
import { NAME, NO_DATA, UNITS, VARIABLES, isoMinute, requestFor, snapshotFrom } from "./open-meteo.js";
import ext, { HERE, PLACE_TITLE, SHOW, TRAIT, clockName, clockText, coordinates, fetchLabel, fetchRequest, fetchWrites, forText, isWorlds, nowWrites, offerOf, placeState, placeWrites, provenanceTitle } from "./extension.js";

const INIT = plugins[0].describes.weather.init;
const [CADBORO, UCLUELET] = PLACES;
const GREY = { ...INIT, lat: 48.95, lon: -125.558, cover: 1, clouds: "stratocumulus", base: 600, visibility: 19000, wind: 5, from: 300 };

/**
 * A fake api over a doc held here: doc() and change(fn), each change
 * counted, the doc replaced (as a handle's snapshot is); and ambient(name)
 * as the stage answers it, `mine` while this stage is the outermost
 * (api.world: "mine", "linked" — another stage is the outermost and offers
 * a wind — or "none" — the outermost offers none).
 */
function fakeApi(traits) {
  const api = {
    d: { traits: structuredClone(traits) },
    changes: 0,
    world: "mine",
    notices: [],
    doc: () => api.d,
    notify: (text, kind = "info") => void api.notices.push([kind, text]),
    ambient: (name) => (api.world === "none" ? null : { value: { name }, mine: api.world === "mine" }),
    change(fn) {
      const draft = structuredClone(api.d);
      fn(draft);
      api.changes++;
      api.d = draft;
    },
  };
  return api;
}
const withTrait = (t) => fakeApi(t === undefined ? {} : { [TRAIT]: t });

/**
 * scene's rule for `edit: true` (scene/src/stage/bodies.js inBody and
 * editing, at e74b9ef7), copied: packages don't import each other. A
 * command's state on a surface is null outside it.
 */
const inBody = (command, view) => command?.edit !== true || view?.body?.id === "edit";
const stateIn = (command, target, body) => (inBody(command, { body: { id: body } }) ? command.state(target, {}) : null);

describe("the offer: a function of the trait alone", () => {
  // [name, trait, offers?]
  const rows = [
    ["absent", undefined, false],
    ["null", null, false],
    ["false", false, false],
    ["0", 0, false],
    ['""', "", false],
    ["true (a trait with no fields: every default)", true, true],
    ["{}", {}, true],
    ["init", INIT, true],
    ["Ukee grey", GREY, true],
    ["malformed (wind a string, an offset written as text, a bad date)", { wind: "7", offset: "-08:00", date: "2026-02-30" }, true],
    ["with a source", { ...INIT, source: { name: "Open-Meteo", fields: { wind: 3 } } }, true],
  ];
  for (const [name, trait, offers] of rows)
    it(`trait ${name} → ${offers ? "{ wind, atmosphere } of its params" : "null"}`, () => {
      const got = ext.create(withTrait(trait)).ambient();
      if (!offers) return expect(got).toBe(null);
      const p = weatherParams(trait);
      expect(Object.keys(got)).toEqual(["wind", "atmosphere"]);
      expect(got).toEqual({ wind: windOf(p), atmosphere: atmosphereOf(p) });
      expect(got).toEqual(offerOf(trait));
      expect(JSON.parse(JSON.stringify(got))).toEqual(got);
    });

  // The only thing ambient() may read is doc().traits.weather: an api with
  // nothing else on it, and a doc and traits map that throw on any other key.
  it("reads nothing but doc().traits.weather", () => {
    const only = (obj, keys) => new Proxy(obj, { get: (o, k) => (keys.includes(k) ? o[k] : (() => { throw new Error(`read ${String(k)}`); })()) });
    const traits = only({ [TRAIT]: GREY }, [TRAIT]);
    const doc = only({ traits }, ["traits"]);
    const api = only({ doc: () => doc }, ["doc"]);
    expect(ext.create(api).ambient()).toEqual(offerOf(GREY));
  });

  it("is the same for the same trait whatever else the doc holds", () => {
    const a = fakeApi({ [TRAIT]: GREY });
    const b = fakeApi({ [TRAIT]: structuredClone(GREY), water: { kind: "sea" }, other: 1 });
    b.d.objects = { x: { name: "boat" } };
    expect(ext.create(a).ambient()).toEqual(ext.create(b).ambient());
  });
});

describe("the offer is === while the trait in force is unchanged", () => {
  it("across flushes, a doc replaced by a copy, a source added and a key nothing reads", () => {
    const api = withTrait(INIT);
    const x = ext.create(api);
    const first = x.ambient();
    expect(x.ambient()).toBe(first);
    api.d = structuredClone(api.d);
    expect(x.ambient()).toBe(first);
    api.change((d) => (d.traits[TRAIT].source = { name: "Open-Meteo", fields: { wind: 3 } }));
    expect(x.ambient()).toBe(first);
    api.change((d) => (d.traits[TRAIT].colour = "red"));
    expect(x.ambient()).toBe(first);
    // a field written as its own default: the params in force are the same
    api.change((d) => (d.traits[TRAIT] = {}));
    expect(x.ambient()).toBe(first);
  });

  it("a new offer when a field in force changes, and null when the trait goes", () => {
    const api = withTrait(INIT);
    const x = ext.create(api);
    const first = x.ambient();
    api.change((d) => (d.traits[TRAIT].hour = 9));
    const nine = x.ambient();
    expect(nine).not.toBe(first);
    expect(nine.atmosphere.sun.direction).not.toEqual(first.atmosphere.sun.direction);
    expect(nine.wind).toEqual(first.wind);
    api.change((d) => (d.traits[TRAIT].hour = 15));
    expect(x.ambient()).toEqual(first);
    api.change((d) => delete d.traits[TRAIT]);
    expect(x.ambient()).toBe(null);
  });

  // The cache's key and the offer share one condition: a trait that is
  // falsy offers nothing, and the moment it becomes a trait the offer
  // appears, though the params in force are the defaults either way.
  it.each([
    ["absent", undefined],
    ["false", false],
    ["null", null],
    ["0", 0],
  ])("%s, then {}: null, then the defaults' offer", (_, falsy) => {
    const api = withTrait(falsy);
    const x = ext.create(api);
    expect(x.ambient()).toBe(null);
    api.change((d) => (d.traits[TRAIT] = {}));
    expect(x.ambient()).toEqual(offerOf({}));
    api.change((d) => (d.traits[TRAIT] = falsy));
    expect(x.ambient()).toBe(null);
  });

  // The ambient reads no time-zone data, so no two peers' runtimes can put
  // the sun in different places for one doc (Decision 15): with Intl gone,
  // every offer is the same.
  it("is the same with the runtime's Intl gone", () => {
    const traits = [INIT, GREY, { date: "2026-12-15", hour: 8.5 }, { date: "2026-11-01", hour: 1.5, offset: -8 }, { lat: -33.86, lon: 151.21, offset: 11, date: "2026-12-21", hour: 6 }];
    const want = traits.map(offerOf);
    try {
      vi.stubGlobal("Intl", undefined);
      expect(traits.map(offerOf)).toEqual(want);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the commands", () => {
  const commands = ext.create(withTrait({})).commands;

  // Three, not four: Now then Fetch for this time is the present
  // conditions, so a "Fetch now" would be the same snapshot (Decision 42).
  it("are Place, Now and Fetch for this time, each the editor's, on the toolbar and the menu", () => {
    expect(commands.map((c) => [c.id, c.name, c.edit, c.show])).toEqual([
      ["place", "Place", true, SHOW],
      ["now", "Now", true, SHOW],
      ["fetch", "Fetch for this time", true, SHOW],
    ]);
    expect(SHOW).toEqual(["toolbar", "menu"]);
  });

  // Each command × body: in no body but Edit (scene's commandState asks
  // inBody first, so outside Edit no surface shows it and no key runs it).
  for (const c of commands)
    for (const [body, applies] of [["look", false], ["edit", true], ["walk", false], ["seat", false], ["aboard", false]])
      it(`${c.id} in ${body}: ${applies ? "applies" : "null"}`, () => expect(stateIn(c, null, body) != null).toBe(applies));

  // Each command × target × trait, in Edit: only the scene, only a trait with fields to write into.
  for (const c of commands)
    for (const [tname, trait, applies] of [["{}", {}, true], ["init", INIT, true], ["absent", undefined, false], ["true", true, false], ["an array", [], false]])
      for (const target of [null, "obj1", "dimension:d1"])
        it(`${c.id}, target ${target}, trait ${tname}: ${applies && target == null ? "applies" : "null"}`, () => {
          const x = ext.create(withTrait(trait)).commands.find((y) => y.id === c.id);
          expect(x.state(target, {}) != null).toBe(applies && target == null);
        });

  // Each command × where this stage is: the commands are the world's
  // weather's only. A linked world's weather is not in force (the outermost
  // rule), so in a stage that isn't the outermost they don't apply, and run
  // writes nothing (Decision 31).
  for (const c of commands)
    for (const [world, applies] of [["mine", true], ["linked", false], ["none", false]])
      it(`${c.id}, this stage's world ${world}: ${applies ? "applies" : "null, and run writes nothing"}`, async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.parse("2026-11-16T21:47:00Z"));
        const fetch = vi.fn(fakeFetch());
        vi.stubGlobal("fetch", fetch);
        try {
          const api = withTrait({ date: "2026-11-10", hour: 3, lat: 1, lon: 1 });
          api.world = world;
          const x = ext.create(api).commands.find((y) => y.id === c.id);
          expect(x.state(null, {}) != null).toBe(applies);
          x.run(null, "Ucluelet");
          await settle();
          expect(api.changes).toBe(applies ? 1 : 0);
          expect(fetch).toHaveBeenCalledTimes(applies && c.id.startsWith("fetch") ? 1 : 0);
        } finally {
          vi.unstubAllGlobals();
          vi.useRealTimers();
        }
      });

  it.each([
    ["mine", { mine: true }, true],
    ["linked", { mine: false }, false],
    ["none (the outermost offers no wind)", null, false],
    ["an api with no ambient", undefined, false],
    ["mine only when strictly true", { mine: 1 }, false],
  ])("isWorlds: %s → %s", (_, answer, want) => {
    const api = answer === undefined ? {} : { ambient: (name) => (expect(name).toBe("wind"), answer) };
    expect(isWorlds(api)).toBe(want);
  });

  it("Now's title names the clock in force", () => {
    expect(ext.create(withTrait({ offset: 5.75 })).commands[1].state(null, {}).title).toBe("Set the weather's date and hour to the present quarter hour on its clock (UTC+5:45); Fetch for this time then fetches the present conditions");
    expect(ext.create(withTrait({ offset: "+05:30" })).commands[1].state(null, {}).title).toBe("Set the weather's date and hour to the present quarter hour on its clock (UTC\u22127); Fetch for this time then fetches the present conditions");
  });

  it.each([
    [0, "UTC"],
    [-7, "UTC\u22127"],
    [-12, "UTC\u221212"],
    [14, "UTC+14"],
    [5.5, "UTC+5:30"],
    [12.75, "UTC+12:45"],
    [-3.5, "UTC\u22123:30"],
    [-0.25, "UTC\u22120:15"],
  ])("clockName(%s) → %s", (offset, want) => expect(clockName(offset)).toBe(want));

});

describe("Place", () => {
  it("the places: Cadboro Bay is the defaults', Ucluelet terrain's origin, both on British Columbia's clock", () => {
    expect(PLACES).toEqual([
      { name: "Cadboro Bay", lat: 48.454, lon: -123.2915, offset: -7 },
      { name: "Ucluelet", lat: 48.95, lon: -125.558, offset: -7 },
    ]);
    expect({ lat: DEFAULTS.lat, lon: DEFAULTS.lon, offset: DEFAULTS.offset }).toEqual({ lat: CADBORO.lat, lon: CADBORO.lon, offset: CADBORO.offset });
  });

  const two = [
    { value: "Cadboro Bay", label: "Cadboro Bay" },
    { value: "Ucluelet", label: "Ucluelet" },
  ];
  // [name, trait, value shown, choices]
  const states = [
    ["{} (the defaults: Cadboro)", {}, "Cadboro Bay", two],
    ["Ucluelet", { lat: UCLUELET.lat, lon: UCLUELET.lon }, "Ucluelet", two],
    ["Cadboro's coordinates on another clock (the clock is when, not where)", { offset: 0 }, "Cadboro Bay", two],
    ["a key named place (not a field: nothing reads it)", { place: "Ucluelet" }, "Cadboro Bay", two],
    ["Port Hardy", { lat: 50.7, lon: -127.42 }, HERE, [...two, { value: HERE, label: "50.7000° N, 127.4200° W" }]],
    ["Sydney", { lat: -33.86, lon: 151.21, offset: 11 }, HERE, [...two, { value: HERE, label: "33.8600° S, 151.2100° E" }]],
    ["lat out of range (clamped: the picker shows what's in force)", { lat: 120 }, HERE, [...two, { value: HERE, label: "90.0000° N, 123.2915° W" }]],
  ];
  for (const [name, trait, value, choices] of states)
    it(`state for ${name}: ${value}`, () => {
      const s = placeState(trait);
      expect(s.value).toBe(value);
      expect(s.choices).toEqual(choices);
      expect(s.choices.map((c) => c.value)).toContain(s.value);
    });

  it("coordinates: the equator and the prime meridian read N and E", () => expect(coordinates(0, 0)).toBe("0.0000° N, 0.0000° E"));

  const writesFor = (q) => ({ lat: q.lat, lon: q.lon, offset: q.offset });
  // [trait, choice] → the fields written
  const rows = [
    ["{}", {}, "Cadboro Bay", writesFor(CADBORO)],
    ["{}", {}, "Ucluelet", writesFor(UCLUELET)],
    ["{}", {}, HERE, {}],
    ["init (Cadboro)", INIT, "Cadboro Bay", {}],
    ["init (Cadboro)", INIT, "Ucluelet", { lat: 48.95, lon: -125.558 }],
    ["init (Cadboro)", INIT, HERE, {}],
    ["Ucluelet", { ...INIT, ...writesFor(UCLUELET) }, "Cadboro Bay", { lat: 48.454, lon: -123.2915 }],
    ["Ucluelet", { ...INIT, ...writesFor(UCLUELET) }, "Ucluelet", {}],
    ["Cadboro on UTC", { ...INIT, offset: 0 }, "Cadboro Bay", { offset: -7 }],
    ["Port Hardy on UTC", { lat: 50.7, lon: -127.42, offset: 0 }, "Ucluelet", writesFor(UCLUELET)],
    ["Port Hardy on UTC", { lat: 50.7, lon: -127.42, offset: 0 }, HERE, {}],
    ["lat as a string", { ...INIT, lat: "48.454" }, "Cadboro Bay", { lat: 48.454 }],
    ["{}", {}, "Nowhere", {}],
    ["{}", {}, undefined, {}],
  ];
  for (const [name, trait, choice, writes] of rows) it(`${name} × ${String(choice)} → ${JSON.stringify(writes)}`, () => expect(placeWrites(trait, choice)).toEqual(writes));
  for (const t of [undefined, null, true, [], 7]) it(`no trait to write into (${JSON.stringify(t)}) → null`, () => expect(placeWrites(t, "Ucluelet")).toBe(null));

  it("run: one change of exactly the fields that differ; none for here, an object target or no trait", () => {
    const api = withTrait(INIT);
    const place = ext.create(api).commands[0];
    place.run(null, "Ucluelet");
    expect(api.changes).toBe(1);
    expect(api.d.traits[TRAIT]).toEqual({ ...INIT, lat: 48.95, lon: -125.558 });
    place.run(null, "Ucluelet");
    place.run(null, HERE);
    place.run("obj1", "Cadboro Bay");
    expect(api.changes).toBe(1);
    api.d = { traits: {} };
    place.run(null, "Cadboro Bay");
    expect(api.changes).toBe(1);
    expect(api.d.traits).toEqual({});
  });

  it("run: a trait gone by the time the change applies is not made again", () => {
    const api = withTrait({});
    const place = ext.create(api).commands[0];
    const change = api.change;
    api.change = (fn) => change((d) => (delete d.traits[TRAIT], fn(d)));
    place.run(null, "Ucluelet");
    expect(api.d.traits).toEqual({});
  });
});

describe("Now", () => {
  afterEach(() => vi.useRealTimers());
  const at = (iso) => Date.parse(iso);
  // [the trait's clock, the instant] → the date and hour written (the quarter hour floored)
  const rows = [
    [{}, "2026-07-15T22:00:30Z", { date: "2026-07-15", hour: 15 }],
    [{}, "2026-07-15T22:14:59.999Z", { date: "2026-07-15", hour: 15 }],
    [{}, "2026-07-15T22:15:00Z", { date: "2026-07-15", hour: 15.25 }],
    [{}, "2026-07-15T22:44:00Z", { date: "2026-07-15", hour: 15.5 }],
    [{}, "2026-07-16T06:59:59Z", { date: "2026-07-15", hour: 23.75 }],
    [{}, "2026-07-16T07:00:00Z", { date: "2026-07-16", hour: 0 }],
    [{}, "2026-12-15T22:00:00Z", { date: "2026-12-15", hour: 15 }],
    [{ offset: -8 }, "2026-01-15T23:00:00Z", { date: "2026-01-15", hour: 15 }],
    [{ offset: 5.5 }, "2026-07-15T09:30:00Z", { date: "2026-07-15", hour: 15 }],
    [{ offset: 5.75 }, "2026-07-15T09:15:00Z", { date: "2026-07-15", hour: 15 }],
    [{ offset: 12.75 }, "2026-07-15T02:15:00Z", { date: "2026-07-15", hour: 15 }],
    [{ offset: 0 }, "2026-12-31T23:59:30Z", { date: "2026-12-31", hour: 23.75 }],
    [{ offset: "+05:30" }, "2026-07-15T22:00:00Z", { date: "2026-07-15", hour: 15 }],
    [{ date: "2026-07-15", hour: 15 }, "2026-07-15T22:10:00Z", {}],
    [{ date: "2026-07-15", hour: 9 }, "2026-07-15T22:00:00Z", { hour: 15 }],
  ];
  for (const [trait, iso, writes] of rows) it(`${JSON.stringify(trait)} at ${iso} → ${JSON.stringify(writes)}`, () => expect(nowWrites(trait, at(iso))).toEqual(writes));
  for (const t of [undefined, null, true, []]) it(`no trait to write into (${JSON.stringify(t)}) → null`, () => expect(nowWrites(t, 0)).toBe(null));

  // The sun Now sets is the present quarter hour's, exactly: over every
  // minute of two days on eight clocks, the hour Now writes is on the hour
  // slider's step and below 24, and reads back through instantOf as the
  // quarter hour that minute is in. No exceptions: a clock has no gaps and
  // no repeated hours.
  it("puts the sun at the present quarter hour, every minute of two days on eight clocks", () => {
    const Q = 15 * 60_000;
    let n = 0;
    for (const offset of [-12, -8, -7, 0, 5.5, 5.75, 12.75, 14])
      for (const start of ["2026-07-15T00:00:00Z", "2026-12-31T12:00:00Z"])
        for (let m = 0; m < 24 * 60; m++) {
          const t = at(start) + m * 60_000 + 59_999;
          const w = nowWrites({ offset }, t);
          expect(Number.isInteger(w.hour * 4) && w.hour >= 0 && w.hour < 24).toBe(true);
          expect(instantOf({ ...w, offset })).toBe(Math.floor(t / Q) * Q);
          n++;
        }
    expect(n).toBe(8 * 2 * 24 * 60);
  });

  it("run: writes the present, read from the clock, in one change; again in the same quarter hour, nothing; an object target, nothing", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-07-15T19:45:10Z"));
    const api = withTrait(INIT);
    const now = ext.create(api).commands[1];
    now.run(null);
    expect(api.changes).toBe(1);
    expect(api.d.traits[TRAIT]).toEqual({ ...INIT, hour: 12.75 });
    vi.setSystemTime(at("2026-07-15T19:59:50Z"));
    now.run(null);
    expect(api.changes).toBe(1);
    // a later quarter hour, so a write would be due: on an object, none
    vi.setSystemTime(at("2026-07-15T20:30:00Z"));
    now.run("obj1");
    expect(api.changes).toBe(1);
    now.run(null);
    expect(api.changes).toBe(2);
    expect(api.d.traits[TRAIT].hour).toBe(13.5);
  });
});

describe("the provenance, said", () => {
  const fetched = (t, source) => ({ ...t, source: { ...source, fields: fetchedFields(weatherParams(t)) } });
  const src = { name: "Open-Meteo", api: "forecast", for: "2026-07-15T22:00:00.000Z", fetched: "2026-07-15T22:03:00.000Z" };
  // [name, trait, provenanceTitle, fetchLabel]
  const rows = [
    ["no source", INIT, "Weather: dialled by hand", "Fetch for this time"],
    ["a source with no fields", { ...INIT, source: { name: "Open-Meteo" } }, "Weather: dialled by hand", "Fetch for this time"],
    ["fetched", fetched(INIT, src), "Weather: as fetched from Open-Meteo (forecast) for 2026-07-15 15:00 UTC\u22127", "Fetched for this time"],
    ["fetched, read on another clock", fetched({ ...INIT, offset: 5.5 }, src), "Weather: as fetched from Open-Meteo (forecast) for 2026-07-16 03:30 UTC+5:30", "Fetched for this time"],
    ["fetched, the seed dialled since (not weather)", { ...fetched(INIT, src), seed: 9 }, "Weather: as fetched from Open-Meteo (forecast) for 2026-07-15 15:00 UTC\u22127", "Fetched for this time"],
    ["the wind dialled since", { ...fetched(INIT, src), wind: 9 }, "Weather: dialled since it was fetched from Open-Meteo (forecast) for 2026-07-15 15:00 UTC\u22127 (wind)", "Fetch again (wind)"],
    ["the hour and the cover dialled since", { ...fetched(INIT, src), cover: 1, hour: 9 }, "Weather: dialled since it was fetched from Open-Meteo (forecast) for 2026-07-15 15:00 UTC\u22127 (hour, cover)", "Fetch again (hour, cover)"],
    ["three dialled since", { ...fetched(INIT, src), cover: 1, hour: 9, rain: 2 }, "Weather: dialled since it was fetched from Open-Meteo (forecast) for 2026-07-15 15:00 UTC\u22127 (hour, cover, rain)", "Fetch again (3 dialled)"],
    ["fetched, a source of no name, api or time", fetched(INIT, {}), "Weather: as fetched from an unnamed source", "Fetched for this time"],
    ["fetched, a source whose strings aren't", fetched(INIT, { name: 7, api: {}, for: null }), "Weather: as fetched from an unnamed source", "Fetched for this time"],
    ["fetched, a time that isn't one", fetched(INIT, { ...src, for: "teatime" }), "Weather: as fetched from Open-Meteo (forecast)", "Fetched for this time"],
  ];
  for (const [name, trait, title, label] of rows)
    it(`${name}: "${label}"`, () => {
      expect(provenanceTitle(trait)).toBe(title);
      expect(fetchLabel(trait)).toBe(label);
      const fetch = ext.create(withTrait(trait)).commands.find((c) => c.id === "fetch").state(null, {});
      expect(fetch.label).toBe(label);
      expect(fetch.title.startsWith(`${title}. Fetch ${NAME}'s conditions at `)).toBe(true);
      expect(placeState(trait).title).toBe(PLACE_TITLE);
    });

  it.each([
    [{ date: "2026-07-15", hour: 15 }, -7, "2026-07-15 15:00 UTC\u22127"],
    [{ date: "2026-07-15", hour: 0 }, 0, "2026-07-15 00:00 UTC"],
    [{ date: "2026-07-15", hour: 23.75 }, 5.75, "2026-07-15 23:45 UTC+5:45"],
    [{ date: "0050-01-01", hour: 9.25 }, -8, "0050-01-01 09:15 UTC\u22128"],
  ])("clockText(%j, %s) → %s", (when, offset, want) => expect(clockText(when, offset)).toBe(want));

  it.each([
    ["2026-07-15T22:00:00.000Z", -7, "2026-07-15 15:00 UTC\u22127"],
    ["2026-07-15T22:00Z", -7, "2026-07-15 15:00 UTC\u22127"],
    ["2026-07-16T06:45:00.000Z", -7, "2026-07-15 23:45 UTC\u22127"],
    ["teatime", -7, null],
    [7, -7, null],
    [undefined, -7, null],
  ])("forText(%s, %s) → %s", (value, offset, want) => expect(forText(value, offset)).toBe(want));
});

// ─── fetching ────────────────────────────────────────────────────────────────

const Q = 15 * 60_000;
/** Let a run's fetch, its reply and its write all happen. */
const settle = () => new Promise((r) => setTimeout(r, 0));
/** One hour of weather, as Open-Meteo sends it: a low overcast at 250 m, 6.2 m/s from 250 gusting 8.06. */
const HOUR_VALUES = { temperature_2m: 12, dew_point_2m: 10, relative_humidity_2m: 88, precipitation: 0, weather_code: 3, cloud_cover: 100, cloud_cover_low: 100, cloud_cover_mid: 0, cloud_cover_high: 0, visibility: 9000, wind_speed_10m: 6.2, wind_direction_10m: 250, wind_gusts_10m: 8.06 };
const SNAPPED = { wind: 6.2, from: 250, gustiness: 0.3, cover: 1, clouds: "stratus", base: 250, visibility: 9000, rain: 0 };
/**
 * A fake fetch answering any request as Open-Meteo would with HOUR_VALUES:
 * the present conditions for the present quarter hour, or every hour of the
 * day asked; `answer` overrides it with a reply ([status, body]) or throws.
 */
function fakeFetch(answer) {
  return async (url) => {
    if (answer instanceof Error) throw answer;
    const u = new URL(url);
    const units = { time: "iso8601", ...UNITS };
    let body;
    if (answer) body = answer[1];
    else if (u.searchParams.has("current")) body = { utc_offset_seconds: 0, current_units: { ...units, interval: "seconds" }, current: { time: isoMinute(Math.floor(Date.now() / Q) * Q), interval: 900, ...HOUR_VALUES } };
    else {
      const day = Date.parse(`${u.searchParams.get("start_date")}T00:00Z`);
      const time = Array.from({ length: 24 }, (_, h) => isoMinute(day + h * 3_600_000));
      body = { utc_offset_seconds: 0, hourly_units: units, hourly: { time, ...Object.fromEntries(VARIABLES.map((k) => [k, time.map(() => HOUR_VALUES[k])])) } };
    }
    const status = answer ? answer[0] : 200;
    return { status, ok: status < 300, json: async () => structuredClone(body) };
  };
}

describe("Fetch: the requests", () => {
  const NOW = Date.parse("2026-11-16T21:47:00Z");
  // Now floors to the quarter hour, so the time it writes is within 15
  // minutes of now, inside the present conditions' 30: Now then Fetch for
  // this time is always the present conditions (Decision 42).
  it("after Now, Fetch for this time asks for the present conditions, for the present quarter hour on the weather's clock", () => {
    const r = fetchRequest({ ...INIT, ...nowWrites(INIT, NOW) }, NOW);
    expect(r).toEqual(requestFor({ ...weatherParams(INIT), date: "2026-11-16", hour: 14.75 }, NOW));
    expect(r.route).toBe("current");
  });
  it("after Now, at every minute of an hour on four clocks: the present conditions", () => {
    for (const offset of [-7, 0, 5.75, 14])
      for (let m = 0; m < 60; m++) {
        const t = NOW - 47 * 60_000 + m * 60_000;
        const trait = { ...INIT, offset };
        expect(fetchRequest({ ...trait, ...nowWrites(trait, t) }, t).route).toBe("current");
      }
  });
  it("Fetch for this time: the place, date and hour in force", () => {
    expect(fetchRequest(INIT, NOW)).toEqual(requestFor(weatherParams(INIT), NOW));
    expect(fetchRequest(INIT, NOW).route).toBe("hourly");
    expect(fetchRequest({ ...INIT, date: "2026-12-25" }, NOW)).toBe(null);
  });
  for (const t of [undefined, null, true, []])
    it(`no trait to write into (${JSON.stringify(t)}): no request`, () => expect(fetchRequest(t, NOW)).toBe(null));
});

describe("Fetch: what a snapshot writes", () => {
  const NOW = Date.parse("2026-11-16T21:47:00Z");
  const snapshot = (trait) => {
    const request = fetchRequest(trait, NOW);
    return snapshotFrom(fakeReply(request), request);
  };
  const fakeReply = (request) => {
    const day = Date.parse(`${new URL(request.url).searchParams.get("start_date")}T00:00Z`);
    const time = Array.from({ length: 24 }, (_, h) => isoMinute(day + h * 3_600_000));
    return { utc_offset_seconds: 0, hourly_units: { time: "iso8601", ...UNITS }, hourly: { time, ...Object.fromEntries(VARIABLES.map((k) => [k, time.map(() => HOUR_VALUES[k])])) } };
  };
  // [trait] → the fields written besides source
  const rows = [
    ["init (its gustiness and rain already the snapshot's)", INIT, { wind: 6.2, from: 250, cover: 1, clouds: "stratus", base: 250, visibility: 9000 }],
    ["init, the snapshot's wind and cover already", { ...INIT, wind: 6.2, cover: 1 }, { from: 250, clouds: "stratus", base: 250, visibility: 9000 }],
    ["{} (every field its default)", {}, { lat: DEFAULTS.lat, lon: DEFAULTS.lon, date: DEFAULTS.date, hour: DEFAULTS.hour, offset: DEFAULTS.offset, ...SNAPPED }],
    ["the snapshot itself", null, {}],
  ];
  for (const [name, t, want] of rows)
    it(`${name} → ${JSON.stringify(want)} and source`, () => {
      const s = snapshot(t ?? INIT);
      const trait = t ?? { ...INIT, ...s };
      const { source, ...fields } = fetchWrites(trait, s);
      expect(fields).toEqual(want);
      expect(source).toEqual(s.source);
      // written over the trait, it reads "fetched", its seed its own
      const after = { ...trait, ...fields, source };
      expect(provenance(after)).toBe("fetched");
      expect(after.seed).toBe(trait.seed);
    });
  for (const t of [undefined, null, true, []]) it(`no trait (${JSON.stringify(t)}) → null`, () => expect(fetchWrites(t, snapshot(INIT))).toBe(null));
});

describe("Fetch: run", () => {
  const NOW = Date.parse("2026-11-16T21:47:00Z");
  let fetch;
  const setup = (trait = INIT, answer) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    fetch = vi.fn(fakeFetch(answer));
    vi.stubGlobal("fetch", fetch);
    const api = withTrait(trait);
    const x = ext.create(api);
    const cmd = (id) => x.commands.find((c) => c.id === id);
    return { api, x, cmd };
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("Fetch for this time (15 July 2026, from the archive): one fetch, one change: the snapshot's fields and source; a notice says it", async () => {
    const { api, cmd } = setup();
    cmd("fetch").run(null);
    expect(api.changes).toBe(0);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(fetchRequest(INIT, NOW).url);
    expect(api.changes).toBe(1);
    const w = api.d.traits[TRAIT];
    expect(w).toEqual({ ...INIT, ...SNAPPED, source: { name: NAME, api: "archive", for: "2026-07-15T22:00:00.000Z", fetched: new Date(NOW).toISOString(), fields: fetchedFields(weatherParams({ ...INIT, ...SNAPPED })) } });
    expect(new URL(fetch.mock.calls[0][0]).origin).toBe("https://archive-api.open-meteo.com");
    expect(provenance(w)).toBe("fetched");
    expect(api.notices).toEqual([["info", `Weather fetched from ${NAME} (archive) for 2026-07-15 15:00 UTC\u22127`]]);
    expect(cmd("fetch").state(null, {}).label).toBe("Fetched for this time");
  });

  it("Now, then Fetch for this time: the present quarter hour, then the present conditions", async () => {
    const { api, cmd } = setup();
    cmd("now").run(null);
    expect(api.changes).toBe(1);
    cmd("fetch").run(null);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.has("current")).toBe(true);
    expect(api.changes).toBe(2);
    const w = api.d.traits[TRAIT];
    expect(w).toMatchObject({ date: "2026-11-16", hour: 14.75, ...SNAPPED });
    expect(w.source.for).toBe("2026-11-16T21:45:00.000Z");
    expect(provenance(w)).toBe("fetched");
    expect(cmd("fetch").state(null, {}).label).toBe("Fetched for this time");
  });

  // [name, answer] → the notice; nothing written
  const failures = [
    ["an error reply", [400, { error: true, reason: "Parameter 'start_date' is out of allowed range" }], "Couldn't fetch the weather: Parameter 'start_date' is out of allowed range"],
    ["a server error", [503, { message: "busy" }], `Couldn't fetch the weather: ${NAME} answered 503`],
    ["a reply with no wind", [200, { utc_offset_seconds: 0, hourly_units: {}, hourly: { time: ["2026-07-15T22:00"] } }], `Couldn't fetch the weather: ${NAME} has no wind for 2026-07-15T22:00 GMT`],
    ["a failed fetch", new TypeError("Failed to fetch"), "Couldn't fetch the weather: Failed to fetch"],
  ];
  for (const [name, answer, notice] of failures)
    it(`${name}: a notice, and nothing written`, async () => {
      const { api, cmd } = setup(INIT, answer);
      cmd("fetch").run(null);
      await settle();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(api.changes).toBe(0);
      expect(api.d.traits[TRAIT]).toEqual(INIT);
      expect(api.notices).toEqual([["error", notice]]);
    });

  it("a time with no weather: the command is disabled, says why, and run fetches nothing", async () => {
    const { api, cmd } = setup({ ...INIT, date: "2026-12-25" });
    expect(cmd("fetch").state(null, {})).toEqual({ label: "Fetch for this time", disabled: true, title: NO_DATA });
    cmd("fetch").run(null);
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(api.changes).toBe(0);
    expect(api.notices).toEqual([["error", NO_DATA]]);
  });

  it("the stage stopping while the fetch is out: nothing written, nothing said", async () => {
    const { api, cmd } = setup();
    const stop = new AbortController();
    api.signal = stop.signal;
    cmd("fetch").run(null);
    stop.abort();
    await settle();
    expect(api.changes).toBe(0);
    expect(api.notices).toEqual([]);
  });

  // The stage's signal is the fetch's: stopping the stage aborts the fetch
  // itself, whatever reason it aborts with, and says nothing.
  for (const [name, reason] of [
    ["no reason (an AbortError)", undefined],
    ["a plain Error", new Error("the stage stopped")],
  ])
    it(`the stage's signal reaches the fetch; stopping it with ${name}: the fetch rejects, nothing written, nothing said`, async () => {
      const { api, cmd } = setup();
      const stop = new AbortController();
      api.signal = stop.signal;
      const pending = vi.fn((url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
      vi.stubGlobal("fetch", pending);
      cmd("fetch").run(null);
      await settle();
      expect(pending).toHaveBeenCalledTimes(1);
      expect(pending.mock.calls[0][1].signal).toBe(api.signal);
      stop.abort(reason);
      await settle();
      expect(api.changes).toBe(0);
      expect(api.notices).toEqual([]);
    });

  it("an aborted fetch (AbortError): nothing said", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { api, cmd } = setup(INIT, abort);
    cmd("fetch").run(null);
    await settle();
    expect(api.changes).toBe(0);
    expect(api.notices).toEqual([]);
  });

  it("no longer the world's when the reply lands: nothing written", async () => {
    const { api, cmd } = setup();
    cmd("fetch").run(null);
    api.world = "linked";
    await settle();
    expect(api.changes).toBe(0);
  });

  // Another extension may still offer the world's wind (sailing.weather,
  // until W5), so the stage is still the world's: the write finds no trait,
  // writes nothing, and nothing says it fetched.
  it("the trait gone when the reply lands: not made again, and no notice", async () => {
    const { api, cmd } = setup();
    cmd("fetch").run(null);
    delete api.d.traits[TRAIT];
    await settle();
    expect(api.d.traits).toEqual({});
    expect(api.notices).toEqual([]);
  });

  it("the trait gone when pressed (after the toolbar drew): no fetch, no notice", async () => {
    const { api, cmd } = setup();
    delete api.d.traits[TRAIT];
    cmd("fetch").run(null);
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(api.changes).toBe(0);
    expect(api.notices).toEqual([]);
  });

  it("a field dialled while the fetch is out, to the snapshot's value: left as it is; to another: the snapshot's", async () => {
    const { api, cmd } = setup();
    cmd("fetch").run(null);
    api.d.traits[TRAIT].wind = 6.2;
    api.d.traits[TRAIT].cover = 0.5;
    await settle();
    expect(api.d.traits[TRAIT]).toMatchObject(SNAPPED);
    expect(provenance(api.d.traits[TRAIT])).toBe("fetched");
  });

  it("an object target: nothing fetched", async () => {
    const { cmd } = setup();
    cmd("fetch").run("obj1");
    await settle();
    expect(fetch).not.toHaveBeenCalled();
  });
});

// The fetch is never automatic: making the extension, its offer and every
// command's state, over every trait and world the tables above use, call
// no fetch. Only a Fetch command's run does.
describe("nothing fetches on its own", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("create, ambient() and every state(), over every trait and world: no fetch", () => {
    const fetch = vi.fn(() => {
      throw new Error("fetched");
    });
    vi.stubGlobal("fetch", fetch);
    const traits = [undefined, null, {}, INIT, GREY, { ...INIT, date: "2026-12-25" }, { ...INIT, date: "1900-01-01" }, { ...INIT, source: { name: "Open-Meteo", fields: fetchedFields(weatherParams(INIT)) } }];
    for (const t of traits)
      for (const world of ["mine", "linked", "none"]) {
        const api = withTrait(t);
        api.world = world;
        const x = ext.create(api);
        x.ambient();
        x.ambient();
        for (const c of x.commands) for (const target of [null, "obj1"]) c.state(target, {});
      }
    expect(fetch).not.toHaveBeenCalled();
  });
});
