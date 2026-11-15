// scene:part "machine": an empty cabinet, put in from the editor's parts bin
// (scene/STAGE.md, "Parts"). Its source is a machine doc of its own with no
// game yet: a ROM or an IWAD dropped on it gives it one (extension.js), as
// choosing one in the Machine tool does. Its session and seats come once it
// has a game, as for any machine object.

import { PROVIDER, TRAIT } from "./extension.js";

const made = async (repo, value) => (repo.create2 ? await repo.create2(value) : repo.create(value));

export default {
  async create(ctx, at) {
    const machine = await made(ctx.repo, { "@patchwork": { type: "machine" }, title: "Machine" });
    return ctx.addObject(machine.url, {
      providerId: PROVIDER,
      parent: at?.parent ?? null,
      ...(at?.transform ? { transform: at.transform } : {}),
      fields: { traits: { [TRAIT]: {} } },
    });
  },
};
