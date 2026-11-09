// Places in the Cadboro Bay grid that are land or water beyond doubt (well
// away from any shore: a map and the DEM agree), to check the coastline's
// classification against. Lat, lon in degrees (WGS84).
export const KNOWN = [
  { name: "RVYC mooring field", lat: 48.454, lon: -123.2915, land: false },
  { name: "Cadboro Bay, north of the moorings", lat: 48.45616, lon: -123.29042, land: false },
  { name: "Baynes Channel", lat: 48.4462, lon: -123.2618, land: false },
  { name: "Haro Strait", lat: 48.4400, lon: -123.2100, land: false },
  { name: "Mayor Channel", lat: 48.4330, lon: -123.2700, land: false },
  { name: "Oak Bay, off the marina", lat: 48.4290, lon: -123.2900, land: false },
  { name: "Plumper Passage", lat: 48.4300, lon: -123.2520, land: false },
  { name: "University of Victoria", lat: 48.4634, lon: -123.3100, land: true },
  { name: "Cadboro Bay village", lat: 48.4590, lon: -123.2980, land: true },
  { name: "Ten Mile Point, inland", lat: 48.4590, lon: -123.2720, land: true },
  { name: "Uplands, Beach Drive", lat: 48.4400, lon: -123.3020, land: true },
  { name: "Discovery Island, middle", lat: 48.42593, lon: -123.23745, land: true },
  { name: "Chatham Islands, the largest", lat: 48.43744, lon: -123.24555, land: true },
];
