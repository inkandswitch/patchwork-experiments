// The extension (extension.js): its offer as a function of the trait alone,
// the offer's identity while the trait is unchanged, and the Place and Now
// commands, over finite tables on a fake api.
import { afterEach, describe, expect, it, vi } from "vitest";
import { plugins } from "./index.js";
import { atmosphereOf } from "./atmosphere.js";
import { instantOf } from "./time.js";
import { DEFAULTS, PLACES, sumOf, weatherParams, windOf } from "./weather.js";
import ext, { HERE, SHOW, TRAIT, coordinates, nowWrites, offerOf, placeState, placeWrites, provenanceTitle } from "./extension.js";

const INIT = plugins[0].describes.weather.init;
const [CADBORO, UCLUELET] = PLACES;
const GREY = { ...INIT, place: "Ucluelet", lat: 48.95, lon: -125.558, cover: 1, clouds: "stratocumulus", base: 600, visibility: 19000, wind: 5, from: 300 };

/** A fake api over a doc held here: doc() and change(fn), each change counted, the doc replaced (as a handle's snapshot is). */
function fakeApi(traits) {
  const api = {
    d: { traits: structuredClone(traits) },
    changes: 0,
    doc: () => api.d,
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
    ["malformed (wind a string, an offset zone, a bad date)", { wind: "7", zone: "+05:30", date: "2026-02-30" }, true],
    ["with a source", { ...INIT, source: { name: "Open-Meteo", sum: "x" } }, true],
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
    api.change((d) => (d.traits[TRAIT].source = { name: "Open-Meteo", sum: "s" }));
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

  it("Now's title names the zone in force", () => {
    expect(ext.create(withTrait({ zone: "Asia/Kolkata" })).commands[1].state(null, {}).title).toBe("Set the weather's date and hour to the present in Asia/Kolkata");
    expect(ext.create(withTrait({ zone: "+05:30" })).commands[1].state(null, {}).title).toBe("Set the weather's date and hour to the present in America/Vancouver");
  });

});

