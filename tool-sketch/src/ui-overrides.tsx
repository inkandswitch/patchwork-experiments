import type { AutomergeUrl } from "@automerge/automerge-repo";
import { DefaultKeyboardShortcutsDialog, DefaultKeyboardShortcutsDialogContent, DefaultToolbar, DefaultToolbarContent, type TLComponents, type TLUiOverrides, TldrawUiMenuItem, useIsToolSelected, useTools } from "tldraw";
import { TurnIntoTool } from "./turn-into-tool/TurnIntoToolButton.tsx";

export const uiOverrides: TLUiOverrides = {
  tools(editor, tools) {
    tools.embed = {
      id: "embed",
      icon: "link",
      label: "Embed",
      kbd: "e",
      onSelect: () => {
        editor.setCurrentTool("embed");
      },
    };
    return tools;
  },
};

export function makeComponents(docUrl: AutomergeUrl): TLComponents {
  return {
    SharePanel: () => {
      return <TurnIntoTool docUrl={docUrl} />;
    },
    Toolbar: (props) => {
      const tools = useTools();
      const isEmbedSelected = useIsToolSelected(tools["embed"]);
      return (
        <DefaultToolbar {...props}>
          <TldrawUiMenuItem {...tools["embed"]} isSelected={isEmbedSelected} />
          <DefaultToolbarContent />
        </DefaultToolbar>
      );
    },
    KeyboardShortcutsDialog: (props) => {
      const tools = useTools();
      return (
        <DefaultKeyboardShortcutsDialog {...props}>
          <TldrawUiMenuItem {...tools["embed"]} />
          <DefaultKeyboardShortcutsDialogContent />
        </DefaultKeyboardShortcutsDialog>
      );
    },
  };
}
