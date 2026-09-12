# site-viewer

Browse a document full of files as the website it is.

Patchwork's service worker serves any document of files at `/<url>/<path>` — a **directory
doc**, which keys files by path in one document, or a **folder doc**, which holds a document
per file. This tool points an iframe at one and gets out of the way: links work, the back of
the site works, and what you are looking at is the real thing in a real browser, not a
rendering of it.

```
pnpm install
pnpm test          # the path logic
pnpm sync          # publish
```

## What it does

A toolbar with **Home**, **Reload**, the path you are on, and **Open ↗** for a full tab. The
iframe below it is the site. Clicking a link inside navigates the iframe, and the path updates
to follow; when the document changes underneath you — a rebuild, or someone else's edit — the
page you are on reloads in place rather than throwing you back to the home page.

## It finds the site, and mounts it

`findSite()` returns `{url, prefix}` — the document to mount, and any path inside it. A built site
has `index.html` at its root; a pushworked repo keeps its site under `public/`, which in the
`patchwork-folder` shape is **its own document**. The site is mounted there.

That distinction is the whole reason the preview updates. Navigation goes to a **heads-pinned**
URL, because a bare one is answered with a redirect to the pinned one and the service worker
caches by request URL. Mounted at the repo root, the pinned URL never moves — rebuilding a page
changes that page's folder document, not the root — so it is a stable key for content that moves,
and what the cache holds is what you keep getting. Mounted at the `public/` document, its heads
move on every build, and the page *and every subresource under it* get a fresh key for free.

Measured in a real Patchwork before the fix: the bare repo URL served a stale page while the same
content read through the file document was current. In `vfs` there is no separate document, but
the root changes on every build, so mounting there was already right.

This also only works because the build emits relative URLs — `../static/base.css` resolves under
whatever the site is mounted at. Root-relative output could not be mounted anywhere but the root.

The viewer subscribes to the mounted document *and* every folder document along the path it is
showing, re-resolving each link without its heads — a pinned link is a frozen view that would
never report a change, which would have looked correct and been silently dead.

## A host can say where to start

Two attributes on the `<patchwork-view>` that embeds this tool:

| | |
| --- | --- |
| `data-path` | the page to open; changing it moves the preview |
| `data-build` | that a build happened; changing it reloads wherever the preview is |

Attributes rather than a shared module on purpose: neither tool imports the other, and when
nobody sets them the viewer just opens the site's home page and reloads on document changes.

The viewer does not depend on `data-build` being set, though: it subscribes to **every folder
document along the path it is showing**, not only the document it was handed, so it hears a
rebuild by itself. Each link is re-resolved *without its heads* — an artifact folder link is
heads-pinned, and a pinned handle is a frozen view that would never report a change, which would
have looked correct and been silently dead. In vfs there is nothing to walk, since every path is
a key on the root.

`data-build` is belt and braces on top of that, and it matters when the two tools are different
vintages. Watching the document alone is not enough.

Reloading also has to be a real navigation. The iframe is sitting on the heads-pinned URL the
service worker redirected it to, and the viewer navigates to the *bare* URL — so
`contentWindow.location.replace()` moves it and picks up the new heads. Assigning an unchanged
`src` attribute is not reliably a navigation at all.

## Two things about serving a site out of a document

Both were measured against a real shell rather than reasoned about, and both shape the code.

**The address is pinned to the document's heads.** Asking for `automerge:abc` answers a 307 to
`automerge:abc#<heads>`, so the URL the iframe ends up at is never the one it was given, and it
changes every time the document does. This is why getting fresh content means navigating to the
bare URL again and letting it re-pin, rather than calling `reload()` — and it is why
`paths.js` has to read both forms of the URL back.

It is also a nice property: everything a page loads comes from one pinned snapshot, so a
preview cannot tear halfway through a build.

**There is no `index.html` fallback.** Asking for a directory — `/<url>/sub/` — answers 500,
not a redirect and not a 404. So this tool always names a file, and a site served this way has
to link to `sub/index.html` rather than `sub/`. For CakeWalk sites that is what
`system/relativize.ts` does; for anything else, it is a thing to know.

## Testing it

`pnpm test` covers `paths.js`, which is where the encoding lives.

The rest only means anything in a browser, so `probe/` drives the real tool, in a real
Patchwork shell, against a real built site: it loads the site into a directory doc, mounts the
tool through its actual `(handle, element) => cleanup` contract, and clicks around, reporting
what resolved at each depth.

```sh
SITE=~/dev/aria-sgai-notebook/public \
SHELL_DIST=~/dev/patchwork/sites/tiny-patchwork/dist \
node probe/run.mjs
```

Add `HEADED=1` to open a real window and watch it happen; the run pauses at the end so you can
poke at what it left on screen. Headless is the fast loop, headed is the one that tells you
layout and focus are fine too.

It needs a built site and a built shell to point at; both are named by environment variable so
it is not tied to either. A run against the ARIA SGAI Notebook (45 files) reports:

| page | stylesheets | css rules | images loaded |
| --- | --- | --- | --- |
| `/index.html` | 2 | 223 | — |
| `/alifib/index.html` (one level down) | 3 | 461 | 6 / 6 |
| `/styleguide/index.html` (own stylesheet, sibling images) | 5 | 549 | 14 / 14 |

The rule counts are the point: a stylesheet that fails to resolve still shows up in
`document.styleSheets`, with no rules in it. Counting rules is how you tell a stylesheet that
loaded from one that only looks like it did.
