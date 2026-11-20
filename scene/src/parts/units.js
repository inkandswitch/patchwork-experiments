// scene.units: the "Units" picker. The unit is a viewer pref (`units`, the
// doc's view.units as the suggestion); everything that shows a length reads
// it through "prefs" (NATIVE.md, "Native services"). This only offers the choice.

import { UNIT_OPTIONS } from "../units.js";

export default {
  create(api) {
    const current = () => api.use("prefs")?.get("units", "m") ?? "m";
    return {
      commands: [
        {
          id: "units",
          edit: true,
          name: "Units",
          group: "settings",
          show: ["toolbar"],
          state: (target) => (target == null ? { value: current(), choices: UNIT_OPTIONS.map((o) => ({ ...o })), title: "Units for lengths" } : null),
          run: (_target, value) => {
            if (UNIT_OPTIONS.some((o) => o.value === value)) api.use("prefs")?.set("units", value);
          },
        },
      ],
    };
  },
};
