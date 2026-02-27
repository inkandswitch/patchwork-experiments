import { useState, useEffect, useCallback, useMemo } from "react";
import {
  GeologAutomerge,
  type DerivedSort,
  type SignatureInfo,
} from "./geolog-automerge";
import { entityName } from "./entity-names";

// ============================================================================
// Types
// ============================================================================

interface DatabaseState {
  entities: Record<string, string[]>;
  relations: Record<string, unknown[][]>;
}

/** A single value in a relation tuple (as returned by db.toJson()) */
type TupleValue = { entity: string } | { int: number } | { str: string };

/** Props for the top-level editor */
interface GenericEditorProps {
  geolog: GeologAutomerge;
}

/**
 * Describes one field in a relation's add-form, derived from the
 * relation's domain type.
 */
interface FieldDesc {
  name: string;
  sort: DerivedSort;
}

// ============================================================================
// Helpers
// ============================================================================

/** Build a map from sort UUID -> sort name */
function buildSortIdToName(sig: SignatureInfo): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sig.sorts) {
    map.set(s.id, s.name);
  }
  return map;
}

/** Flatten a relation's domain into a list of named fields. */
function domainFields(domain: DerivedSort): FieldDesc[] {
  if (domain.type === "product") {
    return domain.fields.map(([name, sort]) => ({ name, sort }));
  }
  // Non-product domain (unusual but possible): treat as a single unnamed field
  return [{ name: "value", sort: domain }];
}

/**
 * Format a single tuple value for display.
 * Entity references show as memorable names, ints and strings show directly.
 */
function formatValue(v: TupleValue): string {
  if ("entity" in v) return entityName(v.entity);
  if ("int" in v) return String(v.int);
  if ("str" in v) return v.str;
  return "?";
}

/**
 * Get the full UUID for a tuple value (for tooltip), or null if not an entity.
 */
function valueUuid(v: TupleValue): string | null {
  if ("entity" in v) return v.entity;
  return null;
}

// ============================================================================
// Sub-components
// ============================================================================

/** Section for a single sort: shows entity list + add button */
function SortSection({
  sortName,
  entities,
  onAdd,
}: {
  sortName: string;
  entities: string[];
  onAdd: () => void;
}) {
  return (
    <section className="generic-sort-section">
      <h3>
        {sortName} ({entities.length})
      </h3>
      <div className="entity-list">
        {entities.map((id) => (
          <span key={id} className="entity-badge" title={id}>
            {entityName(id)}
          </span>
        ))}
        {entities.length === 0 && (
          <span className="empty">No entities yet</span>
        )}
      </div>
      <button onClick={onAdd} className="add-btn">
        + Add {sortName}
      </button>
    </section>
  );
}

