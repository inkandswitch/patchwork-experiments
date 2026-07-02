// The routing backend both the map search and the route card use. Flip to
// "valhalla" for native walk / bike / transit routing; "osrm" uses the public
// demo server (router.project-osrm.org), which only has the driving profile, so
// every non-driving mode falls back to a car route. Core is bundled into each
// feature package, so changing this requires rebuilding the map and route
// packages — but it stays a single source of truth to edit.
export type RouteProviderName = "osrm" | "valhalla";

export const ROUTE_PROVIDER: RouteProviderName = "osrm";
