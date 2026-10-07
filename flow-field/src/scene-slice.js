// SourceImpl for scene:source "flow-field-slice" (see the scene contract).
import { buildSlice } from "./build-slice.js";
import { flowFingerprint, flowDependencies } from "./fingerprint.js";
import { normalizeBodySpec } from "./body.js";
import { bodySectionFor } from "./section.js";

export default {
  async build({ doc, params, repo, url }) {
    const ctx = await bodySectionFor(doc, normalizeBodySpec(doc?.body), { repo, url });
    const { glb, meta } = buildSlice(doc, params, ctx);
    return { kind: "glb", glb, meta };
  },
  fingerprint: flowFingerprint,
  dependencies: flowDependencies,
};
