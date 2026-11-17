# Web snapshot

Keep a web page as it looked, frozen.

A page you read today may say something else tomorrow, or be gone. This
package keeps a page *itself* in one `web-snapshot` document: its rendered
DOM — the page after its scripts ran — with every stylesheet, font and image
it loads that can be fetched, frozen before anything is stored, so that what
the document holds runs nothing and reaches nothing, and opens later, offline,
looking as it did.

It is its own package, with no build step. It registers:

| plugin | id | what |
|---|---|---|
| `patchwork:datatype` | `web-snapshot` | a page kept as it looked |
| `patchwork:tool` | `web-snapshot` | that page, shown inert; an empty one is where a person captures one |
| `agent:tool` | `web_capture` | the capture, for the agent and its research steps |

`index.js` imports nothing; every plugin's code is behind a dynamic `import()`
in its `load()`, so the entry evaluates in Patchwork's worker and loads from an
`automerge:` URL. The `agent:tool` entry carries its description and schema as
plain JSON, because the agent reads them before loading anything; a test holds
them equal to the module's.

A snapshot is an ordinary document, filed in the folder of the work it belongs
to — a project's folder, a workflow's Sources folder — like any other.

## A frozen snapshot

A capture freezes the page before it stores it (`capture/freeze.js`
`freezePage`). What is stored has:

- no `<script>` or `<noscript>`, no `on*` handler, no `javascript:` URL (a
  link to one goes to `#`), no `<base>`, no `<meta http-equiv>` (so no
  refresh or redirect) and every `http-equiv` in the text renamed
  `data-x-http-equiv`, no preload, prefetch, preconnect or manifest link, no
  `integrity`, `nonce`, `ping`, form `action` or `formaction`, no `srcdoc`
  and no frame, object or embed of a `data:` or `blob:` document; SVG
  animation cannot set an `href`;
- every load position rewritten: a kept resource becomes an `ni:` URI
  (RFC 6920, `ni:///sha-256;<hash>?ct=<type>`) naming the blob that holds it;
  anything not kept keeps its absolute URL, so nothing resolves against the
  page that shows it;
- links made absolute, opening in a new tab;
- our Content-Security-Policy first, allowing nothing but `data:` images,
  media, styles and fonts — so the stored HTML, opened by anything at all,
  fetches nothing either.

Every stylesheet it loads is stored frozen the same way (its `url()`,
`@import` and `image-set()` rewritten to `ni:` URIs, recursively; an import
cycle keeps an absolute URL), re-encoded as UTF-8. So is every SVG image, which
can carry script — whatever type it was served as, and one written into the page
as a `data:` URL too — read as the XML it is (`capture/svg.js`): its DOCTYPE
removed, the entities that declared written out, its elements and attributes
known by their local names. Images, fonts and the rest are stored byte for byte.
Each is stored once, under the SHA-256 of what is stored. A URL is read as the
URL parser reads it, so a control character before `javascript:` hides nothing.

Every `<` the scanner read as text — in an attribute value, a comment, raw
text, CDATA — is escaped, and a tag the input ends inside is dropped, so a
browser that reads contrived markup differently from the scanner can find
only text where the scanner found tags, never a tag it did not rewrite. The
page is rewritten by splicing its own text, so everything else is exactly as
it came. Freezing is a pure function of the responses: the same responses
store the same bytes, and freezing a stored page again changes nothing.

The document:

```
"@patchwork"  { type: "web-snapshot" }
title, source           what, and the URL asked for
capture                 { at, finalUrl, via: "direct" | "reader", engine: "reader-dom" | "raw",
                          status, contentType, readerCache,
                          sha256, bytes,                          of what is stored: the frozen page
                          received: { sha256, bytes, charset } }  of the page as it came
html                    the frozen page, UTF-8 bytes (a Uint8Array, not a text CRDT)
base                    what the page's links were resolved against
resources               { [url]: { kind, from, order, outcome, status?, mimeType?,
                          sha256? (of what came), stored? (the blob that holds it), ... } }
blobs                   { [sha256]: Uint8Array }: exactly what the page shows
budget, tally, complete the limits used, the counts, whether it finished
text, textVia, marks    the readable text and its headings, for the agent's source_read
pages, missing          null
```

