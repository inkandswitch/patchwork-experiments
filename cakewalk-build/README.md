# cakewalk-build

Build a [CakeWalk](https://github.com/inkandswitch/CakeWalk) site from its repo, in the browser,
into a document you can browse.

It's a **context tool**: open a pushworked CakeWalk repo in Patchwork and the builder is there
beside it, with [site-viewer](../site-viewer/) showing the result. There is no build document to
make and no URL to paste — the component asks the host what you're looking at.

```
pnpm install
pnpm test          # the parts with no browser in them
pnpm sync          # publish
```

## A component, not a tool bound to a document

This registers as a `patchwork:component`, whose render signature is `(element) => cleanup`:

```js
{ type: "patchwork:component", id: "cakewalk-build", tags: ["context-tool"], … }
```

No `supportedDatatypes`, no handle, no document bound to it at all. That matters here more than
it would for most tools: the thing this builds is *whatever you happen to be looking at*, and
binding it to a document would mean binding it to the wrong one.

Everything it needs comes from the host's providers. You dispatch a `patchwork:subscribe` event
from your `<patchwork-view>` carrying a `MessagePort`, name a selector, and the host posts
`{type:"change", value}` back whenever that value changes. Two selectors do it:

| selector | what it gives |
| --- | --- |
| `patchwork:selected-doc` | the repo to build, as the selection moves |
| `patchwork:tool-storage` | this tool's own account-scoped document, created by the host on first request |

That second one is why there is no settings bookkeeping here. The host owns the document's
creation, so nothing writes to the account and two tabs cannot race over making one. It arrives
a beat after the first render, which is why **Build stays disabled until it does**.

The repo itself is deliberately not where any of this goes. pushwork syncs in both directions: a
field written into a synced folder document is a change someone's working copy has to account
for. The build is Patchwork's business, not the repo's.

## The build system comes from the repo

The tool does not contain a build system. It imports one, out of the repo it is building:

```js
const { buildSite } = await import(`/${encodeURIComponent(sourceUrl)}/dist/site-build.js`)
```

CakeWalk is a starter, not a library — "make a copy of this project, discard the git history,
modify the included build system to suit your needs" — so every site's build system is a fork
that has moved on from every other. There is no shared version to depend on, and a tool that
vendored one would build the wrong site.

The contract is a function, not a version: a repo exporting `buildSite({ sources, env })` from
`dist/site-build.js` can be built here, whatever it does inside. Both `aria-sgai-notebook` and
the Ink & Switch `website` produce that file with `system/tools/build-browser.ts`.

Two settings are forced, for reasons belonging to the destination rather than the site:

- **`relativeUrls: true`.** The document's address has its own heads pinned onto it, so the
  site's mount point changes on every build. There is nothing stable for an absolute path to be
  absolute against.
- **`useRealBuildDates: false`.** pushwork's file documents carry no modification time, so the
  sitemap's `lastmod` would be the epoch for every page. Better to say nothing.

## Saying why, not just no

The tool is offered every document you look at, so most of its job is knowing when it has
nothing to say. `describeRepo()` distinguishes three noes, and the third is the one that earns
its keep:

| what you selected | what it says |
| --- | --- |
| anything else | Not a CakeWalk repo |
| a folder without pages | Not a CakeWalk repo — no content/ and template/ in it |
| a **vfs** repo | This repo was synced with the vfs shape — re-run pushwork with `--shape patchwork-folder` |

`pushwork init` defaults to `--shape vfs`, which puts the whole repo in one document keyed by
path instead of a document per file. Such a repo *has* content/ and template/ in it and still
cannot be read here, so "not a CakeWalk repo" would be true and useless. `collectSources()`
refuses the same case with the same explanation when you press Build, rather than reading
nothing and producing a sitemap and an empty feed — which is what it used to do.

## Assets are referenced, not copied

Most of a built site is bytes the build never looked at — images, video, fonts — which came in as
source documents and were hardlinked straight through. Those go into the output as *their source
document's URL* rather than as a second copy:

```js
d["alifib/img/01-interface-overview.png"] = "automerge:2zrTHnzQPUGfdMizPQgop9kt9kYE"
```

The resolver behind the service worker follows an Automerge URL wherever it expects a file, so it
serves identically, with the right content type. For the ARIA notebook that is 13 of 45 files;
for the Ink & Switch website it is **301 of 603**, whose assets are 150MB against 2.5MB of prose.

The match is by object identity rather than by comparing bytes — an in-memory build aliases a
hardlinked file instead of copying it, so the array that comes out is the one that went in.

## It writes only what moved

`changesFor()` diffs the built site against what the output document already holds. An identical
rebuild writes nothing, so the document's history does not gain a full copy of the site every
time someone saves a file.

## Testing it

`pnpm test` covers the parts with no browser in them: the build logic, both providers, and what
the tool remembers.

`probe/` runs the real thing. It builds a pushwork-shaped folder document out of a real repo,
**stands in for the host** — answering those two selectors is the whole of the host's side of the
contract, including creating the storage document on request — mounts the component with an
element and nothing else, moves the selection through nothing / a non-repo / the repo, presses
Build, and browses the result with site-viewer.

```sh
REPO=~/dev/aria-sgai-notebook \
TOOLS=~/dev/patchwork-experiments \
SHELL_DIST=~/dev/patchwork/sites/tiny-patchwork/dist \
node probe/run.mjs
```

Add `HEADED=1` to open a real window and watch it happen; the run pauses at the end so you can
poke at what it left on screen.

The repo needs a `dist/site-build.js` in it (`pnpm build:browser` over there). A run against the
ARIA SGAI Notebook — 66 files, 84 documents — reports:

| | |
| --- | --- |
| asked for | `patchwork:selected-doc` and `patchwork:tool-storage` |
| nothing selected | "Nothing selected", no Build offered |
| a document that is not a repo | "Not a CakeWalk repo", no Build offered |
| the repo selected | "aria-sgai-notebook", Build offered |
| build | 45 files in ~100ms, `wrote 45 changed` |
| rebuild, nothing changed | `wrote 0 changed, removed 0` |
| output document | 45 files: 32 stored, 13 referenced from source |
| served | `index.html` 200 text/html, `diagrams.css` 200 text/css, `01-interface-overview.png` 200 image/png |
| rendered | home 223 css rules; `/alifib/` 461 rules, 6/6 images |

The images are worth a second look: all six are among the referenced files, so a page loading
them is also proof that the resolver follows a URL where a file should be and hands back the
right content type. The probe picks a nested page whose directory also holds an image, rather
than the first link it finds — otherwise it lands on a page with no images and reports 0 / 0,
which reads like a pass and checks nothing.

It also works against the Ink & Switch website — 614 files, 756 documents, 603 built, 301
referenced — which is the test of whether one tool really does serve every fork.
