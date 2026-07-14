import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DocLink, FolderDoc } from "./folder";
import { useDocument } from "solid-automerge";
import { For, Show, createMemo, createSignal } from "solid-js";

// The package's `spec.md` gets the rich markdown editor (see `inspect-spec`);
// every other file uses whatever tool the system picks by default.
const SPEC_NAME = "spec.md";

type Selected = { url: AutomergeUrl; name: string };

// A VSCode-style source browser over a package folder doc: a lazily-expanding
// file tree on the left, the single open file on the right. The package root is
// itself a folder doc, so the tree is just `FolderChildren` rooted at it.
export function SourceBrowser(props: { packageUrl: AutomergeUrl }) {
  const [selected, setSelected] = createSignal<Selected | null>(null);

  return (
    <div class="embark-inspect-source">
      <div class="embark-inspect-source__tree">
        <FolderChildren
          url={props.packageUrl}
          depth={0}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <div class="embark-inspect-source__pane">
        <Show
          when={selected()}
          keyed
          fallback={
            <div class="embark-inspect__empty">Select a file to view it.</div>
          }
        >
          {(file) =>
            file.name === SPEC_NAME ? (
              <patchwork-view
                class="embark-inspect__view"
                doc-url={file.url}
                tool-id="inspect-spec"
              />
            ) : (
              <patchwork-view class="embark-inspect__view" doc-url={file.url} />
            )
          }
        </Show>
      </div>
    </div>
  );
}

// Renders the children of one folder doc (the package root or a subfolder),
// loaded on demand so collapsed branches never resolve their documents.
function FolderChildren(props: {
  url: AutomergeUrl;
  depth: number;
  selected: () => Selected | null;
  onSelect: (next: Selected) => void;
}) {
  const [folder] = useDocument<FolderDoc>(() => props.url);
  const entries = createMemo<DocLink[]>(() => sortEntries(folder()?.docs ?? []));

  return (
    <Show
      when={folder()}
      fallback={
        <div
          class="embark-inspect-source__loading"
          style={{ "padding-left": indent(props.depth) }}
        >
          loading…
        </div>
      }
    >
      <For each={entries()}>
        {(entry) => (
          <TreeNode
            entry={entry}
            depth={props.depth}
            selected={props.selected}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </Show>
  );
}

// One row: a leaf file (selectable) or a folder (toggles its own children).
function TreeNode(props: {
  entry: DocLink;
  depth: number;
  selected: () => Selected | null;
  onSelect: (next: Selected) => void;
}) {
  const isFolder = () => props.entry.type === "folder";
  const [open, setOpen] = createSignal(false);
  const isActive = () => {
    const sel = props.selected();
    return (
      !isFolder() &&
      sel?.url === props.entry.url &&
      sel?.name === props.entry.name
    );
  };

  const activate = () => {
    if (isFolder()) {
      setOpen((value) => !value);
    } else {
      props.onSelect({ url: props.entry.url, name: props.entry.name });
    }
  };

  return (
    <>
      <button
        type="button"
        class="embark-inspect-source__row"
        classList={{ "embark-inspect-source__row--active": isActive() }}
        style={{ "padding-left": indent(props.depth) }}
        onClick={activate}
      >
        <span class="embark-inspect-source__twisty">
          {isFolder() ? (open() ? "▾" : "▸") : ""}
        </span>
        <span class="embark-inspect-source__name">{props.entry.name}</span>
      </button>
      <Show when={isFolder() && open()}>
        <FolderChildren
          url={props.entry.url}
          depth={props.depth + 1}
          selected={props.selected}
          onSelect={props.onSelect}
        />
      </Show>
    </>
  );
}

// Folders first, then files, each alphabetical — the familiar editor ordering.
function sortEntries(docs: DocLink[]): DocLink[] {
  return [...docs].sort((a, b) => {
    const aFolder = a.type === "folder" ? 0 : 1;
    const bFolder = b.type === "folder" ? 0 : 1;
    if (aFolder !== bFolder) return aFolder - bFolder;
    return a.name.localeCompare(b.name);
  });
}

function indent(depth: number): string {
  return `${8 + depth * 14}px`;
}
