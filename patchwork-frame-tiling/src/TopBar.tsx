import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type {
  DocLink,
  FolderDoc,
  HasPatchworkMetadata,
} from "@inkandswitch/patchwork-filesystem";
import {
  createDocOfDatatype2,
  getRegistry,
  isLoadablePlugin,
  isLoadedPlugin,
  type DatatypeDescription,
  type Plugin,
} from "@inkandswitch/patchwork-plugins";
import { useEffect, useRef, useState } from "react";
import type { PanelView, ToolSlot } from "./types";

const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M2.5 7.5 8 2.5l5.5 5M3.75 6.5v6.25a.75.75 0 0 0 .75.75h2.25V10h2.5v3.5h2.25a.75.75 0 0 0 .75-.75V6.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M8 3.25v9.5M3.25 8h9.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const GearIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ShoppingBagIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M3 5h10l-.7 8.1a1 1 0 0 1-1 .9H4.7a1 1 0 0 1-1-.9L3 5Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path
      d="M5.6 5V4a2.4 2.4 0 0 1 4.8 0v1"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="5.25" r="2.6" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M2.75 13.25c0-2.35 2.35-4.25 5.25-4.25s5.25 1.9 5.25 4.25"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

/** Reactively read the (non-unlisted) datatype plugins from the registry. */
function useDatatypePlugins(): Plugin<DatatypeDescription>[] {
  const [plugins, setPlugins] = useState<Plugin<DatatypeDescription>[]>(() =>
    getRegistry<DatatypeDescription>("patchwork:datatype").filter(
      (d) => !d.unlisted,
    ),
  );
  useEffect(() => {
    const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
    const update = () => setPlugins(registry.filter((d) => !d.unlisted));
    return registry.on("changed", update);
  }, []);
  return plugins;
}

async function createNewDoc(
  repo: Repo,
  datatype: Plugin<DatatypeDescription>,
): Promise<DocLink> {
  if (isLoadablePlugin(datatype)) {
    await getRegistry("patchwork:datatype").load(datatype.id);
  }
  if (!isLoadedPlugin(datatype)) {
    throw new Error("plugin not loaded after loading");
  }
  const docHandle = await createDocOfDatatype2(datatype, repo);
  const name = datatype.module.getTitle(docHandle.doc());
  return { name, type: datatype.id, url: docHandle.url };
}

async function docLinkByUrl(repo: Repo, url: AutomergeUrl): Promise<DocLink> {
  const handle = await repo.find<Partial<HasPatchworkMetadata>>(url);
  const doc = handle.doc();
  const type = doc?.["@patchwork"]?.type ?? "";
  let name = "Untitled";
  if (type) {
    const registry = getRegistry("patchwork:datatype");
    const datatype = registry.get(type);
    if (datatype) {
      await registry.load(datatype.id);
      if (isLoadedPlugin(datatype)) {
        name = datatype.module.getTitle(doc) || name;
      }
    }
  }
  return { name, type, url };
}

