/* Order-preserving encoding for blocks of native splat rows. */
const SplatCodec = (() => {
  const MAGIC = 0x31435249; // IRC1, little endian
  const STRIDE = 16;
  const BLOCK_ROWS = 2048;
  const MAX_ROWS = 4_000_000;
  const HEADER_BYTES = 8;
  const POSITION_LEVELS = 65535;

  // Each column carries a single mode byte followed by its payload.
  const CONSTANT = 0;
  const PLANES = 1;
  const QUANTIZED = 2;

  const AXIAL = 3;
  const COV_FIELDS = [4, 5, 6, 8, 9, 10];
  const AXIS_LEVELS = 2047;
  const LOG_STEPS = 512;
  const LOG_ORIGIN = -64;
  const AXIAL_BYTES = 7;
  const fractionalPowers = Float64Array.from({ length: LOG_STEPS }, (_, i) => 2 ** (i / LOG_STEPS));
  const integerPowers = Float64Array.from({ length: 65536 / LOG_STEPS }, (_, i) => 2 ** (LOG_ORIGIN + i));

  function variance(log) {
    return integerPowers[log >>> 9] * fractionalPowers[log & (LOG_STEPS - 1)];
  }

  function octDirection(u, v, direction) {
    let x = u * (2 / AXIS_LEVELS) - 1;
    let y = v * (2 / AXIS_LEVELS) - 1;
    const z = 1 - Math.abs(x) - Math.abs(y);
    if (z < 0) {
      const oldX = x;
      x = (1 - Math.abs(y)) * Math.sign(x || 1);
      y = (1 - Math.abs(oldX)) * Math.sign(y || 1);
    }
    const scale = 1 / Math.sqrt(x * x + y * y + z * z);
    direction[0] = x * scale;
    direction[1] = y * scale;
    direction[2] = z * scale;
  }

  function axialWords(data, index, tolerance, direction, result) {
    const a = data[index + 4],
      b = data[index + 5],
      c = data[index + 6];
    const d = data[index + 8],
      e = data[index + 9],
      f = data[index + 10];
    const trace = a + d + f;
    const normSquared = a * a + d * d + f * f + 2 * (b * b + c * c + e * e);
    const mean = trace / 3;
    const spread = Math.sqrt(Math.max(0, 1.5 * (normSquared - trace * mean)));
    const aa = a - mean,
      dd = d - mean,
      ff = f - mean;
    // The centered determinant gives the sign of the isolated eigenvalue.
    const sign = aa * (dd * ff - e * e) - b * (b * ff - c * e) + c * (b * e - c * dd) < 0 ? -1 : 1;
    const plane = mean - (sign * spread) / 3;
    const axis = mean + sign * spread * (2 / 3);
    const lp = Math.round((Math.log2(plane) - LOG_ORIGIN) * LOG_STEPS);
    const la = Math.round((Math.log2(axis) - LOG_ORIGIN) * LOG_STEPS);
    if (!(lp >= 0 && lp <= 65535 && la >= 0 && la <= 65535)) return false;

    // A column of C minus the planar variance is parallel to the axis in an axial Gaussian.
    // Use the diagonal with the largest magnitude to avoid dividing by a small component.
    const dx = a - plane,
      dy = d - plane,
      dz = f - plane;
    let x = dx,
      y = b,
      z = c;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) >= Math.abs(dz)) {
      x = b;
      y = dy;
      z = e;
    } else if (Math.abs(dz) > Math.abs(dx)) {
      x = c;
      y = e;
      z = dz;
    }
    const sum = Math.abs(x) + Math.abs(y) + Math.abs(z);
    if (sum) {
      x /= sum;
      y /= sum;
      z /= sum;
    }
    // An axis has no sign. Use one hemisphere to avoid needless sign flips between rows.
    if (z < 0) {
      x = -x;
      y = -y;
    }
    const u = Math.round((x * 0.5 + 0.5) * AXIS_LEVELS);
    const v = Math.round((y * 0.5 + 0.5) * AXIS_LEVELS);
    octDirection(u, v, direction);
    [x, y, z] = direction;
    const across = variance(lp);
    const along = variance(la);
    const delta = along - across;
    const ex = Math.fround(across + delta * x * x) - a;
    const ey = Math.fround(across + delta * y * y) - d;
    const ez = Math.fround(across + delta * z * z) - f;
    const exy = Math.fround(delta * x * y) - b;
    const exz = Math.fround(delta * x * z) - c;
    const eyz = Math.fround(delta * y * z) - e;
    const errorSquared = ex * ex + ey * ey + ez * ez + 2 * (exy * exy + exz * exz + eyz * eyz);
    if (!(errorSquared <= tolerance * tolerance * normSquared)) return false;
    // Relative Frobenius error alone can conceal a large change along a thin axis.
    const axialVariance = x * (a * x + b * y + c * z) + y * (b * x + d * y + e * z) + z * (c * x + e * y + f * z);
    if (Math.abs(along - axialVariance) > Math.min(along, axialVariance) * 0.01) return false;
    result[0] = u | (v << 11);
    result[1] = lp;
    result[2] = la;
    return true;
  }

  function encodeCovariance(data, words, first, rows, tolerance, scratch, at, workspace) {
    if (!tolerance || rows < 8) return 0;
    const { mask, axes, plane, axis, direction, result } = workspace;
    const maskBytes = Math.ceil(rows / 8);
    // Skip the fit entirely when exact constant columns already beat its minimum size.
    let varying = 0;
    for (const field of COV_FIELDS) {
      const start = first * STRIDE + field;
      for (let i = 1; i < rows; i++) {
        if (words[start + i * STRIDE] === words[start]) continue;
        varying++;
        break;
      }
    }
    const exactSize = varying * 4 * rows + (6 - varying) * 4 + 6;
    if (1 + maskBytes + AXIAL_BYTES * rows >= exactSize) return 0;
    mask.fill(0, 0, maskBytes);
    let compact = 0;
    for (let i = 0, index = first * STRIDE; i < rows; i++, index += STRIDE) {
      if (!axialWords(data, index, tolerance, direction, result)) continue;
      mask[i >>> 3] |= 1 << (i & 7);
      axes[compact] = result[0];
      plane[compact] = result[1];
      axis[compact++] = result[2];
    }
    const exact = rows - compact;
    const size = 1 + maskBytes + AXIAL_BYTES * compact + 24 * exact;
    if (compact === 0 || size >= exactSize) return 0;

    const start = at;
    scratch[at++] = AXIAL;
    scratch.set(mask.subarray(0, maskBytes), at);
    at += maskBytes;
    for (let i = 0; i < compact; i++) {
      scratch[at + i] = axes[i];
      scratch[at + compact + i] = axes[i] >>> 8;
      scratch[at + 2 * compact + i] = axes[i] >>> 16;
      scratch[at + 3 * compact + i] = plane[i];
      scratch[at + 4 * compact + i] = plane[i] >>> 8;
      scratch[at + 5 * compact + i] = axis[i];
      scratch[at + 6 * compact + i] = axis[i] >>> 8;
    }
    at += AXIAL_BYTES * compact;
    for (const field of COV_FIELDS) {
      let j = 0;
      for (let i = 0, index = first * STRIDE + field; i < rows; i++, index += STRIDE) {
        if (mask[i >>> 3] & (1 << (i & 7))) continue;
        const word = words[index];
        scratch[at + j] = word;
        scratch[at + exact + j] = word >>> 8;
        scratch[at + 2 * exact + j] = word >>> 16;
        scratch[at + 3 * exact + j] = word >>> 24;
        j++;
      }
      at += 4 * exact;
    }
    return at - start;
  }

  function decodeCovariance(bytes, at, rows, first, words, data, direction) {
    const maskBytes = Math.ceil(rows / 8);
    if (at + maskBytes > bytes.length) throw new RangeError('Truncated splat covariance mask');
    if (rows % 8 && bytes[at + maskBytes - 1] >>> (rows % 8)) throw new TypeError('Invalid splat covariance mask');
    let compact = 0;
    for (let i = 0; i < maskBytes; i++) {
      let bits = bytes[at + i];
      while (bits) {
        bits &= bits - 1;
        compact++;
      }
    }
    const exact = rows - compact;
    const payload = at + maskBytes;
    const raw = payload + AXIAL_BYTES * compact;
    const end = raw + 24 * exact;
    if (end > bytes.length) throw new RangeError('Truncated splat covariance payload');
    for (let i = 0; i < compact; i++)
      if (bytes[payload + 2 * compact + i] >= 64) throw new TypeError('Invalid splat covariance direction');
    if (!data) return end;
    let j = 0,
      k = 0;
    for (let i = 0, index = first * STRIDE; i < rows; i++, index += STRIDE) {
      if (bytes[at + (i >>> 3)] & (1 << (i & 7))) {
        const axis = readPlanes(bytes, payload, compact, j, 3);
        octDirection(axis & AXIS_LEVELS, axis >>> 11, direction);
        const across = variance(readPlanes(bytes, payload + 3 * compact, compact, j, 2));
        const along = variance(readPlanes(bytes, payload + 5 * compact, compact, j, 2));
        const delta = along - across;
        const [x, y, z] = direction;
        data[index + 4] = across + delta * x * x;
        data[index + 5] = delta * x * y;
        data[index + 6] = delta * x * z;
        data[index + 8] = across + delta * y * y;
        data[index + 9] = delta * y * z;
        data[index + 10] = across + delta * z * z;
        j++;
      } else {
        for (let field = 0; field < COV_FIELDS.length; field++)
          words[index + COV_FIELDS[field]] = readPlanes(bytes, raw + field * 4 * exact, exact, k, 4);
        k++;
      }
    }
    return end;
  }

  function readPlanes(bytes, start, rows, index, planes) {
    let word = 0;
    for (let p = 0; p < planes; p++) word |= bytes[start + rows * p + index] << (8 * p);
    return word;
  }

  function encode(data, count = data?.length / STRIDE, { maxPositionError = 0.0001, maxCovarianceError = 0.004 } = {}) {
    if (
      !(data instanceof Float32Array) ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > MAX_ROWS ||
      count * STRIDE > data.length
    )
      throw new RangeError('Splat codec needs native rows and a valid count');
    if (!Number.isFinite(maxPositionError) || maxPositionError < 0)
      throw new RangeError('Splat codec position error must be finite and nonnegative');

    if (!Number.isFinite(maxCovarianceError) || maxCovarianceError < 0 || maxCovarianceError > 0.05)
      throw new RangeError('Splat codec covariance error must be in [0, 0.05]');

    const size = Math.min(count, BLOCK_ROWS);
    const covariance = maxCovarianceError && {
      mask: new Uint8Array(Math.ceil(size / 8)),
      axes: new Uint32Array(size),
      plane: new Uint16Array(size),
      axis: new Uint16Array(size),
      direction: [0, 0, 0],
      result: [0, 0, 0]
    };
    const scratch = new Uint8Array(size * STRIDE * 4 + STRIDE + 3 * 8);
    const view = new DataView(scratch.buffer);
    const words = new Uint32Array(data.buffer, data.byteOffset, count * STRIDE);
    const quantized = new Uint16Array(size);
    const blocks = [];
    let bytes = HEADER_BYTES;
    for (let first = 0; first < count; first += BLOCK_ROWS) {
      const rows = Math.min(BLOCK_ROWS, count - first);
      let at = 0,
        packedCovariance = false;
      for (let field = 0; field < STRIDE; field++) {
        if (field === 4) {
          const written = encodeCovariance(data, words, first, rows, maxCovarianceError, scratch, at, covariance);
          at += written;
          packedCovariance = written > 0;
        }
        if (packedCovariance && COV_FIELDS.includes(field)) continue;
        const start = first * STRIDE + field;
        const initial = words[start];
        let same = true;
        let min = data[start],
          max = min;
        const position = field < 3;
        for (let i = 0, index = start; i < rows; i++, index += STRIDE) {
          if (words[index] !== initial) same = false;
          if (position) {
            const value = data[index];
            if (!Number.isFinite(value)) throw new TypeError('Splat position must be finite');
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        }
        if (same) {
          scratch[at++] = CONSTANT;
          view.setUint32(at, initial, true);
          at += 4;
          continue;
        }

        const step = (max - min) / POSITION_LEVELS;
        let useQuantized = position && rows > 4 && maxPositionError > 0 && step > 0 && step * 0.5 <= maxPositionError;
        if (useQuantized) {
          for (let i = 0, index = start; i < rows; i++, index += STRIDE) {
            const value = data[index];
            const q = Math.round((value - min) / step);
            if (Object.is(value, -0) || Math.abs(Math.fround(min + q * step) - value) > maxPositionError) {
              useQuantized = false;
              break;
            }
            quantized[i] = q;
          }
        }

        if (useQuantized) {
          scratch[at++] = QUANTIZED;
          view.setFloat32(at, min, true);
          view.setFloat32(at + 4, max, true);
          at += 8;
          let previous = 0;
          for (let i = 0; i < rows; i++) {
            const q = quantized[i];
            // Wrap in the u16 domain, then put small changes of either sign near zero.
            const delta = ((q - previous + 32768) & 65535) - 32768;
            const zigzag = (delta << 1) ^ (delta >> 31);
            scratch[at + i] = zigzag;
            scratch[at + rows + i] = zigzag >>> 8;
            previous = q;
          }
          at += 2 * rows;
        } else {
          scratch[at++] = PLANES;
          for (let i = 0, index = start; i < rows; i++, index += STRIDE) {
            const word = words[index];
            scratch[at + i] = word;
            scratch[at + rows + i] = word >>> 8;
            scratch[at + 2 * rows + i] = word >>> 16;
            scratch[at + 3 * rows + i] = word >>> 24;
          }
          at += 4 * rows;
        }
      }
      blocks.push(scratch.slice(0, at));
      bytes += at;
    }
    const out = new Uint8Array(bytes);
    const header = new DataView(out.buffer);
    header.setUint32(0, MAGIC, true);
    header.setUint32(4, count, true);
    let at = HEADER_BYTES;
    for (const block of blocks) {
      out.set(block, at);
      at += block.length;
    }
    return out;
  }

  function decode(bytes, { maxRows = MAX_ROWS } = {}) {
    if (!(bytes instanceof Uint8Array) || bytes.length < HEADER_BYTES)
      throw new TypeError('Invalid splat codec header');
    if (!Number.isSafeInteger(maxRows) || maxRows < 0 || maxRows > MAX_ROWS)
      throw new RangeError('Invalid splat codec row limit');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== MAGIC) throw new TypeError('Unsupported splat codec format');
    const count = view.getUint32(4, true);
    if (count > maxRows) throw new RangeError('Splat codec row limit exceeded');

    // Validate all lengths and tags before allocating the decoded rows.
    function visit(words, data) {
      let at = HEADER_BYTES;
      const direction = [0, 0, 0];
      for (let first = 0; first < count; first += BLOCK_ROWS) {
        const rows = Math.min(BLOCK_ROWS, count - first);
        let packedCovariance = false;
        for (let field = 0; field < STRIDE; field++) {
          if (packedCovariance && COV_FIELDS.includes(field)) continue;
          const mode = bytes[at++];
          if (field === 4 && mode === AXIAL) {
            at = decodeCovariance(bytes, at, rows, first, words, data, direction);
            packedCovariance = true;
            continue;
          }
          const start = first * STRIDE + field;
          if (mode === CONSTANT) {
            if (at + 4 > bytes.length) throw new RangeError('Truncated splat codec column');
            const word = view.getUint32(at, true);
            if (field < 3 && (word & 0x7f800000) === 0x7f800000) throw new TypeError('Splat position must be finite');
            if (words) for (let i = 0; i < rows; i++) words[start + i * STRIDE] = word;
            at += 4;
          } else if (mode === PLANES) {
            if (at + 4 * rows > bytes.length) throw new RangeError('Truncated splat codec column');
            if (words || field < 3) {
              for (let i = 0; i < rows; i++) {
                const word =
                  bytes[at + i] |
                  (bytes[at + rows + i] << 8) |
                  (bytes[at + 2 * rows + i] << 16) |
                  (bytes[at + 3 * rows + i] << 24);
                if (!words && (word & 0x7f800000) === 0x7f800000) throw new TypeError('Splat position must be finite');
                if (words) words[start + i * STRIDE] = word;
              }
            }
            at += 4 * rows;
          } else if (field < 3 && mode === QUANTIZED) {
            if (at + 8 + 2 * rows > bytes.length) throw new RangeError('Truncated splat codec column');
            const min = view.getFloat32(at, true),
              max = view.getFloat32(at + 4, true);
            if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max)
              throw new TypeError('Invalid splat position bounds');
            at += 8;
            if (data) {
              const step = (max - min) / POSITION_LEVELS;
              let q = 0;
              for (let i = 0; i < rows; i++) {
                const zigzag = bytes[at + i] | (bytes[at + rows + i] << 8);
                q = (q + ((zigzag >>> 1) ^ -(zigzag & 1))) & 65535;
                data[start + i * STRIDE] = min + q * step;
              }
            }
            at += 2 * rows;
          } else {
            throw new TypeError('Invalid or missing splat codec column');
          }
        }
      }
      if (at !== bytes.length) throw new TypeError('Unexpected trailing splat codec data');
    }

    visit(null, null);
    const data = new Float32Array(count * STRIDE);
    visit(new Uint32Array(data.buffer), data);
    return { data, count };
  }

  return Object.freeze({ encode, decode, version: 1 });
})();
