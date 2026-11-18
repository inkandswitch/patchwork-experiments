// tabletop-game v2: validation, in two stages, as naval's rig contract does.
//
//   structural: schema.json, read by a small interpreter of the JSON Schema
//               keywords the schema uses (type, const, enum, required,
//               properties, additionalProperties, propertyNames, items,
//               minItems, maxItems, minLength, pattern, minimum, maximum,
//               exclusiveMinimum, anyOf, $ref to #/$defs). A number must be
//               finite.
//   semantic:   the cross-field rules of GAME-FORMAT.md §9, each with the
//               error code the fixtures' manifest names, for the game and,
//               where it has a recipe (recipe.js), for each way its options
//               can be set, laid out.
//
// validate(game) → { ok, stage: null | "structural" | "semantic", errors: [{ code, path, message }] }
// Semantic rules run only once the structure is sound. No imports but the
// schema and the recipe, so a consumer can copy this folder whole.

import schema from "./schema.json" with { type: "json" };
import { applyRecipe, coerce, combinationCount, combinations, conditionProblem, layoutCost } from "./recipe.js";

const typeOk = (t, v) => {
  switch (t) {
    case "null":
      return v === null;
    case "boolean":
      return typeof v === "boolean";
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return Number.isInteger(v);
    case "array":
      return Array.isArray(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    default:
      return false;
  }
};

const resolve = (s) => {
  if (s && s.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    if (!m || !schema.$defs[m[1]]) throw new Error(`schema: unknown $ref ${s.$ref}`);
    return schema.$defs[m[1]];
  }
  return s;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const patterns = new Map();
const re = (p) => {
  if (!patterns.has(p)) patterns.set(p, new RegExp(p, "u"));
  return patterns.get(p);
};

/** Structural errors of v against schema s, appended to out. */
function check(s0, v, path, out) {
  const s = resolve(s0);
  if (s === true || s == null) return;
  if (s.anyOf) {
    // the branch whose `shape` / first required key matches says what's wrong, if one does
    const tries = s.anyOf.map((sub) => {
      const e = [];
      check(sub, v, path, e);
      return e;
    });
    if (tries.some((e) => e.length === 0)) return;
    const named = s.anyOf.findIndex((sub) => {
      const r = resolve(sub);
      const key = r.required?.[0];
      return key && v && typeof v === "object" && key in v && (!r.properties?.[key]?.const || same(r.properties[key].const, v[key]));
    });
    if (named >= 0) out.push(...tries[named]);
    else out.push({ code: "schema", path, message: "matches none of the allowed shapes" });
    return;
  }
  if ("const" in s && !same(v, s.const)) return void out.push({ code: "schema", path, message: `must be ${JSON.stringify(s.const)}` });
  if (s.enum && !s.enum.some((e) => same(e, v))) return void out.push({ code: "schema", path, message: `must be one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}` });
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeOk(t, v))) return void out.push({ code: "schema", path, message: `must be ${types.join(" or ")}` });
    if (v === null) return;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return void out.push({ code: "schema", path, message: "must be finite" });
    if (s.minimum != null && v < s.minimum) out.push({ code: "schema", path, message: `must be ≥ ${s.minimum}` });
    if (s.maximum != null && v > s.maximum) out.push({ code: "schema", path, message: `must be ≤ ${s.maximum}` });
    if (s.exclusiveMinimum != null && !(v > s.exclusiveMinimum)) out.push({ code: "schema", path, message: `must be > ${s.exclusiveMinimum}` });
  }
  if (typeof v === "string") {
    if (s.minLength != null && v.length < s.minLength) out.push({ code: "schema", path, message: s.minLength === 1 ? "must not be empty" : `needs at least ${s.minLength} characters` });
    if (s.pattern && !re(s.pattern).test(v)) out.push({ code: "schema", path, message: `must match ${s.pattern}` });
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) out.push({ code: "schema", path, message: `needs at least ${s.minItems} items` });
    if (s.maxItems != null && v.length > s.maxItems) out.push({ code: "schema", path, message: `takes at most ${s.maxItems} items` });
    if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, out));
  } else if (v !== null && typeof v === "object") {
    for (const k of s.required ?? []) if (!(k in v)) out.push({ code: "schema", path: `${path}.${k}`, message: "is required" });
    for (const [k, x] of Object.entries(v)) {
      if (s.propertyNames) check(s.propertyNames, k, `${path} key ${JSON.stringify(k)}`, out);
      if (s.properties && k in s.properties) check(s.properties[k], x, `${path}.${k}`, out);
      else if (s.additionalProperties === false) out.push({ code: "schema", path: `${path}.${k}`, message: "is not a field of tabletop-game v2" });
      else if (s.additionalProperties && typeof s.additionalProperties === "object") check(s.additionalProperties, x, `${path}.${k}`, out);
    }
  }
}

