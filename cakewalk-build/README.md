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

## The site goes where the CLI puts it

Built output is written into **the repo document, under `public/`** — the same directory
`site build` writes, so a sync lands it in everyone's checkout as the same bytes, ready for
`wrangler deploy`. There is no separate output document.

That matters because a pushworked repo already contains `public/` from whenever someone last ran
the CLI. An output document of its own meant two built sites with only one of them current, and
the stale one is what you got when you opened the repo. Now there is one.

The repo needs a `.pushworkattributes`:

```
dist/**      artifact
public/**    artifact
```

`artifact` stores a file as opaque immutable content rather than as a text CRDT — pushwork's
`applyFileEntry` reaches for `updateText` only when both sides are plain strings. Nobody edits
build output and nobody wants its history, so that is exactly right for it. **`dist` is listed
explicitly because defining any rule in that file replaces pushwork's default artifact directory
rather than adding to it** — omit it and the build bundle silently stops being an artifact.

An unchanged file is not written at all, which is pushwork's behaviour too. A **changed** file is
where this deliberately diverges: pushwork mutates the document in place to keep its URL stable,
and build output instead gets a **new document, with the old one deleted**.

The reason is that a mutated document keeps every version it has ever had. Measured on one 27kb
page of this site:

| versions | saved | load |
| --- | --- | --- |
| 1 | 9kb | 6.1ms |
| 500 | 112kb | 41.0ms |
| 2000 | 416kb | 157.2ms |

2000 versions is about 33 minutes of building at 1Hz. Memory after load stays flat — old versions
are never materialised — but the bytes are stored, synced, and scanned on every cold load, and
none of it is ever reclaimed. Replacing keeps a built page at one version forever.

The race pushwork avoids by not doing this is real: a folder can reference a new URL before its
bytes reach the server. It is recoverable for build output in a way it is not for source files —
the next build fixes it, and nothing depends on an artifact being readable the instant its URL
appears.

**Deleting an orphan is only safe after checking nothing still points at it.** A passed-through
asset shares its document with the source it came from, so a path that was passed through and is
now generated would otherwise take somebody's source file with it. vfs can check cheaply, because
every path is a key on one document. The folder shape cannot without walking the whole repo, so
orphans are left alone there.

A one-page edit reports `wrote 0 new, 2 replaced, 0 removed (30 untouched, 13 shared with the
source, 2 old documents deleted)` — the page, and `index.xml`, because the feed carries each
post's prose.

Note that `repo.delete` is local: peers and the sync server keep their copies, so this bounds
your storage rather than theirs.

## Assets are the same document, not a copy

Most of a built site is bytes the build never looked at — images, video, fonts — hardlinked
straight through. In the repo those become **a second key pointing at the source document**:

```js
root["content/alifib/img/01.png"] = "automerge:2xoB…"
root["public/alifib/img/01.png"] = "automerge:2xoB…"   // the same document
```

One document, two names, which is what the CLI's hardlink amounts to. For the ARIA notebook that
is 13 of 45 files; for the Ink & Switch website, whose assets are 150MB against 2.5MB of prose, it
is the difference between a document that works and one that does not.

The match is by object identity rather than by comparing bytes — an in-memory build aliases a
hardlinked file instead of copying it, so the array that comes out is the one that went in.

## A lesson the fake had to learn

Automerge refuses an assignment whose value is an object already inside the document —
*"Cannot create a reference to an existing document object"*. Preserving the subfolder links the
obvious way (`d.docs = [...d.docs, ...links]`) hits it.

The unit tests did not catch that, because the fake repo was plain objects and plain objects do
not care. The folder path passed every test and failed the moment it ran in a browser. The fake
models the restriction now — a WeakSet of everything already in the document, and a `set` trap
that throws as Automerge does — so the tests fail first next time.

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
| build | 45 files in ~60ms, `wrote 32 new … 13 shared with the source` |
| the patchwork-folder shape | builds the same way |
| rebuild, nothing changed | `nothing changed, wrote nothing` |
| editing a page | `wrote 0 new, 2 replaced, 0 removed (30 untouched, 2 deleted)` |
| selecting a content file | stays pinned, preview moves to `public/alifib/index.html` |
| selecting anything else | stays pinned |
| the repo | 45 files under `public/`, 13 sharing a document with the source, sources untouched |
| rendered | home 223 css rules; `/alifib/` 461 rules, 6/6 images |

The images are worth a second look: all six are among the referenced files, so a page loading
them is also proof that the resolver follows a URL where a file should be and hands back the
right content type. The probe picks a nested page whose directory also holds an image, rather
than the first link it finds — otherwise it lands on a page with no images and reports 0 / 0,
which reads like a pass and checks nothing.

It also works against the Ink & Switch website — 614 files, 756 documents, 603 built, 301
referenced — which is the test of whether one tool really does serve every fork.
