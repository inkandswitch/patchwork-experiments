// Builder
// Turning a repo into a site, once.
//
// This is the mechanism: read the repo, run its own build system over it, write the result back
// under public/. When to do that — on a button, on a change, on adopting a site — is policy, and
// belongs to whichever tool is asking. Both tools in this package ask the same way.

import { bundleVersion, documentAt, outputEntries, pathsByDocument, readRepo, sourcesFrom } from "./build.js";
import { writeSiteInto } from "./site-doc.js";

/**
 * The site's own build system, loaded out of the repo being built. Each CakeWalk site carries its
 * own — they are forks of a starter, not users of a library — so the contract is a function, not
 * a version: a repo exporting `buildSite` from this path can be built, whatever it does inside.
 */
export const BUNDLE = "dist/site-build.js";

/** Build the repo at `siteUrl` and write the result into it. */
export async function buildInto(repo, siteUrl) {
  const readAt = performance.now();
  const { files, shape, title } = await readRepo(repo, siteUrl);
  const readMs = performance.now() - readAt;

  // The bundle is content inside the document being built, so the import is keyed by that
  // content's version. See bundleVersion.
  const bundleDoc = await documentAt(repo, siteUrl, BUNDLE);
  const at = bundleDoc ? await bundleVersion(repo, bundleDoc) : "missing";

  let buildSite;
  try {
    ({ buildSite } = await import(`/${encodeURIComponent(siteUrl)}/${BUNDLE}?at=${encodeURIComponent(at)}`));
  } catch (err) {
    throw new Error(
      `That repo has no ${BUNDLE} in it, so there is no build system to run. ` +
        `Run \`pnpm build:browser\` in the repo and sync it. (${err})`
    );
  }

  const { files: built, pages, log, ms } = buildSite({
    sources: sourcesFrom(files),
    env: {
      // Every URL relative to the file it sits in. The document this writes to is addressed by a
      // URL with its own heads pinned on, so the mount point changes on every build.
      relativeUrls: true,
      // pushwork's file documents carry no modification time, so the sitemap's lastmod would be
      // the epoch for every page. Better to say nothing than a wrong date.
      useRealBuildDates: false,
    },
  });

  const entries = outputEntries(built, (sourcePath) => files.get(sourcePath)?.url);

  const writeAt = performance.now();
  const counts = await writeSiteInto(repo, siteUrl, { entries, shape });
  const writeMs = performance.now() - writeAt;

  return {
    title,
    /** Every source file: path → {content, url}. */
    files,
    /** Which source path each document is. */
    sourceOfDocument: pathsByDocument(files),
    /** Which page each source became: "content/alifib/index.md" → "alifib/index.html". */
    pages: new Map(Object.entries(pages ?? {})),
    counts,
    log,
    readMs,
    buildMs: ms,
    writeMs,
    builtCount: Object.keys(built).length,
    pageCount: [...files.keys()].filter((p) => /^content\/.*\.(md|html)$/.test(p)).length,
  };
}

/** What a build did, as one line. */
export const summarise = ({ counts }) => {
  const relinked = counts.relinked ?? 0;
  if (!(counts.created + counts.replaced + counts.removed + relinked)) return `nothing changed, wrote nothing`;
  return (
    `wrote ${counts.created} new, ${counts.replaced} replaced, ${counts.removed} removed` +
    (relinked ? `, ${relinked} ${relinked === 1 ? "directory" : "directories"} relinked` : "") +
    ` (${counts.unchanged} untouched, ${counts.referenced} shared with the source,` +
    ` ${counts.deleted} old documents deleted)`
  );
};
