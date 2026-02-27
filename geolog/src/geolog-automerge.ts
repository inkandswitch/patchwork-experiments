import { parseTheory, importTheory, createDatabase, Database, Theory } from 'geolog';
import type { DocHandle } from '@automerge/automerge-repo';
import { ImmutableString, isImmutableString } from '@automerge/automerge-repo';

// ============================================================================
// Types mirroring the geolog WASM export format (from theory.export())
// ============================================================================

export type DerivedSort =
  | { type: 'base'; id: string }
  | { type: 'product'; fields: [string, DerivedSort][] }
  | { type: 'int' }
  | { type: 'str' };

export interface SortInfo {
  id: string;
  name: string;
}

export interface RelationInfo {
  id: string;
  name: string;
  domain: DerivedSort;
}

export interface FunctionInfo {
  id: string;
  name: string;
  domain: DerivedSort;
  codomain: DerivedSort;
}

export interface SignatureInfo {
  sorts: SortInfo[];
  relations: RelationInfo[];
  functions: FunctionInfo[];
}

export interface ExportedTheory {
  name: string;
  signature: SignatureInfo;
  axioms: unknown[];
}

// ============================================================================

/**
 * Document structure for storing a geolog database in Automerge.
 */
export interface GeologDoc {
  /** Raw DSL source text (for display/re-editing) */
  theorySrc: string;
  /** Exported theory JSON with stable UUIDs */
  theory: ImmutableString;
  /** Operation log keyed by op ID */
  ops: { [opId: string]: ImmutableString };
}

/**
 * Operation returned by geolog when adding entities/relations
 */
export interface GeologOp {
  id: string;
  type: 'addEntity' | 'addRelation';
  entityId?: string;
  parents?: string[];
  [key: string]: unknown;
}

/**
 * Bridge between a Geolog database and an Automerge document handle.
 *
 * Handles bidirectional sync:
 * - Local changes (addEntity/addRelation) are written to the Automerge doc
 * - Remote changes (via Automerge patches) are applied to the local db
 */
export class GeologAutomerge {
  private db: Database;
  private theory: Theory;
  private handle: DocHandle<GeologDoc>;
  private appliedOps: Set<string> = new Set();
  private instanceId: string;
  private changeHandler: ((args: { patches: unknown[] }) => void) | null = null;

  private constructor(
    theory: Theory,
    db: Database,
    handle: DocHandle<GeologDoc>,
    instanceId: string,
  ) {
    this.theory = theory;
    this.db = db;
    this.handle = handle;
    this.instanceId = instanceId;
  }

  /**
   * Create a new GeologAutomerge instance with a fresh database.
   * Initializes the Automerge doc with the theory source and exported theory.
   */
  static create(
    handle: DocHandle<GeologDoc>,
    schema: string,
    instanceId: string = 'A',
  ): GeologAutomerge {
    const theory = parseTheory(schema);
    const db = createDatabase(theory);

    const exportedTheory = theory.export();
    handle.change((doc) => {
      doc.theorySrc = schema;
      doc.theory = new ImmutableString(JSON.stringify(exportedTheory));
      doc.ops = {};
    });

    const instance = new GeologAutomerge(theory, db, handle, instanceId);
    instance.setupChangeListener();
    return instance;
  }

  /**
   * Load a GeologAutomerge instance from an existing Automerge doc.
   * Reconstructs the database from stored operations.
   */
  static async load(
    handle: DocHandle<GeologDoc>,
    instanceId: string = 'B',
  ): Promise<GeologAutomerge> {
    const doc = handle.doc();
    if (!doc) {
      throw new Error('Document not found');
    }

    const exportedTheory = JSON.parse(doc.theory.toString());
    const theory = importTheory(exportedTheory);

    const ops: GeologOp[] = Object.values(doc.ops).map((opJson) =>
      JSON.parse(opJson.toString()),
    );

    const db = createDatabase(theory);
    for (const op of ops) {
      db.applyOp(op);
    }

    const instance = new GeologAutomerge(theory, db, handle, instanceId);

    for (const opId of Object.keys(doc.ops)) {
      instance.appliedOps.add(opId);
    }

    instance.setupChangeListener();
    return instance;
  }

  /**
   * Set up listener for Automerge document changes.
   * Applies new ops from remote peers to the local database.
   */
  private setupChangeListener(): void {
    this.changeHandler = ({ patches }) => {
      for (const patch of patches as Array<{
        action: string;
        path: unknown[];
        value?: unknown;
      }>) {
        if (
          patch.path[0] === 'ops' &&
          patch.path.length === 2 &&
          patch.action === 'put'
        ) {
          const opId = patch.path[1] as string;

          if (this.appliedOps.has(opId)) continue;

          const patchVal = patch.value;
          const opJson = isImmutableString(patchVal)
            ? patchVal.toString()
            : String(patchVal);
          const op = JSON.parse(opJson) as GeologOp;

          this.db.applyOp(op);
          this.appliedOps.add(opId);
        }
      }
    };
    this.handle.on('change', this.changeHandler);
  }

  /**
   * Remove the change listener and free resources.
   */
  dispose(): void {
    if (this.changeHandler) {
      this.handle.off('change', this.changeHandler);
      this.changeHandler = null;
    }
  }

  /**
   * Add an entity of the given sort.
   * Returns the entity ID.
   */
  addEntity(sortName: string): string {
    const parentsBefore: string[] = this.db.getHeads();

    const op = this.db.addEntity(sortName) as GeologOp;
    op.parents = parentsBefore;
    this.appliedOps.add(op.id);

    this.handle.change((doc) => {
      doc.ops[op.id] = new ImmutableString(JSON.stringify(op));
    });

    return op.entityId!;
  }

  /**
   * Add a relation tuple.
   * Args should match the relation's parameter types.
   */
  addRelation(
    relName: string,
    args: Array<{ entity: string } | { int: number } | { str: string }>,
  ): string {
    const parentsBefore: string[] = this.db.getHeads();

    const op = this.db.addRelation(relName, args) as GeologOp;
    op.parents = parentsBefore;
    this.appliedOps.add(op.id);

    this.handle.change((doc) => {
      doc.ops[op.id] = new ImmutableString(JSON.stringify(op));
    });

    return op.id;
  }

  /**
   * Get the current database state as JSON.
   */
  getState(): { entities: Record<string, string[]>; relations: Record<string, unknown[][]> } {
    return JSON.parse(this.db.toJson());
  }

  /**
   * Check if an entity exists.
   */
  hasEntity(entityId: string): boolean {
    return this.db.hasEntity(entityId);
  }

  get theoryName(): string {
    return this.theory.name;
  }

  get database(): Database {
    return this.db;
  }

  get docHandle(): DocHandle<GeologDoc> {
    return this.handle;
  }

  getExportedTheory(): ExportedTheory {
    return this.theory.export() as ExportedTheory;
  }

  get instanceIdValue(): string {
    return this.instanceId;
  }
}
