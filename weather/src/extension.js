// The weather extension (WEATHER.md): the `weather` scene trait offered as
// the world's `wind` and `atmosphere` ambients (scene STAGE.md, "Ambients"),
// and the three editing commands that set where and when it is, and fetch
// what it was there and then.
//
// ambient() is a pure function of the trait: the same trait gives the same
// offer on every peer, and while the trait is unchanged the offer is the same
// object (cached by the params in force), so
// the stage's per-flush merge does nothing. No trait, no offer.
//
// The commands are the editor's (`edit: true`: only while editing) and the
// scene's (the null target), and only the world's: a linked world's weather
// is not in force (the outermost rule), so its commands don't apply there
// (Decision 31). The scene inspector shows no scene commands (scene's
// inspector-model.js commandsFor: the null target gets none), so they are
// shown on the toolbar, which is the editor's and always in view then, and in the
// scene's menu (WEATHER.md Decision 28):
//   - Place: a picker of PLACES, plus the coordinates in force when the
//     weather is at none of them. Picking a place writes those of its lat,
//     lon and clock the trait doesn't already hold, in one change. Its
//     tooltip is the weather's provenance.
//   - Now: date and hour set to the present quarter hour on the weather's
//     clock.
//   - Fetch for this time: Open-Meteo's conditions for the place, date and
//     hour in force (after Now, the present conditions: Decision 42). Its
//     label says the provenance, its tooltip says it in full.
// A fetch runs in the pressing viewer's page and writes when the reply comes
// (open-meteo.js); a failure is a notice and writes nothing. Nothing else
// here fetches: ambient() and every state() only read the doc (Decision 33).
// All three are package writes (api.change), so none is on the undo stack
// (EDITOR.md, "Undo": only the editor records its writes; Question 6).

import { atmosphereOf } from "./atmosphere.js";
import { NAME, NO_DATA, fetchWeather, requestFor, snapshotFrom } from "./open-meteo.js";
import { localOf } from "./time.js";
import { FIELDS, PLACES, dialledSince, placeOf, provenance, weatherParams, windOf } from "./weather.js";

/** The trait this extension reads. */
export const TRAIT = "weather";

/** The Place picker's value for "the lat/lon in force, at none of PLACES": a read-out; picking it writes nothing. */
export const HERE = "here";

/** Where the commands are shown (the inspector would be the first choice: Decision 28). */
export const SHOW = Object.freeze(["toolbar", "menu"]);

/** The hour slider's step (index.js), in ms: what Now floors the present to. */
const STEP = FIELDS.find((f) => f.key === "hour").step * 3_600_000;
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** What a weather trait offers: { wind, atmosphere }, plain JSON; null for no trait. Pure. */
export function offerOf(trait) {
  if (!trait) return null;
  const p = weatherParams(trait);
  return { wind: windOf(p), atmosphere: atmosphereOf(p) };
}

/** A lat/lon as people read it: "48.4540° N, 123.2915° W". */
export const coordinates = (lat, lon) => `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? "W" : "E"}`;

/** A string the trait's source gives, or null (a peer wrote it: it is only ever shown as text). */
const text = (v) => (typeof v === "string" && v ? v : null);

/** A date and hour on a clock as people read it: "2026-07-15 15:00 UTC−7". */
export function clockText({ date, hour }, offset) {
  const m = Math.round(hour * 60);
  return `${date} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} ${clockName(offset)}`;
}

/** A source's `for` (ISO) as read on the weather's clock, or null when it isn't a time. */
export function forText(value, offset) {
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? clockText(localOf(t, offset), offset) : null;
}