/** The structural stage alone. */
export function validateStructure(g) {
  const errors = [];
  check(schema, g, "$", errors);
  return errors;
}

// ───────────────────────────────── semantic rules (GAME-FORMAT.md §9)

/** Every thing in the setup, contents included, with its path: [{ thing, path, inBag }]. */
export function everyThing(setup, path = "$.setup", inBag = false, out = []) {
  setup.forEach((t, i) => {
    const p = `${path}[${i}]`;
    out.push({ thing: t, path: p, inBag });
    if (t.contents) everyThing(t.contents, `${p}.contents`, true, out);
  });
  return out;
}

/** The semantic stage, on a structurally sound game. */
export function validateSemantics(g) {
  const errors = [];
  const err = (code, path, message) => errors.push({ code, path, message });
  const pieces = g.pieces;
  const seats = g.seats ?? {};
  const isCard = (k) => typeof pieces[k]?.back === "string";

  // look: a piece is drawn one way: from parts, or as a document
  for (const [k, p] of Object.entries(pieces)) {
    const path = `$.pieces.${k}`;
    if (!!p.parts === !!p.doc) err("look", path, "give exactly one of parts or doc");
    if (p.back != null) {
      // card-back: a card's back is a piece of its own that isn't a card
      if (!pieces[p.back]) err("unknown-piece", `${path}.back`, `no piece "${p.back}"`);
      else if (isCard(p.back)) err("card-back", `${path}.back`, `"${p.back}" is a card itself: a back has no back`);
      else if (p.back === k) err("card-back", `${path}.back`, "a card can't be its own back");
    }
    // zone-box: a hand's box has some room in it
    if (p.zone && !p.zone.min.every((v, i) => v < p.zone.max[i])) err("zone-box", `${path}.zone`, "min must be below max on every axis");
    for (const [j, part] of (p.parts ?? []).entries()) {
      const pp = `${path}.parts[${j}]`;
      // image-rect: a cell lies within its image
      for (const side of ["top", "bottom"]) {
        const r = part[side]?.rect;
        if (r && (!(r[2] > 0) || !(r[3] > 0) || r[0] + r[2] > 1 + 1e-9 || r[1] + r[3] > 1 + 1e-9)) err("image-rect", `${pp}.${side}.rect`, "a rect is [x, y, w, h], w and h above 0, inside the image");
      }
      // cutout: a cut-out slab is cut by its top image
      if (part.shape === "slab" && part.outline === "cutout" && !part.top) err("cutout", pp, "a cutout slab needs a top image to cut it out");
      // aspect: a slab as wide as its image says is measured by its top image
      if (part.shape === "slab" && part.aspect === "image" && !part.top) err("aspect", pp, "a slab whose width follows its image needs a top image");
      if (part.shape === "lathe" && part.profile.some(([r]) => r < 0)) err("lathe-profile", `${pp}.profile`, "a lathe's radii are ≥ 0");
    }
    if (p.bag && isCard(k)) err("bag-card", path, "a card can't be a bag");
  }

  // things: ids unique; pieces, seats and targets exist
  const all = everyThing(g.setup);
  const byId = new Map();
  for (const a of all) if (a.thing.id != null && !byId.has(a.thing.id)) byId.set(a.thing.id, a);
  const ids = new Map();
  for (const { thing: t, path } of all) {
    if (t.id == null) continue;
    if (ids.has(t.id)) err("duplicate-id", `${path}.id`, `"${t.id}" is also ${ids.get(t.id)}`);
    else ids.set(t.id, path);
  }
  for (const { thing: t, path, inBag } of all) {
    if (t.piece != null) {
      const p = pieces[t.piece];
      if (!p) {
        err("unknown-piece", `${path}.piece`, `no piece "${t.piece}"`);
        continue;
      }
      if (t.seat != null) {
        if (!seats[t.seat]) err("unknown-seat", `${path}.seat`, `no seat "${t.seat}"`);
        if (!p.zone) err("seat-zone", `${path}.seat`, `"${t.piece}" has no zone: only a hand belongs to a seat`);
      }
      if (t.contents && !p.bag) err("contents-bag", `${path}.contents`, `"${t.piece}" isn't a bag`);
      if (t.grid && (t.count ?? 1) < 2) err("grid-count", `${path}.grid`, "a grid lays out several copies: give a count of 2 or more");
      if (inBag && t.seat != null) err("seat-zone", `${path}.seat`, "a hand in a bag belongs to nobody");
    }
    if (t.deck) {
      const d = t.deck;
      // (a deck's cards may have different backs, as two decks shuffled together do: which back, is what anyone sees)
      d.cards.forEach((k, i) => {
        if (!pieces[k]) err("unknown-piece", `${path}.deck.cards[${i}]`, `no piece "${k}"`);
        else if (!isCard(k)) err("deck-card", `${path}.deck.cards[${i}]`, `"${k}" has no back: only cards go in a deck`);
      });
      let dealt = 0;
      (d.deal ?? []).forEach((x, i) => {
        const dp = `${path}.deck.deal[${i}]`;
        const target = byId.get(x.to);
        if (!target) return void err("unknown-thing", `${dp}.to`, `no thing "${x.to}"`);
        const slots = pieces[target.thing.piece]?.snapPoints?.length ?? 0;
        const asked = (d.deal ?? []).filter((y) => y.to === x.to).reduce((n, y) => n + y.count, 0);
        if (target.thing.deck || target.inBag) err("deal-target", `${dp}.to`, `"${x.to}" isn't a piece on the table`);
        else if (asked > slots) err("deal-target", `${dp}.count`, `"${x.to}" has ${slots} snap points, and ${asked} cards are dealt onto it`);
        dealt += x.count;
      });
      if (dealt > d.cards.length) err("deal-count", `${path}.deck.deal`, `deals ${dealt} of ${d.cards.length} cards`);
      if (d.spread && d.deal?.length) err("deal-spread", `${path}.deck`, "a spread deck lies jumbled where it is: it deals nothing");
    }
  }
  // seat cameras and the game's are well posed: a camera doesn't look at itself
  const posed = (c) => c && Math.hypot(...c.position.map((v, i) => v - c.target[i])) > 1e-6;
  if (g.camera && !posed(g.camera)) err("camera", "$.camera", "position and target must differ");
  for (const [k, s] of Object.entries(seats)) if (s.camera && !posed(s.camera)) err("camera", `$.seats.${k}.camera`, "position and target must differ");
  if (g.recipe) (laid(g.recipe) ? startErrors : recipeErrors)(g, err);
  return errors;
}

