/**
 * Projection skill — create and manage ProjectionSpecDocs.
 *
 * ProjectionSpecDoc shape:
 *   {
 *     '@patchwork': { type: 'artifact-projection' },
 *     schemaVersion: 3,
 *     sourceType: 'datalog',
 *     viewKind: 'table' | 'key-value',
 *     title: string,
 *     rows?: ProjectionRowsSpec,
 *     columns?: ProjectionSpecColumn[],
 *     entries?: ProjectionKeyValueEntrySpec[],
 *   }
 */

/**
 * Create a new ProjectionSpecDoc.
 *
 * repo.create() is SYNCHRONOUS — do NOT await this function.
 *
 * @param {string} title - Display title for the projection
 * @param {object} rowsSpec - Row configuration (entityPredicate, keyArg, etc.)
 * @param {object[]} columns - Array of column definitions
 * @returns {{ url: string }}
 */
export function createProjection(title, rowsSpec, columns) {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'artifact-projection' };
    d.schemaVersion = 3;
    d.sourceType = 'datalog';
    d.viewKind = 'table';
    d.title = title || '';
    d.rows = {
      entityPredicate: rowsSpec.entityPredicate,
      keyArg: rowsSpec.keyArg ?? 0,
      entityIdPrefix: rowsSpec.entityIdPrefix || rowsSpec.entityPredicate,
      order: rowsSpec.order || 'entity-fact-order',
      create: rowsSpec.create || { insertEntityFact: true },
      delete: rowsSpec.delete || { mode: 'managed-predicates-only' },
    };
    d.columns = columns.map((col) => {
      const column = {
        id: col.id,
        header: col.header,
        cellType: col.cellType || 'text',
        read: { ...col.read },
        cardinality: col.cardinality || 'zero-or-one',
      };
      if (col.write) column.write = { ...col.write };
      if (col.blankPolicy) column.blankPolicy = col.blankPolicy;
      if (col.readOnlyReason) column.readOnlyReason = col.readOnlyReason;
      if (col.hidden) column.hidden = col.hidden;
      return column;
    });
  });
  return { url: handle.url };
}

/**
 * Create a new key-value ProjectionSpecDoc.
 *
 * @param {string} title - Display title for the projection
 * @param {object[]} entries - Array of key-value entry definitions
 * @param {object=} viewSpec - Optional view-level settings such as expandScript
 * @returns {{ url: string }}
 */
export function createKeyValueProjection(title, entries, viewSpec = {}) {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'artifact-projection' };
    d.schemaVersion = 3;
    d.sourceType = 'datalog';
    d.viewKind = 'key-value';
    d.title = title || '';
    if (viewSpec && Object.keys(viewSpec).length > 0) {
      d.view = { ...viewSpec };
    }
    d.entries = entries.map((entry) => {
      const nextEntry = {
        id: entry.id,
        label: entry.label,
        cellType: entry.cellType || 'text',
        read: { ...entry.read },
      };
      if (entry.write) nextEntry.write = { ...entry.write };
      if (entry.blankPolicy) nextEntry.blankPolicy = entry.blankPolicy;
      if (entry.readOnlyReason) nextEntry.readOnlyReason = entry.readOnlyReason;
      return nextEntry;
    });
  });
  return { url: handle.url };
}

/**
 * Get a read/write interface for an existing ProjectionSpecDoc.
 *
 * @param {string} url - Automerge URL of the ProjectionSpecDoc
 * @returns {Promise<object>}
 */
