// Settings
// What the builder remembers, and where.
//
// A component has no document of its own — it is handed an element and finds everything else
// from the host. Its state lives in the account-scoped storage document the host creates on
// request (`patchwork:tool-storage`, see providers.js), keyed by the repo's URL, so each repo
// remembers the site built from it.
//
// The repo itself is deliberately not where this goes. pushwork syncs in both directions: a
// field written into a synced folder document is a change someone's working copy has to account
// for. The build is Patchwork's business, not the repo's.

/** What we know about the site built from `sourceUrl`, if anything. */
export const buildFor = (storageDoc, sourceUrl) => (sourceUrl ? storageDoc?.builds?.[sourceUrl] : undefined);

/** Record something about a repo's build. Merges, so a caller can set one field. */
export function recordBuild(handle, sourceUrl, patch) {
  handle.change((d) => {
    if (!d.builds) d.builds = {};
    const entry = d.builds[sourceUrl] ?? (d.builds[sourceUrl] = {});
    for (const [key, value] of Object.entries(patch)) {
      // Automerge has no undefined; leaving a key out is how you say "no value".
      if (value === undefined) delete entry[key];
      else entry[key] = value;
    }
  });
}
