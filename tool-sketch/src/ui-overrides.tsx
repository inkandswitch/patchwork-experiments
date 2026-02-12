import { DefaultKeyboardShortcutsDialog, DefaultKeyboardShortcutsDialogContent, DefaultToolbar, DefaultToolbarContent, type TLComponents, type TLUiOverrides, TldrawUiMenuItem, useIsToolSelected, useTools } from "tldraw";

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

export const components: TLComponents = {
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