describe("Place", () => {
  it("the places: Cadboro Bay is the defaults', Ucluelet terrain's origin", () => {
    expect(PLACES).toEqual([
      { place: "Cadboro Bay", lat: 48.454, lon: -123.2915, zone: "America/Vancouver" },
      { place: "Ucluelet", lat: 48.95, lon: -125.558, zone: "America/Vancouver" },
    ]);
    expect({ place: DEFAULTS.place, lat: DEFAULTS.lat, lon: DEFAULTS.lon, zone: DEFAULTS.zone }).toEqual(CADBORO);
  });

  const two = [
    { value: "Cadboro Bay", label: "Cadboro Bay" },
    { value: "Ucluelet", label: "Ucluelet" },
  ];
  // [name, trait, value shown, choices]
  const states = [
    ["{} (the defaults: Cadboro)", {}, "Cadboro Bay", two],
    ["Ucluelet", { ...UCLUELET }, "Ucluelet", two],
    ["Cadboro's coordinates under another name (the name is a label)", { ...CADBORO, place: "RVYC" }, "Cadboro Bay", two],
    ["Cadboro's coordinates in another zone", { ...CADBORO, zone: "UTC" }, HERE, [...two, { value: HERE, label: "48.4540° N, 123.2915° W" }]],
    ["Port Hardy", { place: "Port Hardy", lat: 50.7, lon: -127.42 }, HERE, [...two, { value: HERE, label: "50.7000° N, 127.4200° W" }]],
    ["Sydney", { place: "Sydney", lat: -33.86, lon: 151.21, zone: "Australia/Sydney" }, HERE, [...two, { value: HERE, label: "33.8600° S, 151.2100° E" }]],
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

  const writesFor = (q) => ({ place: q.place, lat: q.lat, lon: q.lon, zone: q.zone });
  // [trait, choice] → the fields written
  const rows = [
    ["{}", {}, "Cadboro Bay", writesFor(CADBORO)],
    ["{}", {}, "Ucluelet", writesFor(UCLUELET)],
    ["{}", {}, HERE, {}],
    ["init (Cadboro)", INIT, "Cadboro Bay", {}],
    ["init (Cadboro)", INIT, "Ucluelet", { place: "Ucluelet", lat: 48.95, lon: -125.558 }],
    ["init (Cadboro)", INIT, HERE, {}],
    ["Ucluelet", { ...UCLUELET }, "Cadboro Bay", { place: "Cadboro Bay", lat: 48.454, lon: -123.2915 }],
    ["Ucluelet", { ...UCLUELET }, "Ucluelet", {}],
    ["Port Hardy in UTC", { place: "Port Hardy", lat: 50.7, lon: -127.42, zone: "UTC" }, "Ucluelet", writesFor(UCLUELET)],
    ["Port Hardy in UTC", { place: "Port Hardy", lat: 50.7, lon: -127.42, zone: "UTC" }, HERE, {}],
    ["RVYC at Cadboro's coordinates", { ...CADBORO, place: "RVYC" }, "Cadboro Bay", { place: "Cadboro Bay" }],
    ["lat as a string", { ...CADBORO, lat: "48.454" }, "Cadboro Bay", { lat: 48.454 }],
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
    expect(api.d.traits[TRAIT]).toEqual({ ...INIT, place: "Ucluelet", lat: 48.95, lon: -125.558 });
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
  // [zone in the trait, the instant] → the date and hour written (the minute floored)
  const rows = [
    [{}, "2026-07-15T22:00:30Z", { date: "2026-07-15", hour: 15 }],
    [{}, "2026-07-15T22:07:59.999Z", { date: "2026-07-15", hour: 15 + 7 / 60 }],
    [{}, "2026-07-16T06:59:59Z", { date: "2026-07-15", hour: 23 + 59 / 60 }],
    [{}, "2026-07-16T07:00:00Z", { date: "2026-07-16", hour: 0 }],
    [{}, "2026-01-15T23:00:00Z", { date: "2026-01-15", hour: 15 }],
    [{ zone: "Asia/Kolkata" }, "2026-07-15T09:30:00Z", { date: "2026-07-15", hour: 15 }],
    [{ zone: "Pacific/Chatham" }, "2026-07-15T02:15:00Z", { date: "2026-07-15", hour: 15 }],
    [{ zone: "UTC" }, "2026-12-31T23:59:30Z", { date: "2026-12-31", hour: 23 + 59 / 60 }],
    [{ zone: "+05:30" }, "2026-07-15T22:00:00Z", { date: "2026-07-15", hour: 15 }],
    [{ date: "2026-07-15", hour: 15 }, "2026-07-15T22:00:59Z", {}],
    [{ date: "2026-07-15", hour: 9 }, "2026-07-15T22:00:00Z", { hour: 15 }],
  ];
  for (const [trait, iso, writes] of rows) it(`${JSON.stringify(trait)} at ${iso} → ${JSON.stringify(writes)}`, () => expect(nowWrites(trait, at(iso))).toEqual(writes));
  for (const t of [undefined, null, true, []]) it(`no trait to write into (${JSON.stringify(t)}) → null`, () => expect(nowWrites(t, 0)).toBe(null));

  // The sun Now sets is the present minute's: every minute of five days (a
  // summer day, the spring-forward day and the fall-back day in Vancouver,
  // Kolkata, Chatham) written by Now reads back through instantOf as that
  // minute, but for exactly the 60 minutes of the fall-back's second pass,
  // which read an hour early (Decision 13's overlap rule: the earlier
  // instant).
  it("puts the sun at the present minute, but for the fall-back's repeated hour", () => {
    const days = [
      ["2026-07-15T07:00:00Z", "America/Vancouver"],
      ["2026-03-08T08:00:00Z", "America/Vancouver"],
      ["2026-11-01T07:00:00Z", "America/Vancouver"],
      ["2026-07-14T18:30:00Z", "Asia/Kolkata"],
      ["2026-07-14T11:15:00Z", "Pacific/Chatham"],
    ];
    const early = [];
    let n = 0;
    for (const [start, zone] of days)
      for (let m = 0; m < 26 * 60; m++) {
        const t = at(start) + m * 60_000 + 59_999;
        const w = { ...nowWrites({ zone }, t), zone };
        const back = instantOf(w);
        n++;
        if (back !== t - 59_999) {
          expect(back).toBe(t - 59_999 - 3_600_000);
          early.push(new Date(t - 59_999).toISOString());
        }
        expect(w.hour).toBeLessThan(24);
      }
    expect(n).toBe(5 * 26 * 60);
    expect(early).toEqual(Array.from({ length: 60 }, (_, i) => new Date(at("2026-11-01T09:00:00Z") + i * 60_000).toISOString()));
  });

  it("run: writes the present, read from the clock, in one change; again in the same minute, nothing", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-07-15T19:45:10Z"));
    const api = withTrait(INIT);
    const now = ext.create(api).commands[1];
    now.run(null);
    expect(api.changes).toBe(1);
    expect(api.d.traits[TRAIT]).toEqual({ ...INIT, hour: 12.75 });
    vi.setSystemTime(at("2026-07-15T19:45:50Z"));
    now.run(null);
    now.run("obj1");
    expect(api.changes).toBe(1);
  });
});

describe("the Place tooltip says the provenance", () => {
  const fetched = (t, source) => ({ ...t, source: { ...source, sum: sumOf(weatherParams(t)) } });
  const src = { name: "Open-Meteo", api: "forecast", for: "2026-07-15T22:00Z", fetched: "2026-07-15T22:03:00Z" };
  const rows = [
    ["no source", INIT, "Weather: dialled by hand"],
    ["a source with no sum", { ...INIT, source: { name: "Open-Meteo" } }, "Weather: dialled by hand"],
    ["fetched", fetched(INIT, src), "Weather: as fetched from Open-Meteo (forecast) for 2026-07-15T22:00Z"],
    ["fetched, the seed dialled since (not summed)", { ...fetched(INIT, src), seed: 9 }, "Weather: as fetched from Open-Meteo (forecast) for 2026-07-15T22:00Z"],
    ["the wind dialled since", { ...fetched(INIT, src), wind: 9 }, "Weather: dialled since it was fetched from Open-Meteo (forecast) for 2026-07-15T22:00Z"],
    ["fetched, a source of no name, api or time", fetched(INIT, {}), "Weather: as fetched from an unnamed source"],
    ["fetched, a source whose strings aren't", fetched(INIT, { name: 7, api: {}, for: null }), "Weather: as fetched from an unnamed source"],
  ];
  for (const [name, trait, title] of rows)
    it(`${name}`, () => {
      expect(provenanceTitle(trait)).toBe(title);
      expect(placeState(trait).title).toBe(title);
    });
});