It keeps the agent's source contract, so the agent's `source_read` reads its
text like any kept source. A new snapshot (`init`) has every field and nothing
captured: `capture` and `html` null.

## Showing and exporting it

The view shows `render(doc)` as the `srcdoc` of an iframe sandboxed with
`allow-popups` and `allow-popups-to-escape-sandbox` only — never scripts,
same-origin, forms, modals or top navigation. `render` runs the freeze again
over what is stored — a snapshot is a shared document, and a collaborator can
edit it — and writes each blob an `ni:` URI names into a `data:` URL (a
stylesheet's own URIs too, recursively). An `ni:` URI that names no blob, or
whose type is anything but a bare `type/subtype`, is left as it is, and the
policy blocks it. Above the page: the source, the time, who rendered it, the
hash, what was kept and what was not and why, the text with its headings, and
Export.

**Export** saves the same string with Memento tags (`Memento-Datetime`,
`<link rel="original">`) and a `patchwork-snapshot` marker, as one
self-contained HTML file. It is a pure function of the document: exporting
twice gives the same bytes, and capturing an export finds nothing to fetch but
what the first capture could not keep.

happy-dom honours neither the sandbox nor the policy, so whether a real
browser runs or fetches anything is `probes/snapshot-frame.mjs` (P5/P6), run
in Chrome. `probes/reader-dom.mjs` (P1/P2) asks the real reader what it sends
back, and `probes/capture-node.mjs` (P3) captures a PDF in node and compares it
byte for byte with an independent fetch, and checks a page's stored and
exported forms. They are written and not yet run.

## Capturing

`web-capture.js` is one pipeline. For a URL:

1. Ask for the page directly, as anyone would get it: no cookies, no
   referrer. In a browser this usually fails CORS for an HTML page; that costs
   one quick, recorded request.
2. Not a page (a PDF, an image): kept as the file it is, a PDF with the
   reader's text beside it.
3. A page: the reader's rendering of it (r.jina.ai's DOM after the page's
   scripts ran, `X-Return-Format: html` — a third party's rendering, and the
   snapshot says so), or, in node with `render: false`, the raw response.
   When the reader will not render it but the direct request got the HTML,
   that is kept and the result says it is the page before its scripts ran.
   When neither has the page, the reader's text is kept as an extract that
   says the page is missing.
4. What it loads, crawled through the same guarded fetch; the page frozen
   with it, within 20 MB for the whole snapshot as stored; its text and
   headings; one document, written in one change.

Every resource found is recorded with exactly one outcome — `ok`,
`http-error`, `unreachable`, `refused`, `type-mismatch`, `over-budget`,
`timeout`, `aborted`, `bad-url`, or `policy` for what is never fetched
(scripts, frames, video, objects). From a browser a site's own CSS and images
are often `unreachable` (CORS): that is recorded and left, and the snapshot
shows the page without them. Which resources are kept is a function of the
responses alone, whatever order they arrived in.

The pipeline under it is pure, in `capture/`, with no DOM, network or
automerge, so it runs the same in a tab, a worker and node:

| module | does |
|---|---|
| `scan.js` | an HTML tokenizer that keeps positions: raw text, RCDATA, foreign content, CDATA, duplicate attributes, a tag cut off at the end |
| `links.js` | the one table of load positions, read by both the crawl and the freeze |
| `css.js` | the URLs in a stylesheet: `url()`, `@import`, `@font-face`, `image-set()` |
| `sniff.js` | whether a response is what it was wanted for; an HTML body never is (the 404 page served as an image) |
| `charset.js` | BOM > header > `<meta>` / `@charset` > the parent's > utf-8 |
| `crawl.js` | what to fetch and keep, and why not; deterministic under every completion order |
| `text.js` | the readable text and its headings |
| `freeze.js` | the page frozen for storing, and rendered for showing |
| `bytes.js` | SHA-256, `ni:` URIs and `data:` URLs, the same everywhere |

