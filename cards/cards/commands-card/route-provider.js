// The routing backend both the map search and the route card use. Flip to
// "valhalla" for native walk / bike / transit routing; "osrm" uses the public
// demo server (router.project-osrm.org), which only has the driving profile,
// so every non-driving mode falls back to a car route. It stays a single
// source of truth to edit — consumers import it from this package.

/** @typedef {"osrm" | "valhalla"} RouteProviderName */

/** @type {RouteProviderName} */
export const ROUTE_PROVIDER = "osrm";
