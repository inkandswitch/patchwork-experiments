import { Show, For, type Accessor, type Setter } from "solid-js";
import type {
  DatatypeDescription,
  ToolDescription,
  Plugin,
} from "@inkandswitch/patchwork-plugins";
import {
  SearchIcon,
  PlusIcon,
  WrenchIcon,
  LinkIcon,
  RenameIcon,
  TerminalIcon,
  BackIcon,
} from "./icons.jsx";
import { dispatchOpenEvent } from "./utils.js";
import FilterPanel from "./FilterPanel.jsx";
import type {
  Command,
  CommandCategory,
  CopyOption,
  DocLink,
  PanelMode,
} from "./types.js";

export default function PanelArea(props: {
  panelMode: Accessor<PanelMode>;
  backToCommands: () => void;
  close: () => void;

  // Command mode
  cmdQuery: Accessor<string>;
  setCmdQuery: (v: string) => void;
  cmdHighlight: Accessor<number>;
  setCmdHighlight: Setter<number>;
  filteredCommands: Accessor<Command[]>;
  groupedCommands: Accessor<
    {
      category: CommandCategory;
      label: string;
      items: Command[];
    }[]
  >;
  handleCmdKeyDown: (e: KeyboardEvent) => void;

  // Search mode
  searchQuery: Accessor<string>;
  setSearchQuery: (v: string) => void;
  searchHighlight: Accessor<number>;
  setSearchHighlight: Setter<number>;
  filteredDocs: Accessor<DocLink[]>;
  handleSearchKeyDown: (e: KeyboardEvent) => void;

  // New mode
  createQuery: Accessor<string>;
  setCreateQuery: (v: string) => void;
  createHighlight: Accessor<number>;
  setCreateHighlight: Setter<number>;
  filteredDatatypes: Accessor<Plugin<DatatypeDescription>[]>;
  handleNewKeyDown: (e: KeyboardEvent) => void;
  selectDatatype: (dt: Plugin<DatatypeDescription>) => void;

  // Tool mode
  toolQuery: Accessor<string>;
  setToolQuery: (v: string) => void;
  toolHighlight: Accessor<number>;
  setToolHighlight: Setter<number>;
  filteredTools: Accessor<Plugin<ToolDescription>[]>;
  handleToolKeyDown: (e: KeyboardEvent) => void;
  selectTool: (tool: Plugin<ToolDescription>) => void;

  // Rename mode
  renameValue: Accessor<string>;
  setRenameValue: (v: string) => void;
  submitRename: () => void;

  // Copy-url mode
  copyQuery: Accessor<string>;
  setCopyQuery: (v: string) => void;
  copyHighlight: Accessor<number>;
  setCopyHighlight: Setter<number>;
  filteredCopyOptions: Accessor<CopyOption[]>;
  handleCopyKeyDown: (e: KeyboardEvent) => void;
  selectCopyOption: (option: CopyOption) => void;

  // Copy-url-tool mode
  copyToolQuery: Accessor<string>;
  setCopyToolQuery: (v: string) => void;
  copyToolHighlight: Accessor<number>;
  setCopyToolHighlight: Setter<number>;
  filteredCopyToolOptions: Accessor<Plugin<ToolDescription>[]>;
  handleCopyToolKeyDown: (e: KeyboardEvent) => void;
  selectCopyTool: (tool: Plugin<ToolDescription>) => void;
  openCopyUrl: () => void;
}) {
  return (
    <div class="cmd-palette-panel" onClick={(e) => e.stopPropagation()}>
      {/* Command mode */}
      <Show when={props.panelMode() === "commands"}>
        <div class="cmd-palette-input-container">
          <span class="cmd-palette-input-icon">
            <TerminalIcon />
          </span>
          <input
            class="cmd-palette-input"
            placeholder="Type a command..."
            value={props.cmdQuery()}
            onInput={(e) => {
              props.setCmdQuery(e.target.value);
              props.setCmdHighlight(0);
            }}
            onKeyDown={props.handleCmdKeyDown}
            ref={(el) => requestAnimationFrame(() => el.focus())}
          />
        </div>
        <div class="cmd-palette-results">
          <Show
            when={props.filteredCommands().length > 0}
            fallback={
              <div class="cmd-palette-empty">No matching commands.</div>
            }
          >
            {(() => {
              let flatIndex = 0;
              return (
                <For each={props.groupedCommands()}>
                  {(group) => (
                    <>
                      <div class="cmd-palette-group-header">{group.label}</div>
                      <For each={group.items}>
                        {(cmd) => {
                          const idx = flatIndex++;
                          return (
                            <div
                              class="cmd-palette-item"
                              aria-selected={props.cmdHighlight() === idx}
                              onClick={() => cmd.action()}
                              onMouseMove={() => props.setCmdHighlight(idx)}
                            >
                              <span class="cmd-palette-item-label">
                                {cmd.name}
                              </span>
                              <span class="cmd-palette-item-description">
                                {cmd.description}
                              </span>
                            </div>
                          );
                        }}
                      </For>
                    </>
                  )}
                </For>
              );
            })()}
          </Show>
        </div>
      </Show>

      {/* Search mode */}
      <Show when={props.panelMode() === "search"}>
        <FilterPanel
          icon={<SearchIcon />}
          placeholder="Filter by title..."
          query={props.searchQuery}
          setQuery={(v) => props.setSearchQuery(v.toLowerCase())}
          highlight={props.searchHighlight}
          setHighlight={props.setSearchHighlight}
          items={props.filteredDocs}
          onKeyDown={props.handleSearchKeyDown}
          emptyMessage={
            props.searchQuery()
              ? "No matching documents."
              : "No documents found."
          }
          onSelect={(doc) => {
            dispatchOpenEvent({
              url: doc.url,
              title: doc.name,
              type: doc.type,
            });
            props.close();
          }}
          onBack={props.backToCommands}
          renderLabel={(doc) => <>{doc.name || "Untitled"}</>}
          renderDescription={(doc) => (doc.type ? <>{doc.type}</> : undefined)}
        />
      </Show>

      {/* New document mode */}
      <Show when={props.panelMode() === "new"}>
        <FilterPanel
          icon={<PlusIcon />}
          placeholder="Filter datatypes..."
          query={props.createQuery}
          setQuery={props.setCreateQuery}
          highlight={props.createHighlight}
          setHighlight={props.setCreateHighlight}
          items={props.filteredDatatypes}
          onKeyDown={props.handleNewKeyDown}
          emptyMessage="No matching datatypes."
          onSelect={props.selectDatatype}
          onBack={props.backToCommands}
          renderLabel={(dt) => <>{dt.name}</>}
        />
      </Show>

      {/* Tool picker mode */}
      <Show when={props.panelMode() === "tool"}>
        <FilterPanel
          icon={<WrenchIcon />}
          placeholder="Filter tools..."
          query={props.toolQuery}
          setQuery={props.setToolQuery}
          highlight={props.toolHighlight}
          setHighlight={props.setToolHighlight}
          items={props.filteredTools}
          onKeyDown={props.handleToolKeyDown}
          emptyMessage="No compatible tools."
          onSelect={props.selectTool}
          onBack={props.backToCommands}
          renderLabel={(tool) => <>{tool.name}</>}
        />
      </Show>

      {/* Rename mode */}
      <Show when={props.panelMode() === "rename"}>
        <div class="cmd-palette-input-container">
          <button
            class="cmd-palette-back-btn"
            onClick={props.backToCommands}
            title="Back to commands"
            aria-label="Back to commands"
          >
            <BackIcon />
          </button>
          <span class="cmd-palette-input-icon">
            <RenameIcon />
          </span>
          <input
            class="cmd-palette-input"
            placeholder="Enter new name..."
            value={props.renameValue()}
            onInput={(e) => props.setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                props.submitRename();
              }
            }}
            ref={(el) => {
              requestAnimationFrame(() => {
                el.focus();
                el.select();
              });
            }}
          />
        </div>
        <div class="cmd-palette-rename-hint">
          Press <kbd>Enter</kbd> to save
        </div>
      </Show>

      {/* Copy URL mode */}
      <Show when={props.panelMode() === "copy-url"}>
        <FilterPanel
          icon={<LinkIcon />}
          placeholder="Filter URL options..."
          query={props.copyQuery}
          setQuery={props.setCopyQuery}
          highlight={props.copyHighlight}
          setHighlight={props.setCopyHighlight}
          items={props.filteredCopyOptions}
          onKeyDown={props.handleCopyKeyDown}
          emptyMessage="No URL options available."
          onSelect={props.selectCopyOption}
          onBack={props.backToCommands}
          renderLabel={(option) => <>{option.label}</>}
        />
      </Show>

      {/* Copy URL with tool mode */}
      <Show when={props.panelMode() === "copy-url-tool"}>
        <FilterPanel
          icon={<WrenchIcon />}
          placeholder="Filter tools..."
          query={props.copyToolQuery}
          setQuery={props.setCopyToolQuery}
          highlight={props.copyToolHighlight}
          setHighlight={props.setCopyToolHighlight}
          items={props.filteredCopyToolOptions}
          onKeyDown={props.handleCopyToolKeyDown}
          emptyMessage="No compatible tools."
          onSelect={props.selectCopyTool}
          onBack={props.openCopyUrl}
          renderLabel={(tool) => <>{tool.name}</>}
        />
      </Show>

      <div class="cmd-palette-kbd">
        <kbd>↑</kbd> <kbd>↓</kbd> navigate &middot; <kbd>↵</kbd> select &middot;{" "}
        <kbd>esc</kbd> close
      </div>
    </div>
  );
}
