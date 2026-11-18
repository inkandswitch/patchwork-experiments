// tabletop-game v2: validation, in two stages, as naval's rig contract does.
//
//   structural: schema.json, read by a small interpreter of the JSON Schema
//               keywords the schema uses (type, const, enum, required,
//               properties, additionalProperties, propertyNames, items,
//               minItems, maxItems, minLength, pattern, minimum, maximum,
//               exclusiveMinimum, anyOf, $ref to #/$defs). A number must be
//               finite.
//   semantic:   the cross-field rules of GAME-FORMAT.md §9, each with the
//               error code the fixtures' manifest names, for the game and
//               for each of its variants (applyVariant).
//
// validate(game) → { ok, stage: null | "structural" | "semantic", errors: [{ code, path, message }] }
// Semantic rules run only once the structure is sound. No imports but the
// schema, so a consumer can copy this folder whole (packages never import
// each other: tts-import and dice keep copies for their tests).

import schema from "./schema.json" with { type: "json" };

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
        const target = all.find((a) => a.thing.id === x.to);
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
  return errors;
}

// ───────────────────────────────── variants (GAME-FORMAT.md §3)

/** The fields a variant may give in place of the game's own. */
export const VARIANT_FIELDS = Object.freeze(["players", "setup", "seats", "camera"]);

/**
 * The game as one of its variants sets it up: that variant's fields in place
 * of the game's own, and no `variants`. `which` is a variant's index or name;
 * null (or a game without variants) is the game as it is, without `variants`.
 * An unknown variant is null. Pure: the game isn't changed.
 */
export function applyVariant(g, which = null) {
  const { variants, ...base } = g ?? {};
  if (which == null || !Array.isArray(variants)) return base;
  const v = typeof which === "number" ? variants[which] : variants.find((x) => x?.name === which);
  if (!v) return null;
  const out = { ...base };
  for (const k of VARIANT_FIELDS) if (v[k] !== undefined) out[k] = v[k];
  return out;
}

/**
 * The semantic rules for each variant: its name unique (`variant-name`), and
 * the game as it sets it up passing every rule above. An error the game
 * itself has is said once, as the game's; one in a field the variant gives
 * is at the variant's path; any other is the game's path, naming the variant.
 */
function variantErrors(g, own) {
  const errors = [];
  const seen = new Set(own.map((e) => `${e.code} ${e.path} ${e.message}`));
  const names = new Set();
  g.variants.forEach((v, i) => {
    const at = `$.variants[${i}]`;
    if (names.has(v.name)) errors.push({ code: "variant-name", path: `${at}.name`, message: `"${v.name}" names another variant too` });
    names.add(v.name);
    for (const e of validateSemantics(applyVariant(g, i))) {
      if (seen.has(`${e.code} ${e.path} ${e.message}`)) continue;
      const field = VARIANT_FIELDS.find((k) => v[k] !== undefined && (e.path === `$.${k}` || e.path.startsWith(`$.${k}.`) || e.path.startsWith(`$.${k}[`)));
      errors.push(field ? { ...e, path: `${at}${e.path.slice(1)}` } : { ...e, message: `${e.message} (as variant "${v.name}" sets it up)` });
    }
  });
  return errors;
}

/** Both stages. */
export function validate(g) {
  const s = validateStructure(g);
  if (s.length) return { ok: false, stage: "structural", errors: s };
  const own = validateSemantics(g);
  const m = Array.isArray(g.variants) ? [...own, ...variantErrors(g, own)] : own;
  if (m.length) return { ok: false, stage: "semantic", errors: m };
  return { ok: true, stage: null, errors: [] };
}

/** One line per error, for messages. */
export const errorText = (r) => r.errors.map((e) => `${e.code} at ${e.path}: ${e.message}`).join("; ");
