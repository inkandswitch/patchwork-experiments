export { MonsterShapeUtil, MONSTER_SHAPE_TYPE } from "./MonsterShapeUtil.tsx";
export { MonsterShapeTool } from "./MonsterShapeTool.tsx";

import {
  DefaultToolbar,
  DefaultToolbarContent,
  TldrawUiMenuItem,
  useIsToolSelected,
  useTools,
  type TLComponents,
  type TLUiOverrides,
} from "@tldraw/tldraw";

export const monsterUiOverrides: TLUiOverrides = {
  tools(editor, tools) {
    tools.monster = {
      id: "monster",
      icon: "group",
      label: "Monster",
      kbd: "m",
      onSelect: () => {
        editor.setCurrentTool("monster");
      },
    };
    return tools;
  },
};

export const monsterComponents: Pick<TLComponents, "Toolbar"> = {
  Toolbar: (props) => {
    const tools = useTools();
    const isMonsterSelected = useIsToolSelected(tools["monster"]);
    return (
      <DefaultToolbar {...props}>
        <TldrawUiMenuItem {...tools["monster"]} isSelected={isMonsterSelected} />
        <DefaultToolbarContent />
      </DefaultToolbar>
    );
  },
};
