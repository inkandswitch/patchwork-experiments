import type { BulletsDoc } from "./datatype.ts";

/**
 * The current schema version this build of the Bullets tool supports.
 * Bump this when making additive schema changes (new fields with defaults).
 */
export const CURRENT_SCHEMA_VERSION = 1;

type Migration = {
  from: number;
  to: number;
  migrate: (doc: BulletsDoc) => void;
};

/**
 * Ordered list of migrations. Each entry upgrades from `from` to `to`.
 * Migrations must be additive and idempotent. Multiple peers may run the
 * same migration concurrently.
 */
const migrations: Migration[] = [
  {
    from: 0,
    to: 1,
    migrate: (doc) => {
      doc.schemaVersion = 1;
    },
  },
];

/**
 * Apply all pending migrations to bring a doc up to CURRENT_SCHEMA_VERSION.
 * Returns true if any migrations were applied.
 */
export function migrateDoc(doc: BulletsDoc): boolean {
  let version = doc.schemaVersion ?? 0;
  let applied = false;

  for (const m of migrations) {
    if (m.from === version) {
      m.migrate(doc);
      version = m.to;
      applied = true;
    }
  }

  return applied;
}

/**
 * Returns true if the doc's schema version is newer than what this build supports.
 */
export function isDocFromFuture(doc: BulletsDoc): boolean {
  return (doc.schemaVersion ?? 0) > CURRENT_SCHEMA_VERSION;
}
