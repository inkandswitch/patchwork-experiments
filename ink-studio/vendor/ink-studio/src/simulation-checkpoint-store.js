const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const format = 'ink-studio/checkpoint-ref';
const checkpoint = 'ink-studio/checkpoint', run = 'ink-studio/run';
const kinds = new Set([checkpoint, run, 'ink-studio/raster-checkpoint']);
const pageSize = 1024, tableThreshold = 128, bucketCount = 32;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const safeKey = key => typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key);
const plain = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function check(condition, message) {
  if (!condition) throw Error(message);
}
function bucket(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) % bucketCount;
}

function openCheckpointStore(directory) {
  check(typeof directory === 'string' && directory.length > 0, 'Expected a checkpoint store directory');
  const root = path.resolve(directory);
  const location = hash => path.join(root, hash.slice(0, 2), hash.slice(2));

  function save(document) {
    check(plain(document) && kinds.has(document.format) && document.version === 1,
      'Expected a version 1 checkpoint or recording');
    const blocks = new Set(), objects = new WeakMap(), visiting = new WeakSet();
    const stats = { writtenBlocks: 0, writtenBytes: 0, reusedBlocks: 0, reusedBytes: 0 };
    function put(bytes) {
      const hash = digest(bytes);
      if (blocks.has(hash)) return hash;
      blocks.add(hash);
      const file = location(hash);
      let written = false;
      if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = file + '.' + randomUUID() + '.tmp';
        try {
          fs.writeFileSync(temporary, bytes, { flag: 'wx' });
          try {
            fs.linkSync(temporary, file);
            written = true;
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
        } finally {
          fs.rmSync(temporary, { force: true });
        }
      }
      if (written) {
        stats.writtenBlocks++;
        stats.writtenBytes += bytes.length;
      } else {
        stats.reusedBlocks++;
        stats.reusedBytes += bytes.length;
      }
      return hash;
    }
    function numbers(values) {
      const pages = [];
      for (let offset = 0; offset < values.length; offset += pageSize) {
        const bytes = Buffer.allocUnsafe(Math.min(pageSize, values.length - offset) * 8);
        for (let i = 0; i < bytes.length / 8; i++) {
          check(Number.isFinite(values[offset + i]), 'Invalid numeric checkpoint page');
          bytes.writeDoubleLE(values[offset + i], i * 8);
        }
        pages.push(put(bytes));
      }
      return ['numbers', values.length, pages];
    }
    function encode(value, depth) {
      check(depth <= 256, 'Checkpoint data exceeds its nesting budget');
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (Number.isFinite(value)) return Object.is(value, -0) ? ['negative-zero'] : value;
      check(Array.isArray(value) || plain(value), 'Checkpoint data must be finite JSON data');
      if (objects.has(value)) return objects.get(value);
      check(!visiting.has(value), 'Checkpoint data cannot contain cycles');
      visiting.add(value);
      let node;
      if (Array.isArray(value)) {
        node = value.length >= pageSize && value.every(Number.isFinite) ? numbers(value) :
          ['array', Array.from(value, item => encode(item, depth + 1))];
      } else {
        const keys = Object.keys(value), entries = keys.map(key => {
          check(safeKey(key), 'Unsafe checkpoint key ' + key);
          return [key, encode(value[key], depth + 1)];
        });
        if (keys.length >= tableThreshold && keys.every(key => plain(value[key]))) {
          const pages = Array.from({ length: bucketCount }, () => []);
          entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
          for (const entry of entries) pages[bucket(entry[0])].push(entry);
          node = ['table', put(json(keys)), pages.map(page => page.length ? put(json(page)) : null)];
        } else node = ['record', entries];
      }
      visiting.delete(value);
      objects.set(value, node);
      return node;
    }
    const node = encode(document, 0);
    if (document.format === run) {
      check(['origin', 'end'].every(key => plain(document[key]) &&
        document[key].format === checkpoint && document[key].version === 1), 'Invalid recording checkpoints');
      for (const entry of node[1]) {
        if (entry[0] === 'origin' || entry[0] === 'end') entry[1] = ['checkpoint', put(json(entry[1]))];
      }
    }
    const hash = put(json(node));
    return { reference: { format, version: 1, kind: document.format, root: hash }, ...stats };
  }

  function load(reference) {
    check(plain(reference) && reference.format === format && reference.version === 1 &&
      kinds.has(reference.kind) && validHash(reference.root), 'Invalid checkpoint block reference');
    const blocks = new Map(), structures = new Map(), rowPages = new Map();
    function bytes(hash) {
      check(validHash(hash), 'Invalid checkpoint block ID');
      if (!blocks.has(hash)) {
        let value;
        try {
          value = fs.readFileSync(location(hash));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          throw Error('Missing checkpoint block ' + hash, { cause: error });
        }
        check(digest(value) === hash, 'Corrupt checkpoint block ' + hash);
        blocks.set(hash, value);
      }
      return blocks.get(hash);
    }
    function readJSON(hash) {
      try {
        return JSON.parse(bytes(hash).toString('utf8'));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw Error('Invalid JSON in checkpoint block ' + hash, { cause: error });
      }
    }
    function entries(rows, depth) {
      check(Array.isArray(rows), 'Invalid checkpoint record');
      const values = new Map();
      for (const row of rows) {
        check(Array.isArray(row) && row.length === 2 && safeKey(row[0]) && !values.has(row[0]),
          'Invalid or duplicate checkpoint record key');
        values.set(row[0], decode(row[1], depth + 1));
      }
      return values;
    }
    function numbers(length, pages) {
      check(Number.isSafeInteger(length) && length >= pageSize && length <= 0xffffffff &&
        Array.isArray(pages) && pages.length === Math.ceil(length / pageSize), 'Invalid numeric checkpoint layout');
      const values = [];
      for (const hash of pages) {
        const page = bytes(hash);
        check(page.length === Math.min(pageSize, length - values.length) * 8, 'Invalid numeric checkpoint page size');
        for (let i = 0; i < page.length; i += 8) {
          const value = page.readDoubleLE(i);
          check(Number.isFinite(value), 'Invalid number in checkpoint page');
          values.push(value);
        }
      }
      return values;
    }
    function table(orderHash, pages, depth) {
      const order = readJSON(orderHash);
      check(Array.isArray(order) && order.length >= tableThreshold && new Set(order).size === order.length &&
        Array.isArray(pages) && pages.length === bucketCount, 'Invalid checkpoint table layout');
      const rows = new Map();
      for (const [i, page] of pages.entries()) if (page !== null) {
        if (!rowPages.has(page)) rowPages.set(page, entries(readJSON(page), depth));
        for (const [key, row] of rowPages.get(page)) {
          check(bucket(key) === i && plain(row), 'Invalid checkpoint table row');
          rows.set(key, row);
        }
      }
      check(rows.size === order.length && order.every(key => rows.has(key)), 'Invalid checkpoint table order');
      return Object.fromEntries(order.map(key => [key, rows.get(key)]));
    }
    function shared(node, rebuild) {
      const key = JSON.stringify(node);
      if (!structures.has(key)) structures.set(key, Object.freeze(rebuild()));
      return structures.get(key);
    }
    function decode(node, depth) {
      check(depth <= 256, 'Checkpoint data exceeds its nesting budget');
      if (node === null || typeof node === 'string' || typeof node === 'boolean' || Number.isFinite(node)) return node;
      check(Array.isArray(node), 'Invalid checkpoint block node');
      switch (node[0]) {
        case 'negative-zero': if (node.length === 1) return -0; break;
        case 'array':
          if (node.length === 2 && Array.isArray(node[1]))
            return Object.freeze(node[1].map(item => decode(item, depth + 1)));
          break;
        case 'record':
          if (node.length === 2) return Object.freeze(Object.fromEntries(entries(node[1], depth)));
          break;
        case 'numbers':
          if (node.length === 3) return shared(node, () => numbers(node[1], node[2]));
          break;
        case 'table':
          if (node.length === 3) return shared(node, () => table(node[1], node[2], depth));
          break;
        case 'checkpoint':
          if (node.length === 2) return shared(node, () => {
            const snapshot = decode(readJSON(node[1]), depth + 1);
            check(plain(snapshot) && snapshot.format === checkpoint && snapshot.version === 1,
              'Invalid recording checkpoint block');
            return snapshot;
          });
          break;
      }
      throw Error('Invalid checkpoint block node');
    }
    const document = decode(readJSON(reference.root), 0);
    check(plain(document) && document.format === reference.kind && document.version === 1,
      'Checkpoint reference does not match its document');
    return document;
  }
  return Object.freeze({ directory: root, save, load });
}

module.exports = { format, openCheckpointStore };
