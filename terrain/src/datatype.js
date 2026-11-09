// The Terrain doc: a piece of the real world, as a scene's ground.
//
// {
//   "@patchwork": { type: "terrain" },
//   title,
//   origin: { lat, lon },           // the local frame's origin (tmerc.js): x east, y up, z south, metres
//   grid: { n, cell, x0, z0 },      // the extent: n × n nodes (2^k + 1), `cell` metres apart, node (i, j) at (x0 + i·cell, z0 + j·cell)
//   exaggeration: 1,                // vertical exaggeration of the land in the mesh (the heightfield stays true)
//   datum: { zero: "MWL", station, mwlAboveChartDatum, mwlAboveCGVD2013, tide: { HHWLT, MHHW, MLLW, LLWLT } },
//   demToMWL,                       // added to the DEM's heights (NAVD88) to make them heights above mean water
//   places: [{ name, kind, lat, lon }],
//   wind: { speed, from, scale, source },   // a typical breeze here, for a scene's sea
//   osmDate: null | "2026-11-09T20:32:33Z", // OpenStreetMap as of this moment (Overpass [date:…]), so a fetch is reproducible; null: now
//   data: null | {                  // what Fetch data cached (store.js): two immutable file docs
//     dem: { url, encoding: "int16le", scale, offset, datum, n, cell, x0, z0, origin, sha256 },
//     features: { url, encoding: "json", origin, sha256 },
//     fetched, summary },
//   sources: [{ id, name, url, fetched, licence, attribution, sha256?, query?, requests?, accuracy?, derivation? }],
//   attribution,                    // the full credit (the GLB's asset.copyright, extras.terrain.attribution)
//   credit,                         // the short credit a scene shows at the foot of the view (credit.js)
// }

import { cadboroDoc } from "./cadboro.js";

export const TerrainDatatype = {
  init(doc) {
    // a new terrain starts as Cadboro Bay; change the origin and the grid in the tool, then fetch
    const preset = cadboroDoc();
    doc.title = "Terrain";
    for (const [k, v] of Object.entries(preset)) if (k !== "title") doc[k] = v;
    doc.data = null;
    doc.sources = [];
    doc.attribution = "";
  },
  getTitle(doc) {
    return doc?.title || "Terrain";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc.title || "Terrain"}`;
  },
};

export default TerrainDatatype;
