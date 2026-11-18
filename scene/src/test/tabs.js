// For tests of the parts whose panels are drawer tabs (src/parts/tab.js): an
// extension that opens them, as a viewer would from the toolbar, the first
// time it's updated (and again whenever one is shut, unless `once`).
//
//   mountStage({ extensions: [openTabs(["scene.inspector:inspector"]), INSPECTOR] })

/** @param {string[]} which  "ext:command" for each toggle to turn on */
export function openTabs(which, { once = false } = {}) {
  return {
    meta: { id: "t.tabs", type: "scene:view" },
    module: {
      create(api) {
        let done = false;
        return {
          update() {
            if (once && done) return;
            // (once: until each is on, as its plugin and the editor may start after this one)
            done = which.every((w) => {
              const [ext, command] = w.split(":");
              const c = api.collect("commands").find((x) => x.id === ext)?.value?.find?.((k) => k?.id === command);
              if (c && !c.state?.(null, {})?.checked) api.run({ ext, command, value: true });
              return !!c?.state?.(null, {})?.checked;
            });
          },
        };
      },
    },
  };
}
