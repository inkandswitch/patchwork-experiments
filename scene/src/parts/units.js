// scene.units: the settings' prefs: the "Units" picker and the "Snap" toggle.
// Each is a viewer pref (`units`, the doc's view.units as the suggestion;
// `snap`, on unless set false) that what shows a length or puts something
// down (a carry, a part, a paste) reads through "prefs" (NATIVE.md,
// "Prefs"). This only offers the choice.

import { UNIT_OPTIONS } from "../shared/units.js";

export default {
  create(api) {
    const current = () => api.use("prefs")?.get("units", "m") ?? "m";
    const snap = () => api.use("prefs")?.get("snap", true) !== false;
    return {
      commands: [
        {
          id: "units",
          hand: "edit",
          name: "Units",
          group: "settings",
          show: ["toolbar"],
          state: (target) => (target == null ? { value: current(), choices: UNIT_OPTIONS.map((o) => ({ ...o })), title: "Units for lengths" } : null),
          run: (_target, value) => {
            if (UNIT_OPTIONS.some((o) => o.value === value)) api.use("prefs")?.set("units", value);
          },
        },
        {
          id: "snap",
          hand: "edit",
          name: "Snap",
          group: "settings",
          show: ["toolbar"],
          state: (target) => (target == null ? { checked: snap(), title: "Put pieces down on the nearest snap point (hold Alt to place freely)" } : null),
          run: (_target, value) => api.use("prefs")?.set("snap", typeof value === "boolean" ? value : !snap()),
        },
      ],
    };
  },
};