// ───────────────────────────────── the recipe (GAME-FORMAT.md §6)

/** The codes that leave a recipe unable to lay anything out: with one of them, no table of it is checked. */
const RECIPE_CODES = new Set(["option", "condition", "options-many", "seat-area"]);
/** How many ways a game's options may be set: each is laid out and checked. */
export const MAX_COMBINATIONS = 512;
/** How much laying out every one of them may cost in all (recipe.js layoutCost, times how many): a validation stays in seconds. */
export const MAX_LAYOUT_COST = 20_000_000;

/** Is a recipe laid out already (applyRecipe's): nothing to choose, its start steps unconditional? */
const laid = (r) => !r.options?.length && !r.layout?.length && !r.spots && (r.start ?? []).every((s) => s.when == null && s.unless == null);

/** A connector's tags take a thing's (none: anything), as a scene connector does. */
const takes = (slotTags, tags) => !slotTags?.length || (Array.isArray(tags) && tags.some((t) => slotTags.includes(t)));

/** The recipe's own rules: its options, conditions, and what its steps name. */
function recipeErrors(g, err) {
  const r = g.recipe;
  const options = r.options ?? [];
  // option: keys its own, a range that has values, values their own, a default that's one of them
  const keys = new Set();
  options.forEach((o, i) => {
    const p = `$.recipe.options[${i}]`;
    if (keys.has(o.key)) err("option", `${p}.key`, `"${o.key}" names another option too`);
    keys.add(o.key);
    if (o.kind === "integer" && o.min > o.max) err("option", p, "min is above max: it has no values");
    if (o.kind === "enum") {
      const seen = new Set();
      o.options.forEach((x, j) => {
        if (seen.has(String(x.value))) err("option", `${p}.options[${j}].value`, `"${x.value}" is another of its values too`);
        seen.add(String(x.value));
      });
    }
    if (coerce(o, o.default) === undefined) err("option", `${p}.default`, `${JSON.stringify(o.default)} is no value of it`);
  });
  const n = combinationCount(g);
  if (n > MAX_COMBINATIONS) err("options-many", "$.recipe.options", `its options can be set ${n} ways: at most ${MAX_COMBINATIONS}, each laid out and checked`);
  else if (n * layoutCost(g) > MAX_LAYOUT_COST) err("options-many", "$.recipe.options", `its options can be set ${n} ways, each laying out ${layoutCost(g)} things' worth: at most ${MAX_LAYOUT_COST} in all, each laid out and checked`);
  // condition: one comparison on an option, with one of its values
  for (const list of ["layout", "start"])
    (r[list] ?? []).forEach((s, i) => {
      for (const k of ["when", "unless"]) {
        if (s[k] == null) continue;
        const why = conditionProblem(s[k], options);
        if (why) err("condition", `$.recipe.${list}[${i}].${k}`, why);
      }
    });
  // what a layout step names is in the game: a thing, a tag, a seat, a spot; a seat that moves or gets a kit has an area
  const all = everyThing(g.setup);
  const ids = new Set(all.map((a) => a.thing.id).filter((x) => x != null));
  const tags = new Set(all.flatMap((a) => a.thing.tags ?? []));
  const seats = g.seats ?? {};
  const spot = (at, path) => typeof at === "string" && !r.spots?.[at] && err("unknown-spot", path, `no spot "${at}"`);
  let kits = false;
  (r.layout ?? []).forEach((s, i) => {
    const p = `$.recipe.layout[${i}]`;
    const x = s.remove;
    if (x?.id != null && !ids.has(x.id)) err("unknown-thing", `${p}.remove.id`, `no thing "${x.id}"`);
    if (x?.tag != null && !tags.has(x.tag)) err("unknown-tag", `${p}.remove.tag`, `no thing is tagged "${x.tag}"`);
    if (x?.seat != null && !seats[x.seat]) err("unknown-seat", `${p}.remove.seat`, `no seat "${x.seat}"`);
    for (const [id, at] of Object.entries(s.place ?? {})) {
      if (!ids.has(id)) err("unknown-thing", `${p}.place.${id}`, `no thing "${id}"`);
      spot(at, `${p}.place.${id}`);
    }
    for (const [sid, at] of Object.entries(s.seats ?? {})) {
      if (!seats[sid]) err("unknown-seat", `${p}.seats.${sid}`, `no seat "${sid}"`);
      else if (!seats[sid].at) err("seat-area", `$.seats.${sid}`, "a seat that moves has an area (`at`) to move from");
      spot(at, `${p}.seats.${sid}`);
    }
    if (s.kit) {
      kits = true;
      s.kit.forEach((t, j) => t.seat != null && err("seat-zone", `${p}.kit[${j}].seat`, "a kit's hand is each seat's own: it names no seat"));
    }
  });
  if (kits) for (const [sid, seat] of Object.entries(seats)) if (!seat.at) err("seat-area", `$.seats.${sid}`, "a game with a kit gives every seat an area (`at`) to lay it at");
}

