import { createEffect, untrack } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc } from "../datatype.ts";
import { CURRENT_SCHEMA_VERSION, migrateDoc } from "../schema.ts";

export function useMigration(deps: {
  doc: BulletsDoc;
  handle: DocHandle<BulletsDoc>;
}) {
  const { doc, handle } = deps;

  createEffect(() => {
    // Access doc.schemaVersion reactively so this re-runs if it changes
    const version = doc.schemaVersion;
    untrack(() => {
      const fromVersion = version ?? 0;
      if (fromVersion >= CURRENT_SCHEMA_VERSION) return;
      console.log(`[Bullets] Migrating doc schema v${fromVersion} → v${CURRENT_SCHEMA_VERSION}`);
      handle.change((d) => {
        migrateDoc(d);
      });
    });
  });
}
