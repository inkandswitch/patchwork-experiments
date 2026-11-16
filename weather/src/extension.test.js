// The extension (extension.js): its offer as a function of the trait alone,
// the offer's identity while the trait is unchanged, and the Place and Now
// commands, over finite tables on a fake api.
import { afterEach, describe, expect, it, vi } from "vitest";
import { plugins } from "./index.js";
import { atmosphereOf } from "./atmosphere.js";
import { instantOf } from "./time.js";
import { DEFAULTS, PLACES, fetchedFields, weatherParams, windOf } from "./weather.js";
import ext, { HERE, SHOW, TRAIT, clockName, coordinates, isWorlds, nowWrites, offerOf, placeState, placeWrites, provenanceTitle } from "./extension.js";

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
    doc: () => api.d,
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

  it("are Place and Now, each the editor's, on the toolbar and the menu", () => {
    expect(commands.map((c) => [c.id, c.name, c.edit, c.show])).toEqual([
      ["place", "Place", true, SHOW],
      ["now", "Now", true, SHOW],
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
      it(`${c.id}, this stage's world ${world}: ${applies ? "applies" : "null, and run writes nothing"}`, () => {
        const api = withTrait({ date: "2001-01-01", hour: 3, lat: 1, lon: 1 });
        api.world = world;
        const x = ext.create(api).commands.find((y) => y.id === c.id);
        expect(x.state(null, {}) != null).toBe(applies);
        x.run(null, "Ucluelet");
        expect(api.changes).toBe(applies ? 1 : 0);
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
    expect(ext.create(withTrait({ offset: 5.75 })).commands[1].state(null, {}).title).toBe("Set the weather's date and hour to the present quarter hour on its clock (UTC+5:45)");
    expect(ext.create(withTrait({ offset: "+05:30" })).commands[1].state(null, {}).title).toBe("Set the weather's date and hour to the present quarter hour on its clock (UTC\u22127)");
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

describe("the Place tooltip says the provenance", () => {
  const fetched = (t, source) => ({ ...t, source: { ...source, fields: fetchedFields(weatherParams(t)) } });
  const src = { name: "Open-Meteo", api: "forecast", for: "2026-07-15T22:00Z", fetched: "2026-07-15T22:03:00Z" };
  const rows = [
    ["no source", INIT, "Weather: dialled by hand"],
    ["a source with no fields", { ...INIT, source: { name: "Open-Meteo" } }, "Weather: dialled by hand"],
    ["fetched", fetched(INIT, src), "Weather: as fetched from Open-Meteo (forecast) for 2026-07-15T22:00Z"],
    ["fetched, the seed dialled since (not weather)", { ...fetched(INIT, src), seed: 9 }, "Weather: as fetched from Open-Meteo (forecast) for 2026-07-15T22:00Z"],
    ["the wind dialled since", { ...fetched(INIT, src), wind: 9 }, "Weather: dialled since it was fetched from Open-Meteo (forecast) for 2026-07-15T22:00Z (wind)"],
    ["the hour and the cover dialled since", { ...fetched(INIT, src), cover: 1, hour: 9 }, "Weather: dialled since it was fetched from Open-Meteo (forecast) for 2026-07-15T22:00Z (hour, cover)"],
    ["fetched, a source of no name, api or time", fetched(INIT, {}), "Weather: as fetched from an unnamed source"],
    ["fetched, a source whose strings aren't", fetched(INIT, { name: 7, api: {}, for: null }), "Weather: as fetched from an unnamed source"],
  ];
  for (const [name, trait, title] of rows)
    it(`${name}`, () => {
      expect(provenanceTitle(trait)).toBe(title);
      expect(placeState(trait).title).toBe(title);
    });
});
