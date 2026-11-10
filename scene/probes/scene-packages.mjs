// Where packages come from, for the publish scripts: a published scene names
// the scene package as its `@patchwork.suggestedImportUrl` and lists the
// packages its contents come from in `packages` (scene/STAGE.md, "Packages").
// In the browser the stage works both out from the plugin registry; node has
// no registry, so a publisher states its packages by folder and their URLs
// are read here at publish time: each one's `pushwork url`, which is the
// `rootUrl` in its .pushwork/config.json. Each package's probes/ carries its
// own copy of this file (packages don't import each other); keep the copies
// the same. Plain node, no dependencies.
//
//   const table = { "@patchwork": scenePatchwork(), …, packages: scenePackages(["scene", "tabletop"]) };
//   problems.push(...packageProblems(doc, ["scene", "tabletop"]));
//   const stamped = withPackages(snapshotOfASceneMadeInAProbePage, ["scene", "tabletop"]);
//
// A folder is named relative to the repo root ("sailing", "../camber/patchwork").
// PACKAGE_URL_<NAME> (the folder's last name, upper-cased: PACKAGE_URL_SCENE)
// overrides the folder's own, for a package that isn't checked out here.
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BARE = /^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}$/;

/** A package folder's synced URL: what `pushwork url` prints there. Throws when it has none. */
export function pushworkUrl(pkg) {
  const dir = resolve(repoRoot, pkg);
  const env = process.env[`PACKAGE_URL_${basename(dir).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
  let url = env;
  if (!url) {
    const config = resolve(dir, ".pushwork/config.json");
    if (!existsSync(config)) throw new Error(`${pkg} has no .pushwork/config.json: sync it with pushwork first (its URL goes on the scene)`);
    url = JSON.parse(readFileSync(config, "utf8")).rootUrl;
  }
  if (typeof url !== "string" || !BARE.test(url)) throw new Error(`${pkg}'s pushwork url is ${JSON.stringify(url)}, not a bare automerge URL`);
  return url;
}

/** A published scene's `@patchwork`: a scene, and the scene package for a viewer who has nothing installed. */
export function scenePatchwork() {
  return { type: "scene", suggestedImportUrl: pushworkUrl("scene") };
}

/** A scene's `packages`: `{ url }` for each of these package folders, each once, in this order. */
export function scenePackages(pkgs) {
  const urls = [];
  for (const pkg of pkgs) {
    const url = pushworkUrl(pkg);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls.map((url) => ({ url }));
}

/**
 * A scene doc made where there was no registry to say (a probe page's
 * snapshot), as it's published: the same doc with the scene package as its
 * suggested import and these packages listed (after any it lists already).
 */
export function withPackages(doc, pkgs) {
  const have = (Array.isArray(doc.packages) ? doc.packages : []).filter((e) => e && typeof e.url === "string" && BARE.test(e.url));
  const more = scenePackages(pkgs).filter((e) => !have.some((h) => h.url === e.url));
  return { ...doc, "@patchwork": { ...doc["@patchwork"], ...scenePatchwork() }, packages: [...have.map((e) => ({ url: e.url })), ...more] };
}

/** What's wrong with a scene doc's suggested import and packages, as sentences; none when it names the scene package and lists each of these. */
export function packageProblems(doc, pkgs) {
  const problems = [];
  const scene = pushworkUrl("scene");
  if (doc?.["@patchwork"]?.type !== "scene") problems.push(`@patchwork.type is ${JSON.stringify(doc?.["@patchwork"]?.type)}, not "scene"`);
  if (doc?.["@patchwork"]?.suggestedImportUrl !== scene) problems.push(`@patchwork.suggestedImportUrl is ${JSON.stringify(doc?.["@patchwork"]?.suggestedImportUrl)}, not the scene package (${scene})`);
  if (!Array.isArray(doc?.packages)) return [...problems, "no packages list (every scene is made with one)"];
  for (const e of doc.packages) if (!e || typeof e.url !== "string" || !BARE.test(e.url)) problems.push(`packages has an entry that isn't { url: a bare automerge URL }: ${JSON.stringify(e)}`);
  const listed = doc.packages.map((e) => e?.url);
  for (const pkg of pkgs) if (!listed.includes(pushworkUrl(pkg))) problems.push(`packages doesn't list ${pkg} (${pushworkUrl(pkg)})`);
  return problems;
}
