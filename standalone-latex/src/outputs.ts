/**
 * Output wiring for the LaTeX tool, built on EdgeHandles.
 *
 * V2 is PDF-only: the compiled PDF is the single source of truth, so there
 * is one output edge carrying the PDF bytes.
 *
 *     latex doc `content` ──source──▶ [ pdf edge ] ──targets──▶ pdf file docs
 *
 * The edge doc is the shared, persistent record of the wiring (its URL is
 * stored on the LaTeX doc). Targets are file-doc handles; the editor
 * compiles and fans the result out with `edge.change(bytes)`.
 */

import {
  isImmutableString,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import {
  createEdgeHandle,
  findEdgeHandle,
  type EdgeHandle,
} from "@inkandswitch/edge-handles";
import type { LaTeXDoc } from "./datatype";

// ─── file docs ───────────────────────────────────────────────────────────────

/** Shape of Patchwork file docs (matches @patchwork/file's datatype). */
export type FileDocShape = {
  "@patchwork"?: { type: string };
  name?: string;
  title?: string;
  extension?: string;
  mimeType?: string;
  content?: unknown;
};

type MaybeKeyhive = {
  addSyncServerRelayToDoc?: (url: AutomergeUrl) => Promise<unknown>;
};

async function createFileDoc(
  repo: Repo,
  init: FileDocShape,
  hive?: MaybeKeyhive
): Promise<DocHandle<FileDocShape>> {
  const create2 = (repo as { create2?: <T>(v?: T) => Promise<DocHandle<T>> })
    .create2;
  const handle = create2
    ? await create2.call(repo, init)
    : repo.create<FileDocShape>(init);
  // Give the new doc relay access so a second device can find it right away.
  await hive?.addSyncServerRelayToDoc?.(handle.url).catch?.(() => {});
  return handle as DocHandle<FileDocShape>;
}

/** Create a fresh pdf file doc, ready to be dragged into the sidebar. */
export function createPdfFileDoc(
  repo: Repo,
  title: string,
  initialBytes: Uint8Array,
  hive?: MaybeKeyhive
): Promise<DocHandle<FileDocShape>> {
  const name = title.endsWith(".pdf") ? title : `${title}.pdf`;
  return createFileDoc(
    repo,
    {
      "@patchwork": { type: "file" },
      name,
      extension: "pdf",
      mimeType: "application/pdf",
      content: initialBytes,
    },
    hive
  );
}

// ─── edge lifecycle ──────────────────────────────────────────────────────────

/**
 * Find this doc's PDF output edge, or create one (source pre-wired to the
 * LaTeX `content` field) and remember its URL on the doc.
 */
export async function ensureOutputEdge(
  repo: Repo,
  handle: DocHandle<LaTeXDoc>
): Promise<EdgeHandle<Uint8Array>> {
  const existingUrl = handle.doc()?.output?.pdfEdgeUrl;
  if (existingUrl) {
    try {
      return await findEdgeHandle<Uint8Array>(repo, existingUrl);
    } catch {
      // edge doc missing or invalid — fall through and re-create
    }
  }
  const edge = await createEdgeHandle<Uint8Array>(repo, {
    source: { latex: handle.sub("content") },
  });
  handle.change((d) => {
    if (!d.output) d.output = {};
    d.output.pdfEdgeUrl = edge.url;
  });
  return edge;
}

/** Open the doc's PDF output edge if one is recorded; never creates. */
export async function findOutputEdge(
  repo: Repo,
  handle: DocHandle<LaTeXDoc>
): Promise<EdgeHandle<Uint8Array> | null> {
  const url = handle.doc()?.output?.pdfEdgeUrl;
  if (!url) return null;
  try {
    return await findEdgeHandle<Uint8Array>(repo, url);
  } catch {
    return null;
  }
}

// ─── targets ─────────────────────────────────────────────────────────────────

export type OutputTarget = {
  /** Name key inside the edge doc's target map. */
  key: string;
  /** Full handle URL, possibly with a /path suffix. */
  url: AutomergeUrl;
  /** Just the doc portion (drag this to the sidebar). */
  docUrl: AutomergeUrl;
  /** Path inside the doc, [] when targeting a file doc's content directly. */
  path: string[];
  /** Resolved display label (doc name/title). */
  title: string;
  /** Resolution or write error, if any. */
  error?: string;
};

function splitHandleUrl(url: string): { docUrl: AutomergeUrl; path: string[] } {
  const rest = url.slice("automerge:".length);
  const hashIx = rest.indexOf("#");
  const beforeHash = hashIx === -1 ? rest : rest.slice(0, hashIx);
  const [docId, ...path] = beforeHash.split("/");
  return { docUrl: `automerge:${docId}` as AutomergeUrl, path };
}

/** Read and resolve the edge's targets into display-ready entries. */
export async function resolveTargets(
  repo: Repo,
  edge: EdgeHandle<Uint8Array>
): Promise<OutputTarget[]> {
  const targetMap = edge.doc.doc()?.target ?? {};
  return Promise.all(
    Object.entries(targetMap).map(async ([key, url]) => {
      const { docUrl, path } = splitHandleUrl(url);
      let title = "Untitled";
      try {
        const h = await repo.find<FileDocShape>(docUrl);
        const d = h.doc();
        title = d?.name || d?.title || "Untitled";
      } catch {
        // unsynced peer — leave the placeholder title
      }
      const error = edge.targetErrors[key]?.message;
      return { key, url, docUrl, path, title, error };
    })
  );
}

/** Add a target pointing at `path` inside `docUrl`. */
export async function addTarget(
  repo: Repo,
  edge: EdgeHandle<Uint8Array>,
  docUrl: AutomergeUrl,
  path: string[]
): Promise<void> {
  const docHandle = await repo.find(docUrl);
  const sub = path.length > 0 ? docHandle.sub(...path) : docHandle;
  const key = `out-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  edge.setTarget(key, sub as DocHandle<unknown>);
}

export function removeTarget(edge: EdgeHandle<Uint8Array>, key: string): void {
  edge.removeTarget(key);
}

// ─── publishing ──────────────────────────────────────────────────────────────

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Push compiled pdf bytes into the pdf edge (fans out to every target). */
export function publishPdf(
  edge: EdgeHandle<Uint8Array>,
  bytes: Uint8Array
): void {
  if (Object.keys(edge.target).length === 0) return;
  const prev = edge.value();
  if (prev instanceof Uint8Array && bytesEqual(prev, bytes)) return;
  edge.change(bytes);
}

// ─── inspecting dropped docs ─────────────────────────────────────────────────

export function isStringLeaf(value: unknown): boolean {
  return (
    typeof value === "string" ||
    (value != null && typeof value === "object" && isImmutableString(value))
  );
}

/** File-like docs can receive the PDF bytes at their `content` field. */
export function isFileLikeDoc(doc: unknown): boolean {
  if (doc == null || typeof doc !== "object") return false;
  const d = doc as FileDocShape;
  return "content" in d && (d.content == null || d.content instanceof Uint8Array || isStringLeaf(d.content));
}

// ─── drag & drop ─────────────────────────────────────────────────────────────

/**
 * Parse Patchwork doc URLs from a drag event. The sidebar sets
 * `text/x-patchwork-dnd` as `{source, items: [{url, name?, ...}]}`; other
 * tools set a plain `text/x-patchwork-urls` array.
 */
export function parsePatchworkDrop(
  dt: DataTransfer
): { url: AutomergeUrl; name?: string }[] {
  const out: { url: AutomergeUrl; name?: string }[] = [];

  const dndData = dt.getData("text/x-patchwork-dnd");
  if (dndData) {
    try {
      const parsed = JSON.parse(dndData);
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.items)
          ? parsed.items
          : [parsed];
      for (const item of items) {
        if (item?.url) out.push({ url: item.url, name: item.name });
      }
    } catch {
      // fall through to text/x-patchwork-urls
    }
  }

  if (out.length === 0) {
    const urlsData = dt.getData("text/x-patchwork-urls");
    if (urlsData) {
      try {
        const urls = JSON.parse(urlsData);
        if (Array.isArray(urls)) {
          for (const url of urls) if (url) out.push({ url });
        }
      } catch {
        // ignore
      }
    }
  }

  return out;
}

export function hasPatchworkDrop(dt: DataTransfer | null): boolean {
  return (
    !!dt?.types?.includes("text/x-patchwork-dnd") ||
    !!dt?.types?.includes("text/x-patchwork-urls")
  );
}
