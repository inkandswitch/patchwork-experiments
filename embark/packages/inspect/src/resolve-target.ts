import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo";
import {
  getRegistry,
  getSupportedToolsForType,
} from "@inkandswitch/patchwork-plugins";

// The document inspect mints and renders: it carries nothing but the package
// that paints the inspected embed and, for a tool (not a component), the
// document that embed shows. Inspect points a `<patchwork-view>` at each.
export type InspectDoc = {
  "@patchwork": { type: "inspect" };
  packageUrl: AutomergeUrl;
  documentUrl?: AutomergeUrl;
};

// What `resolveInspectTarget` recovers from the embed being inspected.
export type InspectTarget = {
  packageUrl: AutomergeUrl;
  documentUrl?: AutomergeUrl;
};

// Find the closest rendered `<patchwork-view>` (a tool) or component host under
// `root` and resolve the package that paints it — plus, for a tool, the document
// it shows. The package is always an `automerge:` folder doc (a pushwork
// `rootUrl`): for a tool it is the registered plugin's `importUrl`; for a
// component it is parsed out of the component module url. Returns null when
// nothing renderable is found (e.g. a tool whose package is an HTTP bundle).
export async function resolveInspectTarget(
  root: HTMLElement,
  repo: Repo,
): Promise<InspectTarget | null> {
  // A component embed is unambiguous (its host carries the module url), so check
  // it first: a tool's own content could itself contain a `<patchwork-view>`.
  const componentUrl = root.querySelector<HTMLElement>("[data-component-url]")
    ?.dataset.componentUrl;
  if (componentUrl) {
    const packageUrl = folderDocFromComponentUrl(componentUrl);
    return packageUrl ? { packageUrl } : null;
  }

  const view = root.querySelector("patchwork-view");
  return view ? resolveFromView(view, repo) : null;
}

// A tool embed: the package is the plugin's `importUrl`, the document is the
// view's `doc-url`. The tool id is read from the element when pinned, otherwise
// recovered the way the view itself would resolve a fallback — the first listed
// tool supporting the document's datatype.
async function resolveFromView(
  view: Element,
  repo: Repo,
): Promise<InspectTarget | null> {
  const rawDocUrl = view.getAttribute("doc-url");
  const documentUrl =
    rawDocUrl && isValidAutomergeUrl(rawDocUrl) ? rawDocUrl : undefined;

  const toolId =
    view.getAttribute("tool-id") ??
    (documentUrl ? await fallbackToolId(repo, documentUrl) : undefined);
  if (!toolId) return null;

  const importUrl = getRegistry("patchwork:tool").get(toolId)?.importUrl;
  if (!importUrl || !isValidAutomergeUrl(importUrl)) return null;

  return documentUrl
    ? { packageUrl: importUrl, documentUrl }
    : { packageUrl: importUrl };
}

// The tool a view falls back to for a document with no pinned tool-id: the first
// listed tool registered for the document's `@patchwork.type`.
async function fallbackToolId(
  repo: Repo,
  documentUrl: AutomergeUrl,
): Promise<string | undefined> {
  try {
    const handle = await repo.find(documentUrl);
    const type = docType(handle.doc());
    if (!type) return undefined;
    return getSupportedToolsForType(type).find((tool) => !tool.unlisted)?.id;
  } catch {
    return undefined;
  }
}

// The `automerge:` folder doc a component module url points at. The url is
// `/automerge%3A<rootUrl>/component.js` (the worker-served module path), so the
// first path segment decodes to the package's folder doc; normalize to the
// stable, head-less url.
function folderDocFromComponentUrl(
  componentUrl: string,
): AutomergeUrl | undefined {
  const segment = componentUrl.replace(/^\//, "").split("/")[0];
  const decoded = decodeURIComponent(segment);
  if (!isValidAutomergeUrl(decoded)) return undefined;
  return stringifyAutomergeUrl({ documentId: parseAutomergeUrl(decoded).documentId });
}

// The patchwork datatype a document declares (`@patchwork.type`), if any.
function docType(doc: unknown): string | undefined {
  if (doc === null || typeof doc !== "object") return undefined;
  const meta = (doc as { "@patchwork"?: { type?: unknown } })["@patchwork"];
  return meta && typeof meta.type === "string" ? meta.type : undefined;
}
