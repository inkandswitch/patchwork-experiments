/* Store named authoring documents in separate recovery journals. */
(function (K) {
  const A = K.authoring, { freeze } = A.data;
  const format = 'ink-studio/scene-library';
  const journalFormat = 'ink-studio/journal';
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const name = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100;
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value);

  function create(storage, { key, backups = 8, prepareSnapshot } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' ||
        typeof key !== 'string' || !key.trim() || !Number.isSafeInteger(backups) || backups < 0)
      throw Error('A scene library needs storage, an index key and a valid backup count');
    if(prepareSnapshot!==undefined&&typeof prepareSnapshot!=='function')
      throw Error('Scene snapshot preparation needs a function');

    function read() {
      const raw = storage.getItem(key);
      const index = raw === null ? { format, version: 1, active: null, next: 1, slots: [] } : JSON.parse(raw);
      if (!record(index) || index.format !== format || index.version !== 1 ||
          !Number.isSafeInteger(index.next) || index.next < 1 || !Array.isArray(index.slots))
        throw Error('Invalid scene library index');
      const ids = new Set(), journals = new Set();
      for (const slot of index.slots) {
        if (!record(slot) || !id(slot.id) || !name(slot.name) || typeof slot.archived !== 'boolean' ||
            typeof slot.journal !== 'string' || !slot.journal || slot.journal === key ||
            ids.has(slot.id) || journals.has(slot.journal))
          throw Error('Invalid scene library slot');
        ids.add(slot.id);
        journals.add(slot.journal);
      }
      if (index.active !== null && !index.slots.some(slot => slot.id === index.active && !slot.archived))
        throw Error('Invalid active scene');
      return { index, raw };
    }

    function write(storageKey, before, text) {
      if (typeof storage.compareAndSet === 'function') {
        if (!storage.compareAndSet(storageKey, before, text))
          throw Error('The saved scene changed in another session');
      } else {
        if (storage.getItem(storageKey) !== before) throw Error('The saved scene changed in another session');
        storage.setItem(storageKey, text);
      }
      return text;
    }

    function requireSlot(index, slotId) {
      const slot = index.slots.find(entry => entry.id === slotId);
      if (!slot) throw Error('Unknown scene: ' + slotId);
      return slot;
    }

    function journal(slot, initial) {
      let seen = storage.getItem(slot.journal);
      let snapshot = initial, needsSave = seen === null;
      if (seen !== null) {
        const data = JSON.parse(seen);
        if (!record(data) || data.format !== journalFormat || data.version !== 1 || !Array.isArray(data.entries))
          throw Error('Invalid scene journal: ' + slot.name);
        needsSave = !data.entries.length;
        snapshot = data.entries.at(-1)?.snapshot ?? initial;
      }
      if (snapshot === undefined) throw Error('The scene journal is missing: ' + slot.name);
      const doc = A.document(snapshot,{prepareSnapshot}).autosave({
        getItem: () => seen,
        setItem(_, value) {
          seen = write(slot.journal, seen, value);
        }
      }, slot.journal, { backups });
      if (needsSave) {
        if (!doc.flush()) throw doc.storageError;
      }
      return doc;
    }

    function createScene(label, snapshot) {
      if (!name(label) || snapshot === undefined) throw Error('A new scene needs a name and a document');
      const { index, raw } = read();
      let slot;
      do {
        if (index.next >= Number.MAX_SAFE_INTEGER) throw Error('Scene IDs are exhausted');
        const slotId = 'scene-' + index.next++;
        slot = { id: slotId, name: label.trim(), archived: false, journal: key + '/' + slotId };
      } while (index.slots.some(entry => entry.id === slot.id || entry.journal === slot.journal) ||
        storage.getItem(slot.journal) !== null);
      const doc = journal(slot, snapshot);
      const created = storage.getItem(slot.journal);
      index.slots.push(slot);
      index.active = slot.id;
      try {
        write(key, raw, JSON.stringify(index));
      } catch (error) {
        // A newly reserved journal is disposable until a catalog references it.
        try {
          if (typeof storage.removeItem === 'function' && storage.getItem(slot.journal) === created &&
              !read().index.slots.some(entry => entry.journal === slot.journal))
            storage.removeItem(slot.journal);
        } catch (_) { /* Preserve the original catalog error. */ }
        throw error;
      }
      return { slot: freeze(slot), doc };
    }

    function adopt({ id: slotId, name: label, journal: journalKey, initial }) {
      const { index, raw } = read();
      if (!id(slotId) || !name(label) || typeof journalKey !== 'string' || !journalKey ||
          journalKey === key || index.slots.some(slot => slot.id === slotId || slot.journal === journalKey))
        throw Error('Invalid or existing scene to adopt');
      const slot = { id: slotId, name: label.trim(), archived: false, journal: journalKey };
      const doc = journal(slot, initial);
      index.slots.push(slot);
      index.active ??= slotId;
      write(key, raw, JSON.stringify(index));
      return { slot: freeze(slot), doc };
    }

    function open(slotId) {
      const { index, raw } = read();
      const slot = requireSlot(index, slotId);
      if (slot.archived) throw Error('Restore this scene from the archive first');
      const doc = journal(slot);
      if (index.active !== slotId) {
        index.active = slotId;
        write(key, raw, JSON.stringify(index));
      }
      return { slot: freeze(slot), doc };
    }

    function edit(slotId, patch) {
      const { index, raw } = read();
      const slot = requireSlot(index, slotId);
      if (patch.archived && index.active === slotId) throw Error('Open another scene before archiving this one');
      Object.assign(slot, patch);
      write(key, raw, JSON.stringify(index));
      return freeze(slot);
    }

    return Object.freeze({
      state() {
        const { active, slots } = read().index;
        return freeze({ active, slots });
      },
      create: createScene,
      adopt,
      open,
      rename(slotId, label) {
        if (!name(label)) throw Error('Enter a scene name of up to 100 characters');
        return edit(slotId, { name: label.trim() });
      },
      archive: slotId => edit(slotId, { archived: true }),
      unarchive: slotId => edit(slotId, { archived: false })
    });
  }
  A.sceneLibrary = Object.freeze({ create });
})(KIT);
