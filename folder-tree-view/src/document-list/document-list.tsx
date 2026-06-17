import {
  deleteAt,
  updateText,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type {
  OpenDocumentEventDetail,
  PatchworkViewElement,
} from "@inkandswitch/patchwork-elements";
import type {
  DocLink,
  FolderDoc,
  HasPatchworkMetadata,
} from "@inkandswitch/patchwork-filesystem";
import { getRegistry, type Datatype } from "@inkandswitch/patchwork-plugins";
import { For, Match, Show, Suspense, Switch } from "solid-js";
import { filter, filterMatches, setRenaming } from "../state.ts";
import Folder from "./folder.tsx";
import Item from "./item.tsx";
import { ItemName } from "./name.tsx";

export interface DocumentListProps {
  handle: DocHandle<FolderDoc>;
  docs?: DocLink[];
  depth: number;
  repo: Repo;
  open(detail: OpenDocumentEventDetail): void;
  selectedDocUrls: AutomergeUrl[];
  visitedFolders?: Set<AutomergeUrl>;
  element: PatchworkViewElement;
  rootFolderHandle: DocHandle<FolderDoc>;
}

export function DocumentList(props: DocumentListProps) {
  const visitedFolders = props.visitedFolders ?? new Set<AutomergeUrl>();

  function removeItem(index: number) {
    props.handle.change((folder) => deleteAt(folder.docs, index));
  }

  return (
    <Suspense>
      <For each={props.docs}>
        {(doc, index) => {
          const visible = () => !filter().length || filterMatches(doc.name);
          const remove = () => removeItem(index());
          const relid = () => props.handle.url + "/" + index();
          const rename = (name: string) => {
            props.handle.change((doc) => {
              updateText(doc, ["docs", index(), "name"], name);
            });
            const datatypes = getRegistry<Datatype>("patchwork:datatype");
            props.repo
              .find<Partial<HasPatchworkMetadata>>(doc.url)
              .then(async (handle) => {
                const { "@patchwork": metadata } = handle.doc();

                if (metadata) {
                  const datatype = datatypes.get(metadata.type) as Datatype;

                  if (datatype) {
                    await datatypes.load(datatype.id);
                    handle.change((doc) =>
                      (datatype as any).module.setTitle?.(doc, name),
                    );
                  }
                }
              });
          };

          return (
            <div
              classList={{
                "folder-tree__item": true,
                "folder-tree__item--visible": visible(),
                "folder-tree__item--invisible": !visible(),
              }}
            >
              <Switch>
                <Match when={doc.type == "folder"}>
                  <Show
                    when={!visitedFolders.has(doc.url)}
                    fallback={
                      <div
                        class="document-list-folder__circular-ref"
                        style={{ "padding-left": `calc(var(--depth) * 1rem)` }}
                      >
                        <span>{doc.name} (i contain myself eventually)</span>
                      </div>
                    }
                  >
                    <Folder
                      url={doc.url}
                      depth={props.depth}
                      repo={props.repo}
                      removeFromParent={remove}
                      open={props.open}
                      name={doc.name}
                      selectedDocUrls={props.selectedDocUrls}
                      visitedFolders={visitedFolders}
                      element={props.element}
                      rootFolderHandle={props.rootFolderHandle}
                    />
                  </Show>
                </Match>
                <Match when={doc.type != "folder"}>
                  <Item
                    aria-label={doc.name}
                    url={doc.url}
                    name={doc.name}
                    id={relid()}
                    startRenaming={() => setRenaming(relid())}
                    remove={remove}
                    pressed={props.selectedDocUrls.includes(doc.url)}
                    type={doc.type}
                    element={props.element}
                    repo={props.repo}
                    rootFolderHandle={props.rootFolderHandle}
                    parentFolderHandle={props.handle}
                    itemIndex={index()}
                    openWith={(toolId) =>
                      props.open({
                        url: doc.url,
                        toolId,
                        title: doc.name,
                        type: doc.type,
                      })
                    }
                  >
                    <ItemName name={doc.name} id={relid()} rename={rename} />
                  </Item>
                </Match>
              </Switch>
            </div>
          );
        }}
      </For>
    </Suspense>
  );
}
