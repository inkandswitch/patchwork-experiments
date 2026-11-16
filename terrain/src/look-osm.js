// What a place looks like, from OpenStreetMap: building footprints and the
// ground's cover (forest, lawns, yards, bog, beach, rock, lakes), in the
// terrain's local frame. A second Overpass query beside the shore's
// (fetch-data.js overpassQuery), pinned to the same moment, kept in its own
// file doc (store.js), read by the build (cover.js, buildings.js, forest.js).
//
//   { version: 1, osmBase,
//     buildings: [{ id, kind, name, levels, height, roof, roofColour, colour, use, points }],
//     areas:     [{ id, cover, tag, rings: [[[x, z], …], …], holes: [[[x, z], …], …] }] }
//
// Sorted by id; points rounded to the centimetre, so the same OSM makes the
// same bytes. Rings don't repeat their first point.

const cm = (v) => Math.round(v * 100) / 100;
const idOf = (el) => `${el.type}/${el.id}`;
const byId = (p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
const num = (v) => {
  const x = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(x) ? x : null;
};

/**
 * The look query: buildings, land use and natural cover, and what else a
 * place's look may want (piers, seamarks, trails, slipways…), in the box,
 * as OSM was at `date`. (Its exact text is what was checked: a recording
 * replays by it.)
 */
export function lookQuery(box, { date = null } = {}) {
  const b = `${box.south.toFixed(6)},${box.west.toFixed(6)},${box.north.toFixed(6)},${box.east.toFixed(6)}`;
  if (date != null && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(date)) throw new Error(`OpenStreetMap's date must be like 2026-11-09T20:32:33Z, not ${date}.`);
  return `[out:json][timeout:180]${date ? `[date:"${date}"]` : ""};
(
  way["building"](${b});
  relation["building"](${b});
  nwr["landuse"](${b});
  nwr["natural"~"^(wood|scrub|heath|grassland|wetland|beach|sand|shingle|bare_rock|rock|stone|cliff|tree_row|tree|water|reef|shoal|cape|peak|bay)$"](${b});
  nwr["leisure"~"^(park|nature_reserve|marina|slipway)$"](${b});
  nwr["boundary"~"^(national_park|protected_area)$"](${b});
  way["highway"](${b});
  way["waterway"](${b});
  nwr["amenity"~"^(ferry_terminal|fuel|boat_rental)$"](${b});
  nwr["industrial"](${b});
  nwr["man_made"~"^(pier|breakwater|groyne|quay|lighthouse|beacon|mast|tower|crane|silo|storage_tank|slipway|water_tower)$"](${b});
  nwr["seamark:type"](${b});
  nwr["aeroway"](${b});
  nwr["tourism"](${b});
  nwr["route"="hiking"](${b});
  way["route"="hiking"](${b});
  nwr["name"~"Wild Pacific Trail"](${b});
);
out geom;
`;
}

/**
 * What a tag says the ground is: one of COVERS' keys, or null. Land use
 * first, then natural, then leisure (a park of woods is woods).
 */
export function coverOf(t) {
  const n = t.natural, l = t.landuse, s = t.leisure;
  if (n === "wood" || l === "forest") return "wood";
  if (n === "wetland") return "wetland";
  if (n === "beach" || n === "sand" || n === "shingle") return "beach";
  if (n === "bare_rock" || n === "rock" || n === "stone" || n === "scree") return "rock";
  if (n === "water" || l === "reservoir" || l === "basin") return "lake";
  if (n === "scrub" || n === "heath") return "scrub";
  if (/^(industrial|commercial|retail|construction|brownfield|quarry|railway|port|military|garages)$/.test(l ?? "")) return "yard";
  if (l === "residential") return "residential";
  if (/^(grass|meadow|recreation_ground|cemetery|village_green|farmland|allotments)$/.test(l ?? "") || n === "grassland" || /^(park|pitch|golf_course|garden)$/.test(s ?? "")) return "grass";
  return null;
}

/** Ways (lists of points) joined end to end into closed rings; what can't close is dropped. */
export function joinRings(lines) {
  const key = (p) => `${p[0]},${p[1]}`;
  const left = lines.filter((l) => l.length >= 2).map((l) => l.slice());
  const rings = [];
  while (left.length) {
    let ring = left.shift();
    let grew = true;
    while (key(ring[0]) !== key(ring.at(-1)) && grew) {
      grew = false;
      for (let k = 0; k < left.length; k++) {
        const l = left[k];
        const end = key(ring.at(-1));
        if (key(l[0]) === end) ring = ring.concat(l.slice(1));
        else if (key(l.at(-1)) === end) ring = ring.concat(l.slice(0, -1).reverse());
        else continue;
        left.splice(k, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring.at(-1))) rings.push(ring.slice(0, -1));
  }
  return rings;
}

const ptsOf = (geometry, frame) => (geometry ?? []).filter(Boolean).map(({ lat, lon }) => frame.toLocal(lat, lon).map(cm));
const closed = (el) => el.type === "way" && el.nodes?.length >= 4 && el.nodes[0] === el.nodes.at(-1);

/** An element's outer rings and holes, in local metres: a closed way's one ring, a multipolygon's joined members. */
function ringsOf(el, frame) {
  if (el.type === "way") return closed(el) ? { rings: [ptsOf(el.geometry, frame).slice(0, -1)], holes: [] } : null;
  if (el.type === "relation" && (el.tags?.type === "multipolygon" || el.tags?.type === "boundary" || el.tags?.building)) {
    const outer = [], inner = [];
    for (const m of el.members ?? []) if (m.type === "way" && m.geometry) (m.role === "inner" ? inner : outer).push(ptsOf(m.geometry, frame));
    const rings = joinRings(outer);
    return rings.length ? { rings, holes: joinRings(inner) } : null;
  }
  return null;
}

/**
 * @param {{ elements: object[], osm3s?: object }} json  Overpass `out geom`
 * @param {{ toLocal(lat, lon): [number, number] }} frame
 * @param {{ osmBase?: string }} [o]
 */
export function lookFromOsm(json, frame, { osmBase } = {}) {
  const buildings = [], areas = [];
  for (const el of json?.elements ?? []) {
    const t = el.tags ?? {};
    if (t.building && t.building !== "no") {
      const r = ringsOf(el, frame);
      if (!r) continue;
      for (const [k, points] of r.rings.entries()) {
        buildings.push({
          id: r.rings.length > 1 ? `${idOf(el)}#${k}` : idOf(el),
          kind: t.building,
          name: t.name ?? null,
          levels: num(t["building:levels"]),
          height: num(t.height),
          roof: t["roof:shape"] ?? null,
          roofColour: t["roof:colour"] ?? null,
          colour: t["building:colour"] ?? null,
          use: t.tourism ?? t.amenity ?? t.shop ?? t.industrial ?? null,
          points,
        });
      }
      continue;
    }
    const cover = coverOf(t);
    if (!cover) continue;
    const r = ringsOf(el, frame);
    if (!r) continue;
    areas.push({ id: idOf(el), cover, tag: t.landuse ? `landuse=${t.landuse}` : t.natural ? `natural=${t.natural}` : `leisure=${t.leisure}`, rings: r.rings, holes: r.holes });
  }
  return { version: 1, osmBase: osmBase ?? json?.osm3s?.timestamp_osm_base ?? null, buildings: buildings.sort(byId), areas: areas.sort(byId) };
}
