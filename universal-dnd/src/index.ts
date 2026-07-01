import { installKeyboard } from "./app.js";
import { mountBadge } from "./badge.js";
import { toolRender } from "./tool.js";

/**
 * Boot-time side effect. `ModuleWatcher` `import()`s this entry to read
 * `plugins`, so this runs once at site boot — giving us an "always on" global
 * behavior without depending on the tool actually being mounted anywhere.
 * Guarded so HMR re-imports don't double-install.
 */
function install(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __patchworkUniversalDnd?: boolean };
  if (w.__patchworkUniversalDnd) return;
  w.__patchworkUniversalDnd = true;
  installKeyboard();
  mountBadge();
  console.info(
    "[universal-dnd] installed \u2014 hold Shift+Alt (or click the badge) to reveal drag handles"
  );
}

install();

/**
 * Registered as a toolbar tool so it shows up "visibly installed" where the
 * frame surfaces `documentToolbarToolIds`. `unlisted` keeps it out of the
 * normal tool picker / fallback selection (it shouldn't open documents),
 * while `forTitleBar` marks it for toolbar placement.
 *
 * `load` returns the render fn directly, so `plugin.module` is the callable
 * the platform invokes — no default-export ambiguity.
 */
export const plugins = [
  {
    type: "patchwork:tool" as const,
    id: "universal-dnd",
    name: "Universal DnD",
    icon: "move",
    supportedDatatypes: "*" as const,
    unlisted: true,
    forTitleBar: true,
    load: async () => toolRender,
  },
];