/** A single form field for one component of a relation's domain */
function RelationField({
  field,
  value,
  onChange,
  entities,
  sortIdToName,
}: {
  field: FieldDesc;
  value: string;
  onChange: (v: string) => void;
  entities: Record<string, string[]>;
  sortIdToName: Map<string, string>;
}) {
  const { name, sort } = field;

  if (sort.type === "base") {
    // Entity reference: dropdown of entities of this sort
    const sortName = sortIdToName.get(sort.id) ?? sort.id;
    const options = entities[sortName] ?? [];
    return (
      <label className="rel-field">
        <span className="rel-field-label">{name}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select {sortName}...</option>
          {options.map((id) => (
            <option key={id} value={id}>
              {entityName(id)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (sort.type === "int") {
    return (
      <label className="rel-field">
        <span className="rel-field-label">{name}</span>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={name}
        />
      </label>
    );
  }

  if (sort.type === "str") {
    return (
      <label className="rel-field">
        <span className="rel-field-label">{name}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={name}
        />
      </label>
    );
  }

  // Product or other complex type — shouldn't happen as a nested field
  return (
    <label className="rel-field">
      <span className="rel-field-label">{name}</span>
      <span className="empty">(unsupported type)</span>
    </label>
  );
}

/** Section for a single relation: shows tuple list + add form */
function RelationSection({
  relName,
  fields,
  tuples,
  entities,
  sortIdToName,
  onAdd,
}: {
  relName: string;
  fields: FieldDesc[];
  tuples: TupleValue[][];
  entities: Record<string, string[]>;
  sortIdToName: Map<string, string>;
  onAdd: (args: Array<{ entity: string } | { int: number } | { str: string }>) => void;
}) {
  // Form state: one string value per field
  const [formValues, setFormValues] = useState<string[]>(() =>
    fields.map((f) => (f.sort.type === "int" ? "0" : ""))
  );
  const [error, setError] = useState<string | null>(null);

  const updateField = (index: number, value: string) => {
    setFormValues((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleAdd = () => {
    setError(null);

    // Convert form values to typed args
    const args: Array<{ entity: string } | { int: number } | { str: string }> = [];
    for (let i = 0; i < fields.length; i++) {
      const { sort } = fields[i];
      const val = formValues[i];

      if (sort.type === "base") {
        if (!val) {
          setError(`Please select a value for "${fields[i].name}"`);
          return;
        }
        args.push({ entity: val });
      } else if (sort.type === "int") {
        const n = parseInt(val, 10);
        if (isNaN(n)) {
          setError(`"${fields[i].name}" must be a number`);
          return;
        }
        args.push({ int: n });
      } else if (sort.type === "str") {
        args.push({ str: val });
      }
    }

    try {
      onAdd(args);
      // Reset form
      setFormValues(fields.map((f) => (f.sort.type === "int" ? "0" : "")));
    } catch (e) {
      setError(String(e));
    }
  };

  // Check if the form can potentially be filled (i.e., enough entities exist
  // for every base-sort field)
  const canShowForm = fields.every((f) => {
    if (f.sort.type !== "base") return true;
    const sortName = sortIdToName.get(f.sort.id) ?? f.sort.id;
    return (entities[sortName] ?? []).length > 0;
  });

  return (
    <section className="generic-rel-section">
      <h3>
        {relName} ({tuples.length})
      </h3>

      {/* Tuple list */}
      <div className="tuple-list">
        {tuples.map((tuple, i) => (
          <div key={i} className="tuple-row">
            {fields.map((field, j) => {
              const val = tuple[j] as TupleValue | undefined;
              const uuid = val ? valueUuid(val) : null;
              return (
                <span key={j} className="tuple-cell">
                  <span className="tuple-field-name">{field.name}:</span>{" "}
                  <span
                    className={uuid ? "entity-badge" : "tuple-value"}
                    title={uuid ?? undefined}
                  >
                    {val ? formatValue(val) : "?"}
                  </span>
                </span>
              );
            })}
          </div>
        ))}
        {tuples.length === 0 && (
          <span className="empty">No tuples yet</span>
        )}
      </div>

      {/* Add form */}
      {error && <div className="error">{error}</div>}
      {canShowForm ? (
        <div className="add-rel-form">
          {fields.map((field, i) => (
            <RelationField
              key={field.name}
              field={field}
              value={formValues[i]}
              onChange={(v) => updateField(i, v)}
              entities={entities}
              sortIdToName={sortIdToName}
            />
          ))}
          <button onClick={handleAdd} className="add-btn">
            + Add {relName}
          </button>
        </div>
      ) : (
        <p className="hint">
          Add entities for all referenced sorts to create {relName} tuples
        </p>
      )}
    </section>
  );
}

// ============================================================================
// Main component
// ============================================================================

/**
 * Generic database editor that reads the theory signature and generates
 * UI dynamically for any schema.
 *
 * Renders a section per sort (entities + add button) and a section per
 * relation (tuples + dynamically generated add form).
 */
export function GenericEditor({ geolog }: GenericEditorProps) {
  const [state, setState] = useState<DatabaseState>({
    entities: {},
    relations: {},
  });
  const [error, setError] = useState<string | null>(null);

  const exported = useMemo(() => geolog.getExportedTheory(), [geolog]);
  const sortIdToName = useMemo(
    () => buildSortIdToName(exported.signature),
    [exported]
  );

  const refreshState = useCallback(() => {
    setState(geolog.getState());
  }, [geolog]);

  // Listen for Automerge changes to refresh
  useEffect(() => {
    refreshState();
    const handle = geolog.docHandle;
    const onChange = () => setState(geolog.getState());
    handle.on("change", onChange);
    return () => {
      handle.off("change", onChange);
    };
  }, [geolog, refreshState]);

  const addEntity = useCallback(
    (sortName: string) => {
      try {
        setError(null);
        geolog.addEntity(sortName);
        refreshState();
      } catch (e) {
        setError(String(e));
      }
    },
    [geolog, refreshState]
  );

  const addRelation = useCallback(
    (
      relName: string,
      args: Array<{ entity: string } | { int: number } | { str: string }>
    ) => {
      setError(null);
      geolog.addRelation(relName, args);
      refreshState();
    },
    [geolog, refreshState]
  );

  return (
    <div className="generic-editor">
      {error && <div className="error">{error}</div>}

      {/* Sorts */}
      {exported.signature.sorts.map((sort) => (
        <SortSection
          key={sort.id}
          sortName={sort.name}
          entities={state.entities[sort.name] ?? []}
          onAdd={() => addEntity(sort.name)}
        />
      ))}

      {/* Relations */}
      {exported.signature.relations.map((rel) => {
        const fields = domainFields(rel.domain);
        const tuples = (state.relations[rel.name] ?? []) as TupleValue[][];
        return (
          <RelationSection
            key={rel.id}
            relName={rel.name}
            fields={fields}
            tuples={tuples}
            entities={state.entities}
            sortIdToName={sortIdToName}
            onAdd={(args) => addRelation(rel.name, args)}
          />
        );
      })}
    </div>
  );
}