/**
 * The start steps of a game laid out (its recipe's `start`, nothing left to
 * choose): a deck is named by a thing on the table, the game's own or each
 * seat's from its kit (`<id>.<seat>`); a deal fits every seat's hands (their
 * card slots that take the deck's cards), a draw its target's snap points;
 * nothing takes more cards from a deck than it has.
 */
function startErrors(g, err) {
  const pieces = g.pieces;
  const seats = Object.keys(g.seats ?? {});
  const top = new Map(g.setup.filter((t) => t.id != null).map((t) => [t.id, t]));
  const taken = new Map(); // a deck's id → cards taken from it
  for (const t of top.values()) if (t.deck) taken.set(t.id, (t.deck.deal ?? []).reduce((n, x) => n + x.count, 0));
  const tagsOf = (deck) => pieces[pieces[deck.cards[0]]?.back]?.tags ?? [];
  /** The decks a step's `from` names, one per seat it serves ([null] for the game's own), or null when one isn't a deck on the table. */
  const decksOf = (from, path) => {
    if (top.get(from)?.deck) return [[null, top.get(from)]];
    const own = seats.map((sid) => [sid, top.get(`${from}.${sid}`)]);
    if (own.length && own.every(([, t]) => t?.deck)) return own;
    err("start-deck", path, `"${from}" is no deck on the table, nor each seat's`);
    return null;
  };
  const take = (deck, n, path) => {
    const now = (taken.get(deck.id) ?? 0) + n;
    taken.set(deck.id, now);
    if (now > deck.deck.cards.length) err("deal-count", path, `takes ${now} of the ${deck.deck.cards.length} cards of "${deck.id}"`);
  };
  const rooms = new Map(); // a seat and a deck's tags → its hands' card slots that take them
  const roomFor = (sid, tags) => {
    const k = JSON.stringify([sid, tags]);
    if (!rooms.has(k)) rooms.set(k, g.setup.filter((t) => t.seat === sid && pieces[t.piece]?.zone).reduce((n, t) => n + (pieces[t.piece].snapPoints ?? []).filter((sp) => sp.tags?.length && takes(sp.tags, tags)).length, 0));
    return rooms.get(k);
  };
  const dealt = new Map(); // a seat → cards dealt into its hands
  const onto = new Map(); // a thing → cards drawn onto it
  (g.recipe.start ?? []).forEach((s, i) => {
    const p = `$.recipe.start[${i}]`;
    if (s.shuffle != null) decksOf(s.shuffle, `${p}.shuffle`);
    if (s.deal != null) {
      const decks = decksOf(s.deal, `${p}.deal`);
      if (!decks) return;
      const bySeat = new Map(decks);
      for (const sid of seats) {
        const deck = decks.length === 1 && decks[0][0] == null ? decks[0][1] : bySeat.get(sid);
        take(deck, s.count, `${p}.count`);
        const room = roomFor(sid, tagsOf(deck.deck));
        const now = (dealt.get(sid) ?? 0) + s.count;
        dealt.set(sid, now);
        if (now > room) err("deal-hand", `${p}.count`, `seat "${sid}" has room for ${room} cards in its hands, and ${now} are dealt there`);
      }
    }
    if (s.draw != null) {
      const decks = decksOf(s.draw, `${p}.draw`);
      if (!decks) return;
      const target = top.get(s.to);
      if (!target) return void err("unknown-thing", `${p}.to`, `no thing "${s.to}" on the table`);
      for (const [, deck] of decks) {
        take(deck, s.count, `${p}.count`);
        const room = target.deck ? 0 : (pieces[target.piece]?.snapPoints ?? []).filter((sp) => takes(sp.tags, tagsOf(deck.deck))).length;
        const now = (onto.get(s.to) ?? 0) + s.count;
        onto.set(s.to, now);
        if (now > room) err("deal-target", `${p}.to`, `"${s.to}" has room for ${room} cards, and ${now} are drawn onto it`);
      }
    }
  });
}

/**
 * Each way the game's options can be set, laid out (applyRecipe) and held to
 * every rule. An error the game itself has is said once, as the game's; any
 * other names the values that lay it out so.
 */
function laidErrors(g, own) {
  const errors = [];
  const seen = new Set(own.map((e) => `${e.code} ${e.path} ${e.message}`));
  for (const values of combinations(g)) {
    const words = Object.entries(values).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ");
    for (const e of validateSemantics(applyRecipe(g, values))) {
      const key = `${e.code} ${e.path} ${e.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({ ...e, message: `${e.message} (laid out with ${words || "its defaults"})` });
    }
  }
  return errors;
}

/** Both stages. */
export function validate(g) {
  const s = validateStructure(g);
  if (s.length) return { ok: false, stage: "structural", errors: s };
  const own = validateSemantics(g);
  const m = g.recipe && !laid(g.recipe) && !own.some((e) => RECIPE_CODES.has(e.code)) ? [...own, ...laidErrors(g, own)] : own;
  if (m.length) return { ok: false, stage: "semantic", errors: m };
  return { ok: true, stage: null, errors: [] };
}

/** One line per error, for messages. */
export const errorText = (r) => r.errors.map((e) => `${e.code} at ${e.path}: ${e.message}`).join("; ");
