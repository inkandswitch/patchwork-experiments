// The scene:source SourceImpl for both providers. Reading the linked body
// stays here on the main thread (it needs the repo and the plugin registry);
// the rest of the build is a plain job (build-job.js) that build-runner.js
// runs in a worker, or on the main thread when no worker can be started.

import { flowFingerprint, flowDependencies } from "./fingerprint.js";
import { normalizeBodySpec } from "./body.js";
import { bodySectionFor } from "./section.js";
import { makeJob } from "./build-job.js";
import { runSuperseding, takeTicket } from "./build-runner.js";

/** @param {"slice"|"streamlines"} kind */
export function sceneSource(kind) {
  return {
    async build({ doc, params, repo, url }) {
      const ticket = takeTicket(); // before the body is read: orders builds by the doc they got
      const ctx = await bodySectionFor(doc, normalizeBodySpec(doc?.body), { repo, url });
      const job = makeJob(kind, doc, params, ctx);
      // what this build read: a build of the same url that read something else is superseded
      const identity = `${flowFingerprint(job.doc)}|${job.section?.key ?? "-"}`;
      const { glb, meta } = await runSuperseding(job, { url, identity, ticket });
      return { kind: "glb", glb, meta };
    },
    fingerprint: flowFingerprint,
    dependencies: flowDependencies,
  };
}
