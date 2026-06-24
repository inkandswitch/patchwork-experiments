import { createMemo, For, Show } from "solid-js";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import {
  getRegistry,
  createDocOfDatatype2,
} from "@inkandswitch/patchwork-plugins";
import type { SpatialHostDoc } from "./folder-datatype";
import { CALIBRATION_DATATYPE_ID } from "./folder-datatype";

const EXCLUDED = new Set(["spatial-patchwork-host", CALIBRATION_DATATYPE_ID]);

type DatatypePlugin = {
  id: string;
  name?: string;
  unlisted?: boolean;
  module?: { getTitle?: (doc: unknown) => string };
};

export function CreateNew(props: {
  hostHandle: DocHandle<SpatialHostDoc>;
  repo: Repo;
}) {
  const datatypes = createMemo<DatatypePlugin[]>(() => {
    try {
      const reg = getRegistry("patchwork:datatype");
      const all = (reg.filter?.((d: DatatypePlugin) => !d.unlisted) ??
        []) as DatatypePlugin[];
      return all.filter((d) => !EXCLUDED.has(d.id));
    } catch {
      return [];
    }
  });

  async function create(datatype: DatatypePlugin) {
    try {
      const reg = getRegistry("patchwork:datatype");
      const dt = await reg.loadWhenReady(datatype.id);
      const child = await createDocOfDatatype2(dt as never, props.repo);
      let name = datatype.name || datatype.id;
      try {
        const t = (dt as DatatypePlugin).module?.getTitle?.(child.doc());
        if (t) name = t;
      } catch {
        /* getTitle optional */
      }
      props.hostHandle.change((d) => {
        if (!Array.isArray(d.docs)) d.docs = [];
        d.docs.push({ name, type: datatype.id, url: child.url });
        d.activeIndex = d.docs.length - 1;
      });
    } catch (err) {
      console.error("[spatial-host] create new failed:", err);
      window.alert("Could not create doc: " + err);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger as="button">Create new ▾</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="sph-create-content">
          <Show
            when={datatypes().length}
            fallback={<div class="sph-create-empty">No datatypes registered</div>}
          >
            <For each={datatypes()}>
              {(dt) => (
                <DropdownMenu.Item
                  class="sph-create-item"
                  onSelect={() => create(dt)}
                >
                  {dt.name || dt.id}
                </DropdownMenu.Item>
              )}
            </For>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
