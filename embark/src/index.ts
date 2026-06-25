import { plugins as canvasPlugins } from "./canvas";
import { plugins as partsBinPlugins } from "./canvas/parts-bin";
import { plugins as commandsPlugins } from "./commands";
import { plugins as contextViewerPlugins } from "./context-viewer";
import { plugins as searchPlugins } from "./search";
import { plugins as cardsPlugins } from "./cards";
import { plugins as cardPlugins } from "./card";
import { plugins as llmCardPlugins } from "./llm-card";
import { plugins as inspectPlugins } from "./inspect";
import { plugins as mapPlugins } from "./map";
import { plugins as mentionPlugins } from "./mention";
import { plugins as runningTrackerPlugins } from "./running-tracker";
import { plugins as stickerPlugins } from "./stickers";
import { plugins as todoPlugins } from "./todo";

export const plugins = [
  ...canvasPlugins,
  ...partsBinPlugins,
  ...commandsPlugins,
  ...searchPlugins,
  ...cardsPlugins,
  ...cardPlugins,
  ...llmCardPlugins,
  ...inspectPlugins,
  ...mapPlugins,
  ...mentionPlugins,
  ...runningTrackerPlugins,
  ...stickerPlugins,
  ...todoPlugins,
  ...contextViewerPlugins,
];
