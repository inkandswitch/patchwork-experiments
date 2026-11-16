// Places in the Ucluelet grid that are land or water beyond doubt (away
// from any shore; each checked against OSM's coastline on 2026-11-15), to
// check the classification and the heightfield against. Lat, lon WGS84.
export const KNOWN_UCLUELET = [
  { name: "Ucluelet village", lat: 48.9427, lon: -125.5464, land: true },
  { name: "Mount Ozzard", lat: 48.9654, lon: -125.4891, land: true },
  { name: "Benson Island, middle", lat: 48.8832, lon: -125.3819, land: true },
  { name: "The hangar (1970 Harbour Crescent)", lat: 48.9491, lon: -125.55776, land: true },
  { name: "Harbour, off the aerodrome", lat: 48.9505, lon: -125.558, land: false },
  { name: "Loudoun Channel", lat: 48.9397, lon: -125.3721, land: false },
  { name: "Newcombe Channel", lat: 48.9184, lon: -125.4946, land: false },
  { name: "Open sea south of Amphitrite", lat: 48.86, lon: -125.5, land: false },
];
