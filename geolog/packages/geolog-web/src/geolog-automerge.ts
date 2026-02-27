import { parseTheory, importTheory, createDatabase, Database, Theory } from "geolog";
import type { DocHandle } from "@automerge/automerge-repo";
import { ImmutableString, isImmutableString } from "@automerge/automerge-repo";

// ============================================================================
// Types mirroring the geolog WASM export format (from theory.export())
// ============================================================================

export type DerivedSort =
  | { type: "base"; id: string }
  | { type: "product"; fields: [string, DerivedSort][] }
  | { type: "int" }
  | { type: "str" };

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
 * Document structure for storing geolog database in Automerge
 */
export interface GeologDoc {
  /** The exported theory (includes UUIDs for sorts/relations) */
  theory: ImmutableString;
  ops: { [opId: string]: ImmutableString };
}

/**
 * Operation returned by geolog when adding entities/relations
 */
export interface GeologOp {
  id: string;
  type: "addEntity" | "addRelation";
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

  private constructor(
    theory: Theory,
    db: Database,
    handle: DocHandle<GeologDoc>,
    instanceId: string
  ) {
    this.theory = theory;
    this.db = db;
    this.handle = handle;
    this.instanceId = instanceId;
  }

  /**
   * Create a new GeologAutomerge instance with a fresh database.
   * Initializes the Automerge doc with the exported theory.
   */
  static create(handle: DocHandle<GeologDoc>, schema: string, instanceId: string = "A"): GeologAutomerge {
    const theory = parseTheory(schema);
    const db = createDatabase(theory);

    // Export theory with UUIDs and store in document
    const exportedTheory = theory.export();
    handle.change((doc) => {
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
  static async load(handle: DocHandle<GeologDoc>, instanceId: string = "B"): Promise<GeologAutomerge> {
    const doc = handle.doc();
    if (!doc) {
      throw new Error("Document not found");
    }

    // Import the theory with the same UUIDs as the original
    const exportedTheory = JSON.parse(doc.theory.toString());
    const theory = importTheory(exportedTheory);
    
    // Parse all ops from the document
    const ops: GeologOp[] = Object.values(doc.ops).map((opJson) =>
      JSON.parse(opJson.toString())
    );

    // Create database and apply ops with their causal parents preserved.
    // This ensures the DAG structure is identical regardless of whether
    // the database was built incrementally or loaded from scratch.
    const db = createDatabase(theory);
    for (const op of ops) {
      // applyOp accepts the full op including parents field.
      // If parents are present, the WASM layer uses them to build the correct DAG.
      // If parents are missing (legacy ops), WASM falls back to current heads.
      db.applyOp(op);
    }

    const instance = new GeologAutomerge(theory, db, handle, instanceId);
    
    // Mark all existing ops as applied
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
    this.handle.on("change", ({ patches }) => {
      console.log(`=== [${this.instanceId}] Change event received ===`);
      console.log("All patches:", JSON.stringify(patches, null, 2));
      
      for (const patch of patches) {
        const patchValue = "value" in patch ? patch.value : undefined;
        console.log("Processing patch:", {
          action: patch.action,
          path: patch.path,
          value: patchValue,
          valueType: typeof patchValue,
        });
        
        // Check if this is a new op being added
        if (
          patch.path[0] === "ops" &&
          patch.path.length === 2 &&
          patch.action === "put"
        ) {
          const opId = patch.path[1] as string;
          console.log("Detected op patch, opId:", opId);
          
          // Skip if we've already applied this op
          if (this.appliedOps.has(opId)) {
            console.log("Skipping - already applied");
            continue;
          }

          const patchVal = patch.value;
          console.log("opJson value:", patchVal, "type:", typeof patchVal, "isImmutableString:", isImmutableString(patchVal));
          
          // The value should be an ImmutableString
          const opJson = isImmutableString(patchVal) ? patchVal.toString() : String(patchVal);
          const op = JSON.parse(opJson) as GeologOp;
          console.log("Parsed op:", op);
          
          // Pass the op including parents so applyOp can preserve causal structure.
          // The parents field is included in the serialized op stored in Automerge.
          // If parents are missing (e.g., from older ops), applyOp will use current
          // heads as fallback (existing behavior in WASM layer).
          this.db.applyOp(op);
          this.appliedOps.add(opId);
          console.log("Applied op successfully");
        }
      }
    });
  }

  /**
   * Add an entity of the given sort.
   * Returns the entity ID.
   */
  addEntity(sortName: string): string {
    // Capture heads before the operation - these become the op's causal parents
    const parentsBefore: string[] = this.db.getHeads();

    const op = this.db.addEntity(sortName) as GeologOp;
    op.parents = parentsBefore;
    this.appliedOps.add(op.id);

    // Store op (including parents) in Automerge doc
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
    args: Array<{ entity: string } | { int: number } | { str: string }>
  ): string {
    // Capture heads before the operation - these become the op's causal parents
    const parentsBefore: string[] = this.db.getHeads();

    const op = this.db.addRelation(relName, args) as GeologOp;
    op.parents = parentsBefore;
    this.appliedOps.add(op.id);

    // Store op (including parents) in Automerge doc
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

  /**
   * Get the theory name.
   */
  get theoryName(): string {
    return this.theory.name;
  }

  /**
   * Get the underlying database (for advanced use).
   */
  get database(): Database {
    return this.db;
  }

  /**
   * Get the document handle.
   */
  get docHandle(): DocHandle<GeologDoc> {
    return this.handle;
  }

  /**
   * Get the exported theory (signature + axioms) for UI introspection.
   */
  getExportedTheory(): ExportedTheory {
    return this.theory.export() as ExportedTheory;
  }
}
