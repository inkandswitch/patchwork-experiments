import { installKeyboard } from "./app.js";
import { componentRender, toolRender } from "./tool.js";

/**
 * Boot-time side effect, run when this module is first imported on the main
 * thread (which happens when a frame mounts one of the surfaces below). Installs
 * the global Shift+Alt reveal. Guarded so HMR / repeated mounts don't
 * double-install.
 */
function install(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __patchworkUniversalDnd?: boolean };
  if (w.__patchworkUniversalDnd) return;
  w.__patchworkUniversalDnd = true;
  installKeyboard();
  console.info(
    "[universal-dnd] installed \u2014 hold Shift+Alt to reveal drag handles"
  );
}

install();

/**
 * Registered on TWO surfaces so the tool comes alive regardless of how a given
 * frame exposes always-on tools — the important side-effect of being mounted
 * anywhere is that it imports this module on the main thread, which runs the
 * boot `install()` above (Shift+Alt reveal, badge, keyboard). Frames only
 * import a plugin's module when they actually mount one of its surfaces, so a
 * tool with no mounted surface never runs at all.
 *
 *  - `patchwork:component` tagged `"system-tray"` — the zero-config path on
 *    current frames: newer threepane / the tiling frame auto-mount every
 *    system-tray component. Also what a threepane **sidebar-widget** or any
 *    bare-string slot resolves to (`<patchwork-view component=…>`, no doc).
 *  - `patchwork:tool` (`supportedDatatypes: "*"`, `unlisted`) — for threepane's
 *    **doctitle** lane (rendered `<patchwork-view tool-id=… doc-url=…>`) and
 *    doc-panel tool surfaces on other frames. `unlisted` keeps it out of the
 *    "open with" picker; `tags: ["titlebar-tool"]` is what surfaces it in the
 *    Frame Configurator's Toolbar add-picker.
 *
 * `load` returns the render fn directly, so `plugin.module` is the callable the
 * platform invokes — no default-export ambiguity.
 */
export const plugins = [
  {
    type: "patchwork:component" as const,
    id: "universal-dnd",
    name: "Universal DnD",
    icon: "move",
    tags: ["system-tray"] as const,
    load: async () => componentRender,
  },
  {
    type: "patchwork:tool" as const,
    id: "universal-dnd",
    name: "Universal DnD",
    icon: "move",
    supportedDatatypes: "*" as const,
    unlisted: true,
    tags: ["titlebar-tool"] as const,
    load: async () => toolRender,
  },
];
