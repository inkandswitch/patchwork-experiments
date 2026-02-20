import { BaseBoxShapeTool } from "@tldraw/tldraw";

export class MonsterShapeTool extends BaseBoxShapeTool {
  static override id = "monster";
  static override initial = "idle";
  override shapeType = "monster" as const;
}
