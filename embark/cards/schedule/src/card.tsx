import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import { ScheduleCard } from "./ScheduleProvider";

// Schedule card behavior, loaded by the shared card shell as this package's
// `card.js`. The card face is drawn by the shell from the card document, so
// this module only runs the sticker engine and renders nothing into the middle
// slot.
const card: ToolRender = (_handle, element) =>
  render(() => <ScheduleCard element={element} />, element);

export default card;
