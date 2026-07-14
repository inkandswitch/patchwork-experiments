import { automergeSyncPlugin } from "@automerge/automerge-codemirror";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { isImmutableString } from "@automerge/automerge-repo";
import { getRegistry, type ToolRender } from "@inkandswitch/patchwork-plugins";

// The spec is a pushwork `file` document: its editable text lives at `content`
// — a plain string for a root file like `spec.md`, or an ImmutableString/bytes
// for built `dist/` artifacts (shown read-only).
type FileDoc = { content?: unknown };
const PATH = ["content"];

// Spec viewer: codemirror-base's editor, but it force-loads the *markdown*
// codemirror extensions onto a `file` document's `content` field. The base tool
// keys its extension set off the doc's datatype, so a `file` doc would
// otherwise render as bare text; pinning the filter to "markdown" lights up
// syntax highlighting, clickable links, live `automerge:` embeds, and our
// @-mention / sticker tokens — the full patchwork-markdown face — for the spec.
export const SpecTool: ToolRender<FileDoc> = (handle, element) => {
  const content = handle.doc()?.content;
  const readOnly = handle.isReadOnly() || typeof content !== "string";

  const container = document.createElement("div");
  container.className = "embark-inspect-spec";
  element.appendChild(container);

  const markdownExtensions = new Compartment();
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: textOf(content),
      extensions: [
        EditorView.lineWrapping,
        automergeSyncPlugin({ handle: handle as never, path: PATH }),
        EditorState.readOnly.of(readOnly),
        markdownExtensions.of([]),
      ],
    }),
  });

  // Loaded lazily into their compartment so the editor paints immediately and
  // gains the rich extensions once the registry resolves them.
  void loadMarkdownExtensions().then((extensions) => {
    view.dispatch({ effects: markdownExtensions.reconfigure(extensions) });
  });

  return () => {
    view.destroy();
    container.remove();
  };
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (isImmutableString(content)) return String(content);
  return "";
}

// Mirrors codemirror-base's `loadCodeMirrorExtensionsForDoc`, but the datatype
// is fixed to "markdown" (the spec doc itself is type "file", which no markdown
// extension targets). Pulls every registered markdown/wildcard codemirror
// extension out of the shared registry — highlighting, links, embeds, and our
// own mention/sticker token renderers, all of which key off the editor text and
// DOM context rather than the host doc's shape.
async function loadMarkdownExtensions(): Promise<Extension[]> {
  const registry = getRegistry<any>("codemirror:extension");
  const loaded = await registry.loadAll(
    registry.filter(
      (ext: any) =>
        ext.supportedDatatypes === "*" ||
        (Array.isArray(ext.supportedDatatypes) &&
          (ext.supportedDatatypes.includes("markdown") ||
            ext.supportedDatatypes.includes("essay"))),
    ),
  );
  return loaded.flatMap((ext: any) =>
    Array.isArray(ext.module) ? ext.module : [ext.module],
  );
}
