// The embark core platform as ONE registered module: every editor and the two
// extension hosts, merged into a single plugins list. Each sub-package keeps
// its own vite build; this index just concatenates their built plugin
// descriptors (descriptor-only `plugins.js` entries where a package provides
// one, so discovery stays light — the heavy code loads lazily per plugin).
//
// The core package is also the platform import surface for bundleless cards:
// - ./client.js                — the context-store client
// - ./channels/codemirror.js   — the `codemirror:extensions` socket definition
// - ./channels/map.js          — the `map:extensions` socket definition
// Cards import those by this package's automerge url; the store implementation
// and everything else in here is bundled and reaches cards only through the
// running canvas.

import { plugins as canvas } from "./editors/canvas/dist/index.js";
import { plugins as card } from "./editors/card/dist/index.js";
import { plugins as contextViewer } from "./editors/context-viewer/dist/index.js";
import { plugins as inspect } from "./editors/inspect/dist/plugins.js";
import { plugins as map } from "./editors/map/dist/index.js";
import { plugins as todo } from "./editors/todo/dist/index.js";
import { plugins as tokenView } from "./editors/token-view/dist/index.js";
import { plugins as runningTracker } from "./editors/running-tracker/dist/index.js";
import { plugins as codemirrorHost } from "./context/codemirror-extensions-host/dist/plugins.js";
import { plugins as mapHost } from "./context/map-extensions-host/dist/plugins.js";

export const plugins = [
  ...canvas,
  ...card,
  ...contextViewer,
  ...inspect,
  ...map,
  ...todo,
  ...tokenView,
  ...runningTracker,
  ...codemirrorHost,
  ...mapHost,
];
