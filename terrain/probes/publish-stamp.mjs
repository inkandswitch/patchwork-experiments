// The docs a publisher sends, from a probe page's snapshot: the contact doc
// left out, the scene's claims dropped, and the scene stamped with its
// packages (scene-packages.mjs withPackages: each package folder's synced
// url). A dry run must not need those urls: a fresh checkout or worktree
// has never been synced, so stamping throws there; a dry run then goes on
// unstamped and says so, and a real publish stops. Shared by both
// publishers in this folder. Plain node, no dependencies.
//
//   const { docs, problems, note } = publishDocs(snap, PACKAGES, { dry: DRY, withPackages, packageProblems });
//   if (problems.length) → stop(1); if (note) → say it

/** @returns {{ docs: Record<string, object>, problems: string[], note: string | null }} */
export function publishDocs(snap, pkgs, { dry, withPackages, packageProblems }) {
  // nobody who made it is here: their claims (who simulated her) don't travel, nor their contact doc
  const unclaimed = (doc) => {
    const d = structuredClone(doc);
    delete d.claims;
    for (const o of Object.values(d.objects ?? {})) delete o.claims;
    return d;
  };
  const docs = Object.fromEntries(Object.entries(snap.docs).filter(([, d]) => d["@patchwork"]?.type !== "contact").map(([u, d]) => [u, u === snap.scene ? unclaimed(d) : d]));
  try {
    const scene = withPackages(docs[snap.scene], pkgs);
    const problems = packageProblems(scene, pkgs);
    return { docs: { ...docs, [snap.scene]: scene }, problems, note: null };
  } catch (err) {
    const why = err?.message ?? String(err);
    if (dry) return { docs, problems: [], note: `the scene's packages aren't stamped (${why}): a dry run goes on without them; publishing needs them` };
    return { docs, problems: [why], note: null };
  }
}
