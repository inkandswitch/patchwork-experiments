// scene.units: the "Units" picker. The unit is a viewer pref (`units`, the
// doc's view.units as the suggestion); everything that shows a length reads
// it with api.pref("units", "m"). This only offers the choice.

import { UNIT_OPTIONS } from "../units.js";

export default {
  create(api) {
    const current = () => api.pref("units", "m");
    return {
      commands: [
        {
          id: "units",
          name: "Units",
          show: ["toolbar"],
          state: (target) => (target == null ? { value: current(), choices: UNIT_OPTIONS.map((o) => ({ ...o })), title: "Units for lengths" } : null),
          run: (_target, value) => {
            if (UNIT_OPTIONS.some((o) => o.value === value)) api.setPref("units", value);
          },
        },
      ],
    };
  },
};
