import { Show, type Accessor } from "solid-js";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import {
  PlusIcon,
  WrenchIcon,
  LinkIcon,
  SaveIcon,
  RenameIcon,
  TrashIcon,
  SearchIcon,
  HistoryIcon,
  PackageIcon,
  SettingsIcon,
  UserIcon,
} from "./icons.jsx";
import { dispatchOpenEvent } from "./utils.js";
import type { AccountDoc, PanelMode } from "./types.js";

export default function ButtonRow(props: {
  panelMode: Accessor<PanelMode>;
  isCurrentDocSaved: Accessor<boolean>;
  accountDocHandle: DocHandle<AccountDoc>;
  togglePanel: (mode: PanelMode) => void;
  saveDocToRootFolder: () => void;
  removeDocFromRootFolder: () => void;
  close: () => void;
}) {
  function toggle(mode: PanelMode) {
    return () => props.togglePanel(mode);
  }

  return (
    <div class="cmd-palette-button-row" onClick={(e) => e.stopPropagation()}>
      {/* Create group */}
      <button
        class="cmd-palette-btn"
        classList={{ "cmd-palette-btn--active": props.panelMode() === "new" }}
        onClick={toggle("new")}
        title="Create new"
        aria-label="Create new"
      >
        <PlusIcon />
      </button>

      <div class="cmd-palette-btn-divider" />

      {/* Document group */}
      <button
        class="cmd-palette-btn"
        classList={{ "cmd-palette-btn--active": props.panelMode() === "tool" }}
        onClick={toggle("tool")}
        title="Switch tool"
        aria-label="Open the current document with a different tool"
      >
        <WrenchIcon />
      </button>

      <button
        class="cmd-palette-btn"
        classList={{
          "cmd-palette-btn--active": props.panelMode() === "copy-url",
        }}
        onClick={toggle("copy-url")}
        title="Copy URL"
        aria-label="Copy document URL to clipboard"
      >
        <LinkIcon />
      </button>

      <Show when={!props.isCurrentDocSaved()}>
        <button
          class="cmd-palette-btn"
          onClick={props.saveDocToRootFolder}
          title="Save current document"
          aria-label="Add the current document to your account's root folder"
        >
          <SaveIcon />
        </button>
      </Show>

      <Show when={props.isCurrentDocSaved()}>
        <button
          class="cmd-palette-btn"
          classList={{
            "cmd-palette-btn--active": props.panelMode() === "rename",
          }}
          onClick={toggle("rename")}
          title="Rename"
          aria-label="Rename current document"
        >
          <RenameIcon />
        </button>

        <button
          class="cmd-palette-btn"
          onClick={props.removeDocFromRootFolder}
          title="Remove from account"
          aria-label="Remove current document from account root folder"
        >
          <TrashIcon />
        </button>
      </Show>

      <div class="cmd-palette-btn-divider" />

      {/* Account group */}
      <button
        class="cmd-palette-btn"
        classList={{
          "cmd-palette-btn--active": props.panelMode() === "search",
        }}
        onClick={toggle("search")}
        title="Search documents"
        aria-label="Search documents"
      >
        <SearchIcon />
      </button>

      <Show when={props.accountDocHandle.doc()?.accountHistoryUrl}>
        {(historyUrl) => (
          <button
            class="cmd-palette-btn"
            onClick={() => {
              dispatchOpenEvent({
                url: historyUrl() as AutomergeUrl,
                toolId: "account-history-viewer",
              });
              props.close();
            }}
            title="Account history"
            aria-label="Account history"
          >
            <HistoryIcon />
          </button>
        )}
      </Show>

      <Show when={props.accountDocHandle.doc()?.moduleSettingsUrl}>
        {(moduleSettingsUrl) => (
          <button
            class="cmd-palette-btn"
            onClick={() => {
              dispatchOpenEvent({ url: moduleSettingsUrl() as AutomergeUrl });
              props.close();
            }}
            title="Packages"
            aria-label="Packages"
          >
            <PackageIcon />
          </button>
        )}
      </Show>

      <button
        class="cmd-palette-btn"
        onClick={() => {
          dispatchOpenEvent({
            url: props.accountDocHandle.url,
            toolId: "frame-configurator",
          });
          props.close();
        }}
        title="Settings"
        aria-label="Settings"
      >
        <SettingsIcon />
      </button>

      <button
        class="cmd-palette-btn"
        onClick={() => {
          dispatchOpenEvent({
            url: props.accountDocHandle.url,
            toolId: "account-picker",
          });
          props.close();
        }}
        title="Account"
        aria-label="Account"
      >
        <UserIcon />
      </button>
    </div>
  );
}
