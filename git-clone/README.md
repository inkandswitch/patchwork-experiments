# git-clone

A Patchwork tool that clones a git repository — entirely in the browser — into a
folder of Automerge documents using the **same shapes pushwork uses**.

## What it does

1. You paste a git URL (and optionally a branch/ref) and click **Clone**.
2. The tool clones the repo in the browser via
   [`isomorphic-git`](https://isomorphic-git.org/) over a CORS proxy
   (shallow, `depth=1`, single branch — no history).
3. It writes the working tree as a tree of Patchwork `folder` + `file`
   documents and opens the resulting folder.

Because the documents use pushwork's `patchwork-folder` shape, the result is:

- browsable directly in Patchwork (Space / folder views), and
- round-trippable with `pushwork clone <root-folder-url>` to materialize the
  tree back onto disk.

## Document shapes

The cloned repo is materialized as standard Patchwork documents (identical to
what `pushwork`'s `patchwork-folder` shape produces):

```ts
// folder doc
{ "@patchwork": { type: "folder" }, title, docs: DocLink[] }
// file doc
{ "@patchwork": { type: "file" }, content, extension, mimeType, name }
```

File content encoding matches pushwork: valid UTF-8 is stored as a
CRDT-mergeable string, everything else (binary, files containing NUL) as a
`Uint8Array`. Git history and the `.git` directory are discarded — pushwork
stores a working-tree snapshot, not git objects.

The tool's own document (`git-clone` datatype) just holds the form state and a
pointer (`resultUrl`) to the root folder it created.

## CORS proxy

Browsers can't speak the git smart-HTTP protocol to most hosts directly, so
requests are routed through a CORS proxy. The default is the public
`https://cors.isomorphic-git.org`; you can change it under **Advanced** (e.g. to
a self-hosted [`@isomorphic-git/cors-proxy`](https://github.com/isomorphic-git/cors-proxy)).

Private repositories are not supported yet (no auth UI).

## Develop

```bash
pnpm install
pnpm build      # tsc + vite build → dist/index.js
pnpm sync       # build + pushwork sync → module URL
pnpm register   # add module URL to MODULE_SETTINGS_DOC_URL
```
