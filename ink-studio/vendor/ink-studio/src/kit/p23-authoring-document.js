/* Retained authoring intent. Independent of the sculpt/bake and of browser input.
   K.authoring.document(spec?, {historyLimit?}) -> a transactional document.
   create(type, {id?, parameters?, anchor?, parent?, styleRef?, seed?, ...}) -> id
   update(id, patch), remove(id), setStyle(id, style), setEnvironment(patch)
   begin(label), preview(), commit(), cancel(), transact(label, fn), undo(), redo()
   derive(owner, rule, [{key, type, parameters, ...}]), promote(id), suppress(id)
   get(id), entities(), snapshot(), serialize(), restore(snapshot), onChange(fn)
   beforeCommit(fn) runs within the transaction, so derived results share its history.
   autosave(storage, key, {backups?}), flush(), backups(), recover(indexOrSaveId)
   Entity getters and snapshots return shared frozen values; mutations invalidate
   the current view without changing any value already returned to a caller.
   JSON is the durable format. Splat buffers and compiled distance fields are caches. */
(function (K) {
  const A = K.authoring || (K.authoring = {});
  const FORMAT = 'ink-studio/authoring';
  const VERSION = 1;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const { clone: json, freeze, merge, hash, isImmutable } = K.procedural.data;
  const documentSnapshots = new WeakSet(),
    validatedViews = new WeakSet();
  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  function sameEntries(a, b, equals = same) {
    if (a === b) return true;
    const keys = Object.keys(a),
      other = Object.keys(b);
    if (keys.length !== other.length) return false;
    // Match the serialized key order as well as values.
    return keys.every((key, i) => key === other[i] && equals(a[key], b[key], key));
  }
  const sameDocument = (a, b) =>
    sameEntries(a, b, (left, right, key) =>
      key === 'entities' || key === 'styles' ? sameEntries(left, right) : same(left, right)
    );
  // The editable maps and counter are private. All nested records are replaced on write.
  const checkpoint = state => ({ ...state, entities: { ...state.entities }, styles: { ...state.styles } });
  const slot = (rule, key) => JSON.stringify([rule, key]);
  const derivedId = (owner, rule, key) => '@/' + [owner, rule, key].map(encodeURIComponent).join('/');
  const idOK = id => typeof id === 'string' && id.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(id);
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  function validate(spec) {
    if (!spec || spec.format !== FORMAT) throw new Error('Not an ink-studio authoring document');
    if (spec.version !== VERSION) throw new Error('Unsupported authoring document version: ' + spec.version);
    if (!idOK(spec.id) || !Number.isInteger(spec.seed) || !Number.isSafeInteger(spec.nextId) || spec.nextId < 1)
      throw new Error('Invalid document identity, seed or nextId');
    if (!record(spec.entities) || !record(spec.styles) || !record(spec.environment))
      throw new Error('Document maps are required');
    for (const [id, style] of Object.entries(spec.styles))
      if (!idOK(id) || !record(style)) throw new Error('Invalid style: ' + id);
    for (const [id, e] of Object.entries(spec.entities)) {
      if (!idOK(id) || e.id !== id || !idOK(e.type) || !Number.isInteger(e.seed))
        throw new Error('Invalid entity: ' + id);
      if (!record(e.parameters) || !record(e.overrides))
        throw new Error('Entity parameters and overrides must be objects: ' + id);
      if (e.parent !== null && (!idOK(e.parent) || !own(spec.entities, e.parent) || e.parent === id))
        throw new Error('Missing or self parent: ' + id);
      if (e.styleRef !== null && (!idOK(e.styleRef) || !own(spec.styles, e.styleRef)))
        throw new Error('Missing style ' + e.styleRef + ' on ' + id);
      if (e.anchor !== null) {
        if (!e.anchor || !own(spec.entities, e.anchor.host) || e.anchor.host === id)
          throw new Error('Missing or self anchor host: ' + id);
        if (!idOK(e.anchor.surface)) throw new Error('Anchor needs a named surface: ' + id);
        if (!Array.isArray(e.anchor.uv) || e.anchor.uv.length !== 2 || !e.anchor.uv.every(Number.isFinite))
          throw new Error('Anchor needs finite uv: ' + id);
      }
      if (e.derived) {
        if (
          !own(spec.entities, e.derived.owner) ||
          e.derived.owner === id ||
          !idOK(e.derived.rule) ||
          !idOK(e.derived.key)
        )
          throw new Error('Invalid generated ownership: ' + id);
        if (id !== derivedId(e.derived.owner, e.derived.rule, e.derived.key))
          throw new Error('Unstable generated identity: ' + id);
      }
    }
    const visiting = new Set(),
      done = new Set();
    function visit(id) {
      if (visiting.has(id)) throw new Error('Cyclic parent, anchor or ownership at ' + id);
      if (done.has(id)) return;
      visiting.add(id);
      const e = spec.entities[id];
      for (const next of new Set([e.parent, e.anchor && e.anchor.host, e.derived && e.derived.owner]))
        if (next) visit(next);
      visiting.delete(id);
      done.add(id);
    }
    for (const id of Object.keys(spec.entities)) visit(id);
    return spec;
  }
  function read(spec) {
    const value = json(typeof spec === 'string' ? JSON.parse(spec) : spec);
    return validate(value);
  }
  function documentView(spec) {
    if (documentSnapshots.has(spec)) {
      if (!validatedViews.has(spec)) {
        validate(spec);
        validatedViews.add(spec);
      }
      return spec;
    }
    const value = freeze(read(spec));
    documentSnapshots.add(value);
    validatedViews.add(value);
    return value;
  }
  // Preserve unchanged records while validating a patch received from another process.
  function patchDocumentView(source, { metadata = {}, upserts = {}, removed = [] } = {}) {
    if (!record(metadata) || !record(upserts) || own(metadata, 'entities') ||
        !Array.isArray(removed) || !removed.every(idOK))
      throw new Error('Invalid document view patch');
    const before = documentView(source);
    const entities = { ...before.entities, ...json(upserts) };
    for (const id of removed) delete entities[id];
    const next = freeze(validate({ ...before, ...json(metadata), entities }));
    documentSnapshots.add(next);
    validatedViews.add(next);
    return next;
  }

  function buildRecord(type, fields, id, seed) {
    if (!idOK(type)) throw new Error('Entity type must be a non-empty string');
    const out = Object.assign(
      { id, type, seed: hash(id, seed), parent: null, styleRef: null, anchor: null, parameters: {}, overrides: {} },
      json(fields || {})
    );
    out.id = id;
    out.type = type;
    return out;
  }
  function doomedEntities(entities, ids) {
    const doomed = new Set(ids);
    let added = true;
    while (added) {
      added = false;
      for (const e of Object.values(entities))
        if (
          !doomed.has(e.id) &&
          (doomed.has(e.parent) ||
            (e.anchor && doomed.has(e.anchor.host)) ||
            (e.derived && doomed.has(e.derived.owner)))
        ) {
          doomed.add(e.id);
          added = true;
        }
    }
    return doomed;
  }
  function deriveRecords(state, ownerId, rule, specs, replace, erase) {
    const owner = own(state.entities, ownerId) ? state.entities[ownerId] : null,
      seen = new Set(),
      wanted = new Set(),
      result = [];
    if (!owner) throw new Error('Unknown entity: ' + ownerId);
    if (!idOK(rule) || !Array.isArray(specs))
      throw new Error('A generation rule needs a name and child specifications');
    for (const raw of specs) {
      const s = json(raw),
        key = s.key;
      if (!idOK(key) || seen.has(key)) throw new Error('Missing or duplicate generated key: ' + key);
      seen.add(key);
      const id = derivedId(ownerId, rule, key);
      if (owner.overrides.suppressed && owner.overrides.suppressed[slot(rule, key)]) continue;
      const old = state.entities[id];
      if (old && !old.derived) continue;
      const fields = Object.assign({ parent: ownerId, styleRef: owner.styleRef }, s, {
        derived: { owner: ownerId, rule, key }
      });
      delete fields.key;
      let next = buildRecord(s.type, fields, id, state.seed);
      if (old) {
        next = merge(next, old.overrides);
        next.overrides = json(old.overrides);
        next.seed = old.seed;
      }
      replace(id, next);
      wanted.add(id);
      result.push(id);
    }
    erase(
      Object.values(state.entities)
        .filter(e => e.derived && e.derived.owner === ownerId && e.derived.rule === rule && !wanted.has(e.id))
        .map(e => e.id)
    );
    return result;
  }
  // Pure procedural projections retain unchanged frozen records. They share the
  // exact derivation/promotion/suppression rules used by document transactions.
  A.projectDerived = (source, jobs) => {
    const before = documentView(source);
    if (!Array.isArray(jobs) || jobs.length > 256) throw new Error('Derived projections need at most 256 jobs');
    let changed = false;
    const state = Object.assign({}, before, { entities: Object.assign({}, before.entities) }),
      replace = (id, next) => {
        if (!same(state.entities[id], next)) {
          state.entities[id] = freeze(next);
          changed = true;
        }
      },
      erase = ids => {
        for (const id of doomedEntities(state.entities, ids))
          if (own(state.entities, id)) {
            delete state.entities[id];
            changed = true;
          }
      };
    for (const job of jobs) {
      if (!job || !idOK(job.owner)) throw new Error('Derived projections need valid owners');
      deriveRecords(state, job.owner, job.rule, job.specs, replace, erase);
    }
    if (!changed) return before;
    validate(state);
    const out = freeze(state);
    documentSnapshots.add(out);
    validatedViews.add(out);
    return out;
  };
  function diff(before, after) {
    const changed = [];
    for (const id of new Set([...Object.keys(before.entities), ...Object.keys(after.entities)]))
      if (!same(before.entities[id], after.entities[id])) changed.push(id);
    return changed.sort();
  }
  A.data = {
    clone: json,
    freeze,
    isImmutable,
    documentView,
    patchDocumentView,
    isDocumentView: value => documentSnapshots.has(value),
    merge,
    hash,
    derivedId,
    validate: read,
    format: FORMAT,
    version: VERSION
  };
  A.document = (initial, options) => {
    options = options || {};
    const {prepareSnapshot}=options;
    if(prepareSnapshot!==undefined&&typeof prepareSnapshot!=='function')
      throw Error('Document snapshot preparation needs a function');
    const loadSnapshot=prepareSnapshot===undefined?read:input=>
      checkpoint(documentView(prepareSnapshot(documentView(input))));
    let state = initial
      ? loadSnapshot(initial)
      : {
          format: FORMAT,
          version: VERSION,
          id: 'world',
          seed: 1,
          nextId: 1,
          entities: {},
          styles: {},
          environment: {}
        };
    let transaction = null,
      revision = 0,
      resolving = false,
      binding = null,
      journal = [];
    // Internal values are private and replaced when edited. Share their immutable
    // read copies across snapshots so repeated picking/material reads reuse the
    // same compiled fields instead of cloning an entire scene on every read.
    let view = null,
      styleView = null;
    const copies = new WeakMap(),
      journalText = new WeakMap();
    function immutable(value) {
      if (!value || typeof value !== 'object') return value;
      if (!copies.has(value)) copies.set(value, freeze(json(value)));
      return copies.get(value);
    }
    function invalidate() {
      view = null;
    }
    function invalidateStyles() {
      styleView = null;
      invalidate();
    }
    function replace(id, next) {
      if (same(state.entities[id], next)) return;
      state.entities[id] = next;
      invalidate();
    }
    const past = [],
      future = [],
      listeners = new Set(),
      previewListeners = new Set(),
      hooks = new Set();
    const limit = options.historyLimit === undefined ? 100 : options.historyLimit;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('historyLimit must be a non-negative integer');
    const doc = { listenerErrors: [], storageError: null };
    function notify(set, event) {
      for (const fn of [...set]) {
        try {
          fn(freeze(json(event)));
        } catch (err) {
          doc.listenerErrors.push(err);
        }
      }
    }
    function event(type, before, label) {
      return {
        type,
        label,
        revision,
        changed: diff(before, state),
        stylesChanged: !sameEntries(before.styles, state.styles),
        environmentChanged: !same(before.environment, state.environment)
      };
    }
    function save(label) {
      if (!binding) return;
      try {
        if (journal.length && sameDocument(journal[journal.length - 1].snapshot, state)) {
          doc.storageError = null;
          return;
        }
        const serial = journal.length ? journal[journal.length - 1].serial + 1 : 1;
        const item = { id: 'save-' + serial, serial, label, revision, snapshot: checkpoint(state) };
        const next = journal.concat([item]).slice(-binding.backups - 1);
        const entries = next.map(entry => {
          // String labels keep the entire saved entry stable across writes.
          if (typeof entry.label !== 'string') return JSON.stringify(entry);
          if (!journalText.has(entry)) journalText.set(entry, JSON.stringify(entry));
          return journalText.get(entry);
        });
        binding.storage.setItem(
          binding.key,
          '{"format":"ink-studio/journal","version":1,"entries":[' + entries.join(',') + ']}'
        );
        journal = next;
        doc.storageError = null;
      } catch (err) {
        doc.storageError = err;
      }
    }
    function resolve() {
      if (resolving) throw new Error('Recursive document resolution');
      resolving = true;
      try {
        for (const fn of [...hooks]) fn(doc, event('resolve', transaction.before, transaction.label));
      } finally {
        resolving = false;
      }
    }
    function finishScheduled() {
      if (transaction?.scheduled && !resolving) doc.commit();
    }
    function mutate(label, fn) {
      finishScheduled();
      if (transaction) return fn();
      return doc.transact(label, fn);
    }
    function entity(id) {
      if (!own(state.entities, id)) throw new Error('Unknown entity: ' + id);
      return state.entities[id];
    }
    function buildEntity(type, fields, id) {
      return buildRecord(type, fields, id, state.seed);
    }
    function erase(ids) {
      const doomed = doomedEntities(state.entities, ids);
      for (const id of doomed)
        if (own(state.entities, id)) {
          delete state.entities[id];
          invalidate();
        }
      return [...doomed];
    }
    doc.get = id => (own(state.entities, id) ? immutable(state.entities[id]) : null);
    doc.entities = type =>
      Object.freeze(
        Object.values(state.entities)
          .filter(e => !type || e.type === type)
          .map(immutable)
      );
    doc.snapshot = () => {
      if (!view) {
        const out = {};
        if (!styleView)
          styleView = Object.freeze(
            Object.fromEntries(Object.entries(state.styles).map(([id, item]) => [id, immutable(item)]))
          );
        for (const [key, value] of Object.entries(state)) {
          if (key === 'styles') out[key] = styleView;
          else if (key === 'entities')
            out[key] = Object.freeze(
              Object.fromEntries(Object.entries(value).map(([id, item]) => [id, immutable(item)]))
            );
          else out[key] = immutable(value);
        }
        view = Object.freeze(out);
        documentSnapshots.add(view);
      }
      return view;
    };
    doc.serialize = space => JSON.stringify(state, null, space);
    doc.seed = () => state.seed;
    doc.revision = () => revision;
    doc.pending = () => !!transaction;
    doc.history = () => freeze({ undo: past.map(e => e.label), redo: future.map(e => e.label) });
    doc.onChange = fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    };
    doc.onPreview = fn => {
      previewListeners.add(fn);
      return () => previewListeners.delete(fn);
    };
    doc.beforeCommit = fn => {
      hooks.add(fn);
      return () => hooks.delete(fn);
    };
    doc.begin = label => {
      finishScheduled();
      if (transaction) throw new Error('A document transaction is already active');
      transaction = { label: label || 'Edit', before: checkpoint(state) };
      return doc;
    };
    doc.preview = () => {
      if (!transaction || transaction.scheduled) throw new Error('No active transaction');
      try {
        resolve();
        validate(state);
      } catch (err) {
        const before = state,
          tx = transaction;
        transaction = null;
        state = tx.before;
        invalidateStyles();
        notify(previewListeners, event('cancel', before, tx.label));
        throw err;
      }
      notify(previewListeners, event('preview', transaction.before, transaction.label));
      return doc.snapshot();
    };
    function recordCommit(tx) {
      transaction = null;
      if (sameDocument(tx.before, state)) return false;
      if (limit) {
        past.push({ label: tx.label, before: tx.before, after: checkpoint(state) });
        if (past.length > limit) past.shift();
      }
      future.length = 0;
      revision++;
      save(tx.label);
      notify(listeners, event('commit', tx.before, tx.label));
      return true;
    }
    doc.commit = () => {
      if (!transaction) throw new Error('No active transaction');
      const tx = transaction;
      try {
        resolve();
        validate(state);
      } catch (err) {
        state = tx.before;
        invalidateStyles();
        transaction = null;
        throw err;
      }
      return recordCommit(tx);
    };
    // The caller supplies the same resolution hooks in its background worker.
    // Ignore any reply after that transaction has already settled locally.
    doc.scheduleCommit = async resolver => {
      if(!transaction||transaction.scheduled||resolving||typeof resolver!=='function')
        throw new Error('A scheduled commit needs one active transaction and a resolver');
      const tx=transaction,draft=doc.snapshot();
      tx.scheduled=true;
      const registered=[...hooks];
      try{
        const result=await resolver(draft);
        if(transaction!==tx)return false;
        if(registered.length!==hooks.size||registered.some(fn=>!hooks.has(fn)))
          throw new Error('Resolution hooks changed after scheduling');
        const next=read(result);
        if(next.id!==draft.id||next.seed!==draft.seed)
          throw new Error('Resolved draft belongs to a different document');
        for(const [id,entity] of Object.entries(next.entities))
          if(same(state.entities[id],entity))next.entities[id]=state.entities[id];
        if(sameEntries(state.styles,next.styles))next.styles=state.styles;
        if(same(state.environment,next.environment))next.environment=state.environment;
        state=next;invalidateStyles();
        return recordCommit(tx);
      }catch(error){
        if(transaction!==tx)return false;
        // The synchronous resolver is authoritative if the background job
        // could not finish, including unavailable workers and stale rules.
        tx.scheduled=false;
        return doc.commit();
      }
    };
    doc.cancel = () => {
      if (!transaction) return false;
      const before = state,
        label = transaction.label;
      state = transaction.before;
      invalidateStyles();
      transaction = null;
      notify(previewListeners, event('cancel', before, label));
      return true;
    };
    doc.transact = (label, fn) => {
      if (typeof fn !== 'function') throw new Error('A transaction needs a function');
      if (Object.prototype.toString.call(fn) === '[object AsyncFunction]')
        throw new Error('Transactions must be synchronous');
      doc.begin(label);
      try {
        const result = fn(doc);
        if (result && typeof result.then === 'function') throw new Error('Transactions must be synchronous');
        doc.commit();
        return result;
      } catch (err) {
        doc.cancel();
        throw err;
      }
    };
    function travel(from, to, key, type) {
      finishScheduled();
      if (transaction) throw new Error('Finish the active transaction before ' + type);
      if (!from.length) return false;
      const entry = from.pop(),
        before = state;
      state = checkpoint(entry[key]);
      invalidateStyles();
      to.push(entry);
      revision++;
      save(entry.label);
      notify(listeners, event(type, before, entry.label));
      return true;
    }
    doc.undo = () => travel(past, future, 'before', 'undo');
    doc.redo = () => travel(future, past, 'after', 'redo');
    doc.create = (type, fields) =>
      mutate('Create ' + type, () => {
        const data = json(fields || {});
        let id = data.id;
        if (id === undefined) {
          invalidate();
          do {
            id = type + '-' + state.nextId++;
          } while (own(state.entities, id));
        }
        if (!idOK(id) || own(state.entities, id)) throw new Error('Duplicate or invalid entity id: ' + id);
        if (data.derived) throw new Error('Use derive() for generated entities');
        replace(id, buildEntity(type, data, id));
        return id;
      });
    doc.update = (id, patch) =>
      mutate('Edit ' + id, () => {
        const e = entity(id),
          p = json(patch);
        for (const key of ['id', 'type', 'seed', 'derived'])
          if (own(p, key)) throw new Error('Cannot update identity field: ' + key);
        const next = merge(e, p);
        if (e.derived) {
          const overrides = json(p);
          delete overrides.overrides;
          next.overrides = merge(merge(e.overrides, p.overrides || {}), overrides);
        }
        replace(id, next);
        return id;
      });
    doc.remove = id =>
      mutate('Remove ' + id, () => {
        const e = entity(id);
        if (e.derived) {
          const owner = entity(e.derived.owner);
          replace(
            owner.id,
            merge(owner, { overrides: { suppressed: { [slot(e.derived.rule, e.derived.key)]: true } } })
          );
        }
        return erase([id]);
      });
    doc.setStyle = (id, style) =>
      mutate('Set style ' + id, () => {
        if (!idOK(id)) throw new Error('Invalid style id');
        const next = json(style);
        if (!same(state.styles[id], next)) {
          state.styles[id] = next;
          invalidateStyles();
        }
        return id;
      });
    doc.removeStyle = id =>
      mutate('Remove style ' + id, () => {
        if (own(state.styles, id)) {
          delete state.styles[id];
          invalidateStyles();
        }
      });
    doc.setEnvironment = patch =>
      mutate('Edit environment', () => {
        const next = merge(state.environment, json(patch));
        if (!same(state.environment, next)) {
          state.environment = next;
          invalidate();
        }
      });
    doc.derive = (ownerId, rule, specs) =>
      mutate('Generate ' + rule, () => deriveRecords(state, ownerId, rule, specs, replace, erase));
    doc.promote = (id, patch) =>
      mutate('Promote generated detail', () => {
        const e = json(entity(id));
        if (!e.derived) return id;
        const d = e.derived,
          owner = entity(d.owner);
        replace(owner.id, merge(owner, { overrides: { suppressed: { [slot(d.rule, d.key)]: true } } }));
        delete e.derived;
        e.overrides = {};
        replace(id, e);
        if (patch) doc.update(id, patch);
        return id;
      });
    doc.suppress = doc.remove;
    doc.allow = (ownerId, rule, key) =>
      mutate('Restore generated slot', () => {
        const owner = entity(ownerId),
          id = derivedId(ownerId, rule, key);
        if (state.entities[id] && !state.entities[id].derived)
          throw new Error('The slot is occupied by promoted detail');
        if (owner.overrides.suppressed && own(owner.overrides.suppressed, slot(rule, key))) {
          const next = json(owner);
          delete next.overrides.suppressed[slot(rule, key)];
          replace(ownerId, next);
        }
      });
    doc.restore = snapshot =>
      mutate('Restore document', () => {
        state = loadSnapshot(snapshot);
        invalidateStyles();
      });
    doc.autosave = (storage, key, settings) => {
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || !idOK(key))
        throw new Error('Autosave needs storage.getItem/setItem and a key');
      const backups = settings && settings.backups !== undefined ? settings.backups : 8;
      if (!Number.isSafeInteger(backups) || backups < 0) throw new Error('backups must be a non-negative integer');
      const raw = storage.getItem(key);
      let entries = [];
      if (raw) {
        const saved = json(JSON.parse(raw));
        if (saved.format !== 'ink-studio/journal' || saved.version !== 1 || !Array.isArray(saved.entries))
          throw new Error('Invalid autosave journal');
        let last = 0;
        entries = saved.entries.map(entry => {
          read(entry.snapshot);
          if (!Number.isSafeInteger(entry.serial) || entry.serial <= last || entry.id !== 'save-' + entry.serial)
            throw new Error('Invalid autosave entry identity');
          last = entry.serial;
          return entry;
        });
      }
      binding = { storage, key, backups };
      journal = entries.slice(-backups - 1);
      return doc;
    };
    doc.flush = () => {
      finishScheduled();
      save('Save');
      return !doc.storageError;
    };
    doc.backups = () =>
      freeze(journal.map(entry => (typeof entry.label === 'string' ? immutable(entry) : json(entry))));
    doc.recover = index => {
      if (typeof index === 'string') index = journal.findIndex(entry => entry.id === index);
      if (!journal[index]) throw new Error('Unknown backup: ' + index);
      return doc.restore(journal[index].snapshot);
    };
    doc.detachStorage = () => {
      binding = null;
      journal = [];
    };
    return doc;
  };
})(KIT);
