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

## Both pushwork shapes

`pushwork init` writes one of two layouts, and this reads either:

```js
// vfs — the DEFAULT. One root document, keys are whole repo-relative paths.
{ "@patchwork": { type: "directory", title },
  "content/alifib/index.md": "automerge:aaa",
  "template/essay.html":     "automerge:ccc",
  lastSyncAt: 1771461049774 }

// patchwork-folder — a document per directory, nested.
{ "@patchwork": { type: "folder" }, title, docs: [{name, type, url}], lastSyncAt }
```

Both keep **one document per file**; they differ only in how the structure is stored. vfs has the
nicer property for this tool: enumerating a repo is a single document read rather than a crawl
through every directory — 1 read instead of ~324 for the Ink & Switch website.

`describeRepo` asks the same question of each — are there pages in `content/` and layouts in
`template/`? — but has to ask it differently, by name for one and by path prefix for the other. An
earlier version checked only for bare `content` and `template` keys, which a vfs repo never has;
its keys are `content/alifib/index.md`. That reported every vfs repo as "not a CakeWalk repo",
which was true of none of them.

## The site stays pinned

Selecting a repo pins it. Selecting anything else — a page you are editing, a chat, whatever —
leaves it pinned, with an `×` to release it.

That is not a convenience. You cannot edit a page and have its repo selected at the same time,
because editing is what takes the selection. Without pinning the builder would blank the moment
you started work.

## The preview follows what you are editing

`collectSources` returns an index from file document URL back to its path, so the tool knows the
document in your editor is `content/alifib/index.md`. `previewPathFor()` maps that to the page it
becomes, and site-viewer is told where to go through a `data-path` attribute on its
`<patchwork-view>` — a late-bound convention, so neither tool imports the other.

The mapping reproduces CakeWalk's `dest` rule (strip `content/`, `.md` → `.html`, clean URLs) and
then **checks its answer against what was actually built**. A page with `clean: false` is found
where it really landed, and a draft that was not published falls back to the home page rather than
pointing the preview at a resolver error.

## Assets are referenced, not copied

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

## It writes only what moved, and keeps no history

Three outcomes, decided by `planWrite()` — pure, so the decision is testable without a repo:

| | when | what it writes |
| --- | --- | --- |
| **skip** | nothing changed | the document is not touched at all |
| **update** | something changed | only the entries that moved |
| **replace** | no document yet, or `COMPACT_EVERY` builds since the last fresh one | the whole site, history discarded |

A one-page edit writes **two entries** — the page, and `index.xml`, because the feed carries each
post's prose. Not the other 43.

Writing only what moved is the cheap thing, but every write leaves a version behind in the
document's history, and nobody wants the built site's history: it is regenerated from source in
under 100ms. So the document is replaced outright every 50 builds, which bounds the history
without paying a full rewrite on every keystroke. Measured on this site's real output:

| | per rebuild |
| --- | --- |
| in place | ~0.3kb of history |
| fresh document | ~205kb written and synced |

A no-op build never counts toward compaction, so an idle tab with auto-rebuild on does not churn
its way into a replacement.

Generated text goes in as an **`ImmutableString`** rather than a plain string. A plain string in
Automerge is a text CRDT — `getObjectId` returns an object id for one — which is machinery for
collaborative editing that build output has no use for. pushwork draws the same line for its
artifact directories.

Because the document is updated in place, its URL holds still across an edit. That matters for
the live loop: the preview does not have to re-resolve a new URL, and its iframe does not reload,
on every keystroke.

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
| the repo selected (vfs) | "aria-sgai-notebook (vfs)", Build offered and enabled |
| build | 45 files in ~60ms, `wrote a new document with 45 files` (the first one) |
| the patchwork-folder shape | builds the same way |
| rebuild, nothing changed | `nothing changed, kept the previous document`, same URL |
| editing a page | `wrote 2 changed, removed 0` — the page and the feed, in the same document |
| selecting a content file | stays pinned, preview moves to `alifib/index.html` |
| selecting anything else | stays pinned |
| output document | 45 files: 32 stored, 13 referenced from source |
| rendered | home 223 css rules; `/alifib/` 461 rules, 6/6 images |

The images are worth a second look: all six are among the referenced files, so a page loading
them is also proof that the resolver follows a URL where a file should be and hands back the
right content type. The probe picks a nested page whose directory also holds an image, rather
than the first link it finds — otherwise it lands on a page with no images and reports 0 / 0,
which reads like a pass and checks nothing.

It also works against the Ink & Switch website — 614 files, 756 documents, 603 built, 301
referenced — which is the test of whether one tool really does serve every fork.
