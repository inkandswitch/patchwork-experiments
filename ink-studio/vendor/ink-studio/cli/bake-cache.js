const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const { createHash, randomUUID } = require('node:crypto');

const maxEntryBytes = 64 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest();

function open(directory, studio, api) {
  const version = createHash('sha256').update(process.versions.v8);
  version.update(fs.readFileSync(__filename));
  for (const file of studio.files()) version.update(fs.readFileSync(file));
  const namespace = path.join(directory, 'ink-bake-' + version.digest('hex').slice(0, 24));
  const filename = (kind, key) => path.join(namespace, hash(kind + '\n' + key).toString('hex') + '.bin');
  return api.create({ storage: {
    read(kind, key) {
      const file = filename(kind, key);
      try {
        if (fs.statSync(file).size > maxEntryBytes) return;
        const record = fs.readFileSync(file), payload = record.subarray(32);
        if (payload.length && hash(payload).equals(record.subarray(0, 32))) return v8.deserialize(payload);
      } catch { /* A missing or unreadable cache entry can be rebuilt. */ }
    },
    write(kind, key, value) {
      const file = filename(kind, key), temporary = file + '.' + randomUUID() + '.tmp';
      try {
        const payload = v8.serialize(value);
        if (payload.length + 32 > maxEntryBytes) return false;
        fs.mkdirSync(namespace, { recursive: true });
        fs.writeFileSync(temporary, Buffer.concat([hash(payload), payload]), { flag: 'wx' });
        fs.renameSync(temporary, file);
        return true;
      } catch {
        return false;
      } finally {
        try { fs.unlinkSync(temporary); } catch { /* The rename usually consumes the temporary file. */ }
      }
    }
  } });
}

module.exports = { open };