/** Where the weather in force came from (provenance, said): the Fetch for this time tooltip's first sentence. */
export function provenanceTitle(trait) {
  const s = isMap(trait?.source) ? trait.source : {};
  const at = forText(s.for, weatherParams(trait).offset);
  const from = `${text(s.name) ?? "an unnamed source"}${text(s.api) ? ` (${s.api})` : ""}${at ? ` for ${at}` : ""}`;
  switch (provenance(trait)) {
    case "fetched":
      return `Weather: as fetched from ${from}`;
    case "dialled since fetch":
      return `Weather: dialled since it was fetched from ${from} (${dialledSince(trait).join(", ")})`;
    default:
      return "Weather: dialled by hand";
  }
}

/**
 * What Fetch for this time's button says: the provenance, short, so it shows
 * without hovering. "Fetch for this time" (dialled), "Fetched for this time"
 * (as fetched: pressing it fetches again), "Fetch again (hour, cover)" once
 * fields are dialled since (naming up to two, else counting them).
 */
export function fetchLabel(trait) {
  const d = dialledSince(trait);
  if (d == null) return "Fetch for this time";
  if (!d.length) return "Fetched for this time";
  return `Fetch again (${d.length <= 2 ? d.join(", ") : `${d.length} dialled`})`;
}

/** The Place picker's tooltip. */
export const PLACE_TITLE = "Where the weather is: picking a place moves it there, at the same hour on its clock";

/** The Place command's state for a trait: the picker (PLACES, and "here" when at none), or null without a trait to write into. */
export function placeState(trait) {
  if (!isMap(trait)) return null;
  const p = weatherParams(trait);
  const at = placeOf(p);
  const choices = PLACES.map((q) => ({ value: q.name, label: q.name }));
  if (!at) choices.push({ value: HERE, label: coordinates(p.lat, p.lon) });
  return { value: at ? at.name : HERE, choices, title: PLACE_TITLE };
}

/** The fields of `want` the trait doesn't already hold as they are. */
const differing = (trait, want) => Object.fromEntries(Object.entries(want).filter(([k, v]) => !Object.hasOwn(trait, k) || trait[k] !== v));

/**
 * What picking `value` on the Place picker writes: those of the place's lat,
 * lon and clock that differ (the date and hour stay: the same time of day,
 * there); {} for "here" or an unknown value; null without a trait.
 */
export function placeWrites(trait, value) {
  if (!isMap(trait)) return null;
  const q = PLACES.find((x) => x.name === value);
  return q ? differing(trait, { lat: q.lat, lon: q.lon, offset: q.offset }) : {};
}

/**
 * The present quarter hour at instant `t` on the weather's clock: { date,
 * hour }, localOf floored to the hour slider's step, so it is only ever a
 * value the slider can show, and the hour never reaches 24.
 */
export function presentOf(trait, t) {
  return localOf(Math.floor(t / STEP) * STEP, weatherParams(trait).offset);
}

/** What Now writes at instant `t`: the present quarter hour's date and hour, those that differ; null without a trait. */
export function nowWrites(trait, t) {
  if (!isMap(trait)) return null;
  return differing(trait, presentOf(trait, t));
}

/** What Fetch for this time asks for at instant `t`: the conditions for the place, date and hour in force; null without a trait, or for a time Open-Meteo has none for. */
export const fetchRequest = (trait, t) => (isMap(trait) ? requestFor(weatherParams(trait), t) : null);

/**
 * What a fetched snapshot (open-meteo.js snapshotFrom) writes over a trait:
 * those of its fields that differ, and its `source`, whole (a snapshot's
 * record is one value: two fetches at once leave one record, never a blend);
 * null without a trait. A field someone dials while the fetch is out is
 * written over only if the snapshot's value differs; one they dial after it
 * lands is theirs, and the provenance names it.
 */
export function fetchWrites(trait, snapshot) {
  if (!isMap(trait)) return null;
  const { source, ...fields } = snapshot;
  return { ...differing(trait, fields), source };
}

/** A clock as people read it: "UTC−7", "UTC+5:45", "UTC". */
export function clockName(offset) {
  if (offset === 0) return "UTC";
  const m = Math.round(Math.abs(offset) * 60);
  return `UTC${offset < 0 ? "\u2212" : "+"}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""}`;
}

