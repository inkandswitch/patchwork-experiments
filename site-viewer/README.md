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

## A host can say where to start

`data-path` on the `<patchwork-view>` that embeds this tool names the page to open, and changing
it moves the preview. cakewalk-build sets it to the page for the file you are editing.

It is an attribute rather than a shared module on purpose: neither tool imports the other, and
when nobody sets it the viewer just opens the site's home page.

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
