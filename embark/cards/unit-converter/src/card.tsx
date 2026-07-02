import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import { UnitConverterCard } from "./UnitConverterProvider";

// "Convert to metric" card behavior, loaded by the shared card shell as this
// package's `card.js`. The card face is drawn by the shell from the card
// document, so this module only runs the sticker engine and renders nothing
// into the middle slot.
const card: ToolRender = (_handle, element) =>
  render(() => <UnitConverterCard element={element} />, element);

export default card;
