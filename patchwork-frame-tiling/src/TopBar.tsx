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
import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelView } from "./types";

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
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.13 1.13M4.53 11.47 3.4 12.6M12.6 12.6l-1.13-1.13M4.53 4.53 3.4 3.4"
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

export const TopBar = ({
  repo,
  accountDocUrl,
  moduleSettingsUrl,
  contactUrl,
  rootFolderHandle,
  onHome,
  onOpen,
}: {
  repo: Repo;
  accountDocUrl: AutomergeUrl;
  moduleSettingsUrl?: AutomergeUrl;
  contactUrl?: AutomergeUrl;
  rootFolderHandle?: DocHandle<FolderDoc>;
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

      <div className="tile-topbar__group">
        <button
          className="tile-topbar__btn"
          title="Module settings"
          aria-label="Module settings"
          disabled={!moduleSettingsUrl}
          onClick={() =>
            moduleSettingsUrl && onOpen({ url: moduleSettingsUrl })
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