const CreateNewMenu = ({
  repo,
  rootFolderHandle,
  onOpen,
}: {
  repo: Repo;
  rootFolderHandle?: DocHandle<FolderDoc>;
  onOpen: (view: PanelView) => void;
}) => {
  const datatypes = useDatatypePlugins();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const isUrl = isValidAutomergeUrl(query.trim());
  const filtered = query.trim()
    ? datatypes.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
    : datatypes;

  const insertAndOpen = (link: DocLink) => {
    rootFolderHandle?.change((doc) => {
      if (!doc.docs) doc.docs = [];
      doc.docs.push(link);
    });
    onOpen({ url: link.url });
    setOpen(false);
    setQuery("");
  };

  const selectDatatype = async (datatype: Plugin<DatatypeDescription>) => {
    insertAndOpen(await createNewDoc(repo, datatype));
  };

  const submitUrl = async () => {
    const trimmed = query.trim();
    if (!isValidAutomergeUrl(trimmed)) return;
    insertAndOpen(await docLinkByUrl(repo, trimmed as AutomergeUrl));
  };

  return (
    <div className="tile-topbar__menu" ref={containerRef}>
      <button
        className="tile-topbar__btn"
        title="Create new document"
        aria-label="Create new document"
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon />
      </button>
      {open && (
        <div className="tile-topbar__popover" role="menu">
          <input
            ref={inputRef}
            className="tile-topbar__filter"
            placeholder="Filter or paste an automerge url…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "Enter") {
                if (isUrl) void submitUrl();
                else if (filtered[0]) void selectDatatype(filtered[0]);
              }
            }}
          />
          <div className="tile-topbar__list">
            {isUrl && (
              <button
                className="tile-topbar__item"
                onClick={() => void submitUrl()}
              >
                Add by URL
              </button>
            )}
            {filtered.map((datatype) => (
              <button
                key={datatype.id}
                className="tile-topbar__item"
                onClick={() => void selectDatatype(datatype)}
              >
                {datatype.name}
              </button>
            ))}
            {filtered.length === 0 && !isUrl && (
              <div className="tile-topbar__empty">No matching types</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * The system tray: a row of configured `patchwork:component`s (tagged
 * `system-tray`) from the shared frame config's `tray` lane — the same
 * config the threepane frame uses. A bare slot is a component id; a
 * `[toolId, docId]` tuple renders that tool against its doc. Discriminate by
 * `Array.isArray` (an Automerge raw-string slot isn't a native `string`, so
 * `typeof` would misfire).
 */
const Tray = ({ slots }: { slots: ToolSlot[] }) => {
  if (slots.length === 0) return null;
  return (
    <div className="tile-topbar__tray">
      {slots.map((slot, i) =>
        Array.isArray(slot) ? (
          <patchwork-view
            key={`${i}:${String(slot[0])}`}
            doc-url={String(slot[1])}
            tool-id={String(slot[0])}
          />
        ) : (
          <patchwork-view key={`${i}:${String(slot)}`} component={String(slot)} />
        ),
      )}
    </div>
  );
};

export const TopBar = ({
  repo,
  accountDocUrl,
  moduleSettingsUrl,
  contactUrl,
  rootFolderHandle,
  traySlots,
  onHome,
  onOpen,
}: {
  repo: Repo;
  accountDocUrl: AutomergeUrl;
  moduleSettingsUrl?: AutomergeUrl;
  contactUrl?: AutomergeUrl;
  rootFolderHandle?: DocHandle<FolderDoc>;
  traySlots: ToolSlot[];
  onHome: () => void;
  onOpen: (view: PanelView) => void;
}) => {
  const openAccount = () =>
    onOpen({ url: accountDocUrl, toolId: "account-picker" });

  return (
    <header className="tile-topbar">
      <div className="tile-topbar__group">
        <button
          className="tile-topbar__btn"
          title="Home (root folder)"
          aria-label="Home"
          onClick={onHome}
        >
          <HomeIcon />
        </button>
        <CreateNewMenu
          repo={repo}
          rootFolderHandle={rootFolderHandle}
          onOpen={onOpen}
        />
      </div>

      <div className="tile-topbar__spacer" />

      <Tray slots={traySlots} />

      <div className="tile-topbar__group">
        <button
          className="tile-topbar__btn"
          title="Packages"
          aria-label="Packages"
          disabled={!moduleSettingsUrl}
          onClick={() =>
            moduleSettingsUrl && onOpen({ url: moduleSettingsUrl })
          }
        >
          <ShoppingBagIcon />
        </button>
        <button
          className="tile-topbar__btn"
          title="Settings"
          aria-label="Settings"
          onClick={() =>
            onOpen({ url: accountDocUrl, toolId: "frame-configurator" })
          }
        >
          <GearIcon />
        </button>
        <button
          className="tile-topbar__avatar-btn"
          title="Account"
          aria-label="Account"
          onClick={openAccount}
        >
          {contactUrl ? (
            <patchwork-view doc-url={contactUrl} tool-id="contact-avatar" />
          ) : (
            <UserIcon />
          )}
        </button>
      </div>
    </header>
  );
};
