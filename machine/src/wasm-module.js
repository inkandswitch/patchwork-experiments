// Reads just enough of a .wasm binary to refuse what a snapshot could not
// capture, and to export every mutable global so that a snapshot can.
//
// prepare(bytes, allowedImports) -> { bytes, globals: [{ name, type }] }
//   bytes    the same module with one export added per unexported mutable
//            global, named "machine:global:<index>"
//   globals  every mutable global, in index order, by export name and type
//
// Refused: an import not in allowedImports ("module.name", functions only),
// anything but exactly one memory of the module's own, shared memory, a
// mutable global of a type JS cannot read back exactly (v128, references),
// and passive data and element segments (whether one was dropped is instance
// state that is not in memory).

const TYPES = { 0x7f: "i32", 0x7e: "i64", 0x7d: "f32", 0x7c: "f64" };
const ORDER = [1, 2, 3, 4, 5, 13, 6, 7, 8, 9, 12, 10, 11]; // non-custom section order
const EXPORT = 7;

export function prepare(input, allowedImports = new Set()) {
  const bytes = new Uint8Array(input);
  const r = reader(bytes);
  if (r.u32le() !== 0x6d736100 || r.u32le() !== 1) throw new Error("not a wasm module");

  const sections = []; // { id, at: where it begins, start/end: its contents }
  while (r.pos < bytes.length) {
    const at = r.pos;
    const id = r.byte();
    const size = r.uleb();
    sections.push({ id, at, start: r.pos, end: r.pos + size });
    r.pos += size;
  }

  let importedGlobals = 0;
  let memories = 0;
  const mutable = []; // global indices
  const types = new Map();
  const exports = []; // raw entries, kept as they are
  const exportedGlobal = new Map(); // global index -> name
  const names = new Set();

  for (const s of sections) {
    const c = reader(bytes, s.start);
    if (s.id === 2) {
      for (let n = c.uleb(); n > 0; n--) {
        const name = `${c.name()}.${c.name()}`;
        const kind = c.byte();
        if (kind !== 0 || !allowedImports.has(name))
          throw new Error(`import ${name} is not one the host provides`);
        c.uleb();
      }
    } else if (s.id === 5) {
      memories += c.uleb();
      if (memories === 1 && c.uleb() & 2) throw new Error("shared memory");
    } else if (s.id === 6) {
      for (let n = c.uleb(), i = importedGlobals; n > 0; n--, i++) {
        const t = c.byte();
        const mut = c.byte();
        c.constExpr();
        if (!mut) continue;
        if (!TYPES[t]) throw new Error(`mutable global ${i} has a type JS cannot read exactly`);
        mutable.push(i);
        types.set(i, TYPES[t]);
      }
    } else if (s.id === EXPORT) {
      for (let n = c.uleb(); n > 0; n--) {
        const from = c.pos;
        const name = c.name();
        const kind = c.byte();
        const index = c.uleb();
        names.add(name);
        if (kind === 3 && !exportedGlobal.has(index)) exportedGlobal.set(index, name);
        exports.push(bytes.subarray(from, c.pos));
      }
    } else if (s.id === 9) {
      for (let n = c.uleb(); n > 0; n--) {
        const flags = c.uleb(); // bit 0: passive or declarative; 1: table index or kind; 2: expressions
        if ((flags & 3) === 1) throw new Error("passive element segment");
        if (flags & 2 && !(flags & 1)) c.uleb(); // table index
        if (!(flags & 1)) c.constExpr(); // offset
        if (flags & 3) c.byte(); // element kind or reference type
        for (let k = c.uleb(); k > 0; k--) flags & 4 ? c.constExpr() : c.uleb();
      }
    } else if (s.id === 11) {
      for (let n = c.uleb(); n > 0; n--) {
        const flags = c.uleb();
        if (flags === 1) throw new Error("passive data segment");
        if (flags === 2) c.uleb();
        c.constExpr();
        const size = c.uleb(); // read before adding: `c.pos += c.uleb()` reads pos first
        c.pos += size;
      }
    }
  }
  if (memories !== 1) throw new Error(`${memories} memories; an engine has exactly one, its own`);

  const added = [];
  const globals = mutable.map((i) => {
    let name = exportedGlobal.get(i);
    if (name === undefined) {
      name = `machine:global:${i}`;
      if (names.has(name)) throw new Error(`export name ${name} is taken`);
      added.push(concat([encodeName(name), [3], uleb(i)]));
    }
    return { name, type: types.get(i) };
  });
  if (!added.length) return { bytes, globals };

  const content = concat([uleb(exports.length + added.length), ...exports, ...added]);
  const section = concat([[EXPORT], uleb(content.length), content]);
  const old = sections.find((s) => s.id === EXPORT);
  const at = old
    ? old.at
    : (sections.find((s) => s.id !== 0 && ORDER.indexOf(s.id) > ORDER.indexOf(EXPORT))?.at ??
      bytes.length);
  const rest = old ? old.end : at;
  return { bytes: concat([bytes.subarray(0, at), section, bytes.subarray(rest)]), globals };
}

function reader(bytes, pos = 0) {
  const r = {
    pos,
    byte: () => bytes[r.pos++],
    u32le: () => (r.byte() | (r.byte() << 8) | (r.byte() << 16) | (r.byte() << 24)) >>> 0,
    uleb() {
      let result = 0;
      let shift = 0;
      for (;;) {
        const b = r.byte();
        if (b === undefined) throw new Error("truncated module");
        result += (b & 0x7f) * 2 ** shift;
        shift += 7;
        if (!(b & 0x80)) return result;
      }
    },
    name() {
      const len = r.uleb();
      const s = new TextDecoder().decode(bytes.subarray(r.pos, r.pos + len));
      r.pos += len;
      return s;
    },
    // A constant expression: the opcodes a global or segment initializer may use.
    constExpr() {
      for (;;) {
        const op = r.byte();
        if (op === 0x0b) return;
        if (op === 0x41 || op === 0x42 || op === 0x23 || op === 0xd2) r.uleb(); // const, global.get, ref.func
        else if (op === 0x43) r.pos += 4;
        else if (op === 0x44) r.pos += 8;
        else if (op === 0xd0) r.byte(); // ref.null
        else if (op === 0xfd && r.uleb() === 12) r.pos += 16; // v128.const
        else if (![0x6a, 0x6b, 0x6c, 0x7c, 0x7d, 0x7e].includes(op))
          throw new Error(`opcode 0x${op.toString(16)} in a constant expression`);
      }
    },
  };
  return r;
}

function uleb(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}

function encodeName(s) {
  const b = new TextEncoder().encode(s);
  return concat([uleb(b.length), b]);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