**Where a capture may fetch** (`guard.js`): only http and https; never
localhost or any private, loopback or link-local address in any spelling;
never Patchwork's own origin or its sync servers, which hand a person's
documents to anyone asking by URL; never a path naming an automerge document.
A redirect's destination is checked before its body is read. `guard.js` is a
copy of the agent's `tools/guard.js`: copied, not imported, so this folder
works on its own, and tested here against the same table.

### By hand

Make a new Web Snapshot the normal Patchwork way, in the folder it belongs in.
An empty snapshot shows an address field and **Capture**:

- **capturing** shows each step as it goes (asking the page, asking the
  reader to render it, fetching what it loads, freezing, writing) and offers
  **Cancel**;
- **captured** fills *this* document, once, and shows the page;
- **failed** says why, honestly — the reader was unavailable and the page
  could not be had, the address was refused, it is a PDF and not a page, it
  was cancelled — and keeps the address to try again. Nothing is kept.

A snapshot is written once. A captured one offers no Capture, and the capture
refuses to write into a snapshot that already holds one — checked again inside
the write, so a capture someone else finished meanwhile is never written over.
That check sees only what has reached this peer: two captures into one empty
snapshot from different peers, before they sync, both write, and the merge
keeps each field from one or the other. Both leave a value on `capture`, so
the view recognises the conflict and shows neither, saying so, rather than a
page that mixes the two. To capture the page again, make a new snapshot. A target that is not a page
(a PDF, an image) is refused here rather than kept as another kind of
document. Capturing and failing are the view's own state, not the document's:
a capture abandoned when the tab closed leaves the snapshot empty, not stuck.

The view has no agent behind it, so it builds its own guarded fetch
(`snapshot/fetch.js`), refusing exactly what the agent's tab runner refuses:
this page's origin and the sync servers, as well as everything `guard.js`
refuses. It is the only place in the package that names the platform's
`fetch`.

### By the agent

When this package is installed, the agent finds **`web_capture`** `{url,
again?, render?, maxBytes?}` in the `agent:tool` registry. It makes a new
snapshot through the agent's repo. It is asked about and granted like
`web_fetch` (the agent's `GRANT_GROUPS` puts it with the web). A snapshot it
keeps is recorded in the conversation, so capturing the same page again
answers from it unless `again` is passed; the agent files it where the work is
with `source_file`.

### In a research step

A workflow's research step — web only, confined — has `web_capture` too, when
it runs in a tab (a worker has no plugin registry). Its `ctx.repo` is the
step's scoped repo: the snapshot goes into the workflow's ledger as the step
makes it, is filed in the workflow's Sources folder by the driver, and a
capture of a page any research step already captured answers from the ledger.

## `scoped: true`, and what it promises

The `agent:tool` entry says `scoped: true`. That is this package's word to the
agent that `web_capture` works only through the context it is handed:

- it reaches the network only through `ctx.fetchImpl`, a guarded fetch, and
  refuses to run without one (a function that carries no guard's policy
  counts as none) — never the platform's `fetch`;
- it writes only through `ctx.repo.create2()`, and reads what was kept before
  only from `ctx.repo.sources()` (a research step's ledger) or
  `ctx.session.doc().made` (a conversation's);
- it touches no global and no host module.

On that word the agent gives it to research steps, with their confined context
and nothing more. Installing this package therefore extends what research
steps can do: they can keep pages as they look. The tests hold the promise:
`index.test.js` checks every module `web-capture.js` imports for globals, a
bare `fetch(` and host imports; `scoped.test.js` drives `web_capture` the way a
research step does — a confined context built as the agent's `confine` builds
it (`test-support/confined.js`), over a repo full of a person's documents —
with its `url` set to every adversarial value, and checks after each call that
it opened only ledger documents, changed only what it made and the ledger,
sent nothing to a refused host, read no field of its context but the confined
ones, and let no sentinel out.

Nothing here imports the agent, and the agent imports nothing from here; they
meet only through the plugin registry, and either works without the other.

## Developing

```
pnpm install
pnpm test        # vitest run
```

Tests are exhaustive over small finite cases, with expected values written
from the rule, no randomness and no network: a scripted web stands behind a
real guarded fetch.