export async function getProjection(url) {
  const handle = await repo.find(url);

  return {
    getTitle() {
      return handle.doc()?.title ?? '';
    },

    setTitle(title) {
      handle.change((d) => {
        d.title = title;
      });
    },

    getColumns() {
      return JSON.parse(JSON.stringify(handle.doc()?.columns ?? []));
    },

    getEntries() {
      return JSON.parse(JSON.stringify(handle.doc()?.entries ?? []));
    },

    addColumn(column) {
      handle.change((d) => {
        if (!d.columns) d.columns = [];
        const col = {
          id: column.id,
          header: column.header,
          cellType: column.cellType || 'text',
          read: { ...column.read },
          cardinality: column.cardinality || 'zero-or-one',
        };
        if (column.write) col.write = { ...column.write };
        if (column.blankPolicy) col.blankPolicy = column.blankPolicy;
        if (column.readOnlyReason) col.readOnlyReason = column.readOnlyReason;
        if (column.hidden) col.hidden = column.hidden;
        d.columns.push(col);
      });
    },

    addEntry(entry) {
      handle.change((d) => {
        if (!d.entries) d.entries = [];
        const nextEntry = {
          id: entry.id,
          label: entry.label,
          cellType: entry.cellType || 'text',
          read: { ...entry.read },
        };
        if (entry.write) nextEntry.write = { ...entry.write };
        if (entry.blankPolicy) nextEntry.blankPolicy = entry.blankPolicy;
        if (entry.readOnlyReason) nextEntry.readOnlyReason = entry.readOnlyReason;
        d.entries.push(nextEntry);
      });
    },

    removeColumn(id) {
      handle.change((d) => {
        if (!d.columns) return;
        const idx = d.columns.findIndex((c) => c.id === id);
        if (idx !== -1) d.columns.splice(idx, 1);
      });
    },

    removeEntry(id) {
      handle.change((d) => {
        if (!d.entries) return;
        const idx = d.entries.findIndex((entry) => entry.id === id);
        if (idx !== -1) d.entries.splice(idx, 1);
      });
    },

    updateColumn(id, updates) {
      handle.change((d) => {
        if (!d.columns) return;
        const col = d.columns.find((c) => c.id === id);
        if (!col) return;
        if (updates.header !== undefined) col.header = updates.header;
        if (updates.cellType !== undefined) col.cellType = updates.cellType;
        if (updates.cardinality !== undefined) col.cardinality = updates.cardinality;
        if (updates.blankPolicy !== undefined) col.blankPolicy = updates.blankPolicy;
        if (updates.readOnlyReason !== undefined) col.readOnlyReason = updates.readOnlyReason;
        if (updates.hidden !== undefined) col.hidden = updates.hidden;
        if (updates.read) col.read = { ...updates.read };
        if (updates.write) col.write = { ...updates.write };
      });
    },

    updateEntry(id, updates) {
      handle.change((d) => {
        if (!d.entries) return;
        const entry = d.entries.find((candidate) => candidate.id === id);
        if (!entry) return;
        if (updates.label !== undefined) entry.label = updates.label;
        if (updates.cellType !== undefined) entry.cellType = updates.cellType;
        if (updates.blankPolicy !== undefined) entry.blankPolicy = updates.blankPolicy;
        if (updates.readOnlyReason !== undefined) entry.readOnlyReason = updates.readOnlyReason;
        if (updates.read) entry.read = { ...updates.read };
        if (updates.write) entry.write = { ...updates.write };
      });
    },

    getRows() {
      const rows = handle.doc()?.rows;
      return rows ? JSON.parse(JSON.stringify(rows)) : null;
    },

    setRows(rowsSpec) {
      handle.change((d) => {
        d.viewKind = 'table';
        d.rows = {
          entityPredicate: rowsSpec.entityPredicate,
          keyArg: rowsSpec.keyArg ?? 0,
          entityIdPrefix: rowsSpec.entityIdPrefix || rowsSpec.entityPredicate,
          order: rowsSpec.order || 'entity-fact-order',
          create: rowsSpec.create || { insertEntityFact: true },
          delete: rowsSpec.delete || { mode: 'managed-predicates-only' },
        };
      });
    },

    setViewKind(viewKind) {
      handle.change((d) => {
        d.viewKind = viewKind;
      });
    },

    getViewKind() {
      return handle.doc()?.viewKind ?? 'table';
    },

    getView() {
      return JSON.parse(JSON.stringify(handle.doc()?.view ?? {}));
    },

    setView(viewSpec) {
      handle.change((d) => {
        d.view = viewSpec ? { ...viewSpec } : {};
      });
    },
  };
}

/**
 * Update a SpecDoc to link a projection doc.
 *
 * @param {string} specUrl - Automerge URL of the SpecDoc
 * @param {string} projectionUrl - Automerge URL of the ProjectionSpecDoc
 */
export async function setSpecProjection(specUrl, projectionUrl) {
  const handle = await repo.find(specUrl);
  handle.change((d) => {
    if (!d.spec) return;
    d.spec.projectionDocUrl = projectionUrl;
  });
}
