/* Resolve which retained parts reach a valid bearing through directed contacts. */
(function (K) {
  const P = K.procedural || K.authoring;
  const name = value => typeof value === 'string' && value.length > 0 && value.length <= 500;

  function supportGraph(parts) {
    if (!Array.isArray(parts) || parts.length > 100000) throw Error('Support graph needs a bounded part list');
    const byId = new Map(), sources = [], records = [], dependents = [];
    let edges = 0;
    for (const raw of parts) {
      const { id, links = [], grounded = false } = raw ?? {};
      if (!name(id) || byId.has(id) || !Array.isArray(links) || typeof grounded !== 'boolean')
        throw Error('Support graph parts need unique IDs, support links and an optional bearing flag');
      edges += links.length;
      if (edges > 500000) throw Error('Support graph exceeds its contact budget');
      if (links.includes(undefined) || !links.every(name)) throw Error('Support links must be part IDs');
      const index = records.length;
      byId.set(id, index);
      records.push({ id, links:links.slice(), grounded });
      dependents.push([]);
      if (grounded) sources.push(index);
    }
    for (const [index, record] of records.entries()) {
      for (const id of record.links) {
        const bearing = byId.get(id);
        if (bearing !== undefined) dependents[bearing].push(index);
      }
    }
    for (let i = 0; i < sources.length; i++) {
      for (const index of dependents[sources[i]]) {
        const record = records[index];
        if (record.grounded) continue;
        record.grounded = true;
        sources.push(index);
      }
    }
    for (const record of records) record.state = record.grounded ? 'supported' : 'floating';
    return P.data.freeze(records);
  }

  (P.construct ||= {}).supportGraph = supportGraph;
})(KIT);