/**
 * Whether this stage's weather is the world's: the outermost stage's
 * (STAGE.md "Ambients": api.ambient's `mine`). A linked world's weather is
 * not in force, so its commands would write a weather nothing shows.
 */
export const isWorlds = (api) => api.ambient?.("wind")?.mine === true;

export default {
  create(api) {
    const trait = () => api.doc()?.traits?.[TRAIT];

    /**
     * Fetch the weather for the trait's place and time as it is now, and
     * write its snapshot, in one change, when the reply comes: only while
     * this stage's weather is still the world's and has a trait to write
     * into, and saying so only when it wrote. No trait writes and says
     * nothing; a time with no weather, an error reply, a reply that isn't
     * weather or a failed fetch is a notice and writes nothing; the stage
     * stopping (its signal) drops the fetch silently.
     */
    async function fetchInto(t) {
      if (!isMap(trait())) return;
      const request = fetchRequest(trait(), t);
      if (!request) return void api.use("notices")?.notify(NO_DATA, "error");
      try {
        const snapshot = snapshotFrom(await fetchWeather(request, { signal: api.signal }), request);
        if (api.signal?.aborted || !isWorlds(api)) return;
        if (write(fetchWrites(trait(), snapshot))) api.use("notices")?.notify(`Weather fetched from ${NAME} (${snapshot.source.api}) for ${forText(snapshot.source.for, snapshot.offset)}`);
      } catch (err) {
        if (err?.name === "AbortError" || api.signal?.aborted) return;
        api.use("notices")?.notify(`Couldn't fetch the weather: ${err?.message ?? err}`, "error");
      }
    }

    /** Write fields into the trait, one change, field by field; nothing to write, or no trait by then, writes nothing. Whether it wrote. */
    function write(fields) {
      if (!fields || !Object.keys(fields).length) return false;
      let wrote = false;
      api.change((d) => {
        const w = d.traits?.[TRAIT];
        if (!isMap(w)) return;
        for (const [k, v] of Object.entries(fields)) w[k] = v;
        wrote = true;
      });
      return wrote;
    }

    let key;
    let offer = null;
    return {
      ambient() {
        const t = trait();
        const k = t ? JSON.stringify(weatherParams(t)) : null; // the offer's own condition: no trait, no offer
        if (k !== key) {
          key = k;
          offer = offerOf(t);
        }
        return offer;
      },
      commands: [
        {
          id: "place",
          name: "Place",
          edit: true,
          show: SHOW,
          state: (target) => (target == null && isWorlds(api) ? placeState(trait()) : null),
          run(target, value) {
            if (target == null && isWorlds(api)) write(placeWrites(trait(), value));
          },
        },
        {
          id: "now",
          name: "Now",
          edit: true,
          show: SHOW,
          state: (target) => {
            const t = trait();
            return target == null && isWorlds(api) && isMap(t) ? { title: `Set the weather's date and hour to the present quarter hour on its clock (${clockName(weatherParams(t).offset)}); Fetch for this time then fetches the present conditions` } : null;
          },
          run(target) {
            if (target == null && isWorlds(api)) write(nowWrites(trait(), Date.now()));
          },
        },
        {
          id: "fetch",
          name: "Fetch for this time",
          edit: true,
          show: SHOW,
          state: (target) => {
            const t = trait();
            if (target != null || !isWorlds(api) || !isMap(t)) return null;
            const label = fetchLabel(t);
            if (!fetchRequest(t, Date.now())) return { label, disabled: true, title: NO_DATA };
            const p = weatherParams(t);
            return { label, title: `${provenanceTitle(t)}. Fetch ${NAME}'s conditions at ${coordinates(p.lat, p.lon)} for ${clockText(p, p.offset)}` };
          },
          run(target) {
            if (target == null && isWorlds(api)) void fetchInto(Date.now());
          },
        },
      ],
    };
  },
};
