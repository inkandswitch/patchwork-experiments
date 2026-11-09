// OpenStreetMap (Overpass JSON, `out geom`) to the terrain's features, in
// the local frame (metres, x east, z south, rounded to the centimetre):
//
//   { version: 1, osmBase,
//     coast:      [{ id, a, b, points }],   a natural=coastline way: its first and last node ids (how ways join) and its points; land is on its left
//     structures: [{ id, kind, name, floating, area, width, points }],  piers (floats when floating=yes), breakwaters, groynes
//     marks:      [{ id, type, name, x, z, colours, light, height, category, shape }] }   seamarks, lighthouses, beacons
//
// Sorted by id, so the same OSM data always makes the same bytes.

const cm = (v) => Math.round(v * 100) / 100;

const idOf = (el) => `${el.type}/${el.id}`;
const byId = (p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);

function pointsOf(el, frame) {
  return (el.geometry ?? []).filter(Boolean).map(({ lat, lon }) => frame.toLocal(lat, lon).map(cm));
}

/** Where a mark is: a node's point, a way's centroid (of its distinct points), a relation's bounds' middle. */
function placeOf(el, frame) {
  if (el.type === "node") return frame.toLocal(el.lat, el.lon);
  if (el.center) return frame.toLocal(el.center.lat, el.center.lon);
  const g = (el.geometry ?? []).filter(Boolean);
  if (g.length) {
    const pts = g.length > 1 && g[0].lat === g.at(-1).lat && g[0].lon === g.at(-1).lon ? g.slice(0, -1) : g;
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
    return frame.toLocal(lat, lon);
  }
  if (el.bounds) return frame.toLocal((el.bounds.minlat + el.bounds.maxlat) / 2, (el.bounds.minlon + el.bounds.maxlon) / 2);
  return null;
}

const num = (v) => {
  const x = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(x) ? x : null;
};
const list = (v) => (v ? String(v).split(";").map((s) => s.trim()).filter(Boolean) : []);

/** The tags a mark is drawn from, gathered whatever seamark sub-key they're under. */
function markOf(el, frame) {
  const t = el.tags ?? {};
  const type = t["seamark:type"] ?? (t.man_made === "lighthouse" ? "lighthouse" : t.man_made === "beacon" ? "beacon" : null);
  if (!type) return null;
  const at = placeOf(el, frame);
  if (!at) return null;
  const sub = (key) => t[`seamark:${type}:${key}`];
  const light = t["seamark:light:colour"] ?? t["seamark:light:1:colour"] ?? null;
  const height = num(t.height) ?? num(t["seamark:light:height"]) ?? num(t["seamark:light:1:height"]);
  return {
    id: idOf(el),
    type: t.man_made === "lighthouse" ? "lighthouse" : type,
    name: t.name ?? t["seamark:name"] ?? null,
    x: cm(at[0]),
    z: cm(at[1]),
    colours: list(sub("colour") ?? t["seamark:landmark:colour"] ?? t["seamark:daymark:colour"]),
    light: light ? list(light)[0] : null,
    height,
    category: sub("category") ?? (t.man_made === "mast" || t["tower:type"] ? "mast" : null),
    shape: sub("shape") ?? null,
  };
}

/**
 * @param {{ elements: object[], osm3s?: { timestamp_osm_base?: string } }} json  Overpass `out geom` JSON
 * @param {{ toLocal(lat, lon): [number, number] }} frame
 * @param {{ osmBase?: string }} [o]  what OSM is as of, when the query was pinned to a date (else Overpass's timestamp)
 */
export function featuresFromOsm(json, frame, { osmBase } = {}) {
  const coast = [], structures = [], marks = [];
  for (const el of json?.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === "way" && t.natural === "coastline" && el.nodes?.length >= 2) {
      coast.push({ id: idOf(el), a: el.nodes[0], b: el.nodes.at(-1), points: pointsOf(el, frame) });
    }
    if (el.type === "way" && /^(pier|breakwater|groyne)$/.test(t.man_made ?? "") && el.nodes?.length >= 2) {
      const closed = el.nodes.length >= 4 && el.nodes[0] === el.nodes.at(-1);
      structures.push({
        id: idOf(el),
        kind: t.man_made,
        name: t.name ?? null,
        floating: t.floating === "yes",
        area: closed && t.area !== "no",
        width: num(t.width),
        points: pointsOf(el, frame),
      });
    }
    const m = markOf(el, frame);
    if (m) marks.push(m);
  }
  return { version: 1, osmBase: osmBase ?? json?.osm3s?.timestamp_osm_base ?? null, coast: coast.sort(byId), structures: structures.sort(byId), marks: marks.sort(byId) };
}
