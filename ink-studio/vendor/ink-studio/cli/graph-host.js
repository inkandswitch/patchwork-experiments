/* Explicit capture, codec and PXC extension points for trusted Node hosts. */
const { inspectPxc, previewProject } = require('./pxc.js');
const bytesLimit = 8 * 32000000 + 65536;
const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,95}$/i.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);
const typeNames = ['audio', 'inputs', 'raster', 'json'];

function bytes(value, label, limit = bytesLimit) {
  if (!(value instanceof Uint8Array) || value.length > limit) throw new TypeError(label + ' needs bounded bytes');
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function registry(entries, methods) {
  if (!plain(entries) || !Object.keys(entries).every(id) || Object.keys(entries).length > 64)
    throw new TypeError('Expected named host adapter registrations');
  return Object.fromEntries(Object.entries(entries).map(([name, entry]) => {
    if (!plain(entry) || !Object.keys(entry).length ||
        Object.entries(entry).some(([key, value]) => !methods.includes(key) || typeof value !== 'function'))
      throw new TypeError('Invalid host adapter ' + name);
    return [name, { ...entry }];
  }));
}

function createGraphHost(config = {}, { kit = require('../index.js').load() } = {}) {
  const P = kit.KIT.procedural, A = P.mediaGraph;
  if (!plain(config) || Object.keys(config).some(key => !['devices', 'network', 'codecs', 'pxc'].includes(key)))
    throw new TypeError('Expected device, network, codec or PXC adapter registries');
  const { devices = {}, network = {}, codecs = {}, pxc = {} } = config;
  const entries = { device: registry(devices, ['read']), network: registry(network, ['read', 'write']),
    codec: registry(codecs, ['decode', 'encode']), pxc: registry(pxc, ['import']) };

  function method(kind, name, action) {
    const row = entries[kind];
    if (!id(name) || !Object.hasOwn(row, name) || !row[name][action])
      throw new RangeError('Missing ' + kind + ' adapter ' + name + ' for ' + action);
    return row[name][action];
  }

  function normalize(type, value) {
    if (type === 'audio') return A.audio(value);
    if (type === 'raster') return P.raster.rgba(value);
    if (type === 'inputs') return A.recording(value);
    if (type === 'json') return P.data.clone(value);
    throw new TypeError('Unknown captured value type ' + type);
  }

  function portable(type, value) {
    if (type === 'audio') return { ...value, samples: Array.from(value.samples) };
    if (type === 'raster') return { ...value, data: Array.from(value.data) };
    return value;
  }

  function request(source) {
    if (!plain(source) || source.format !== 'ink-studio/host-request' || source.version !== 1 ||
        Object.keys(source).some(key => !['format', 'version', 'kind', 'adapter', 'direction', 'type', 'options', 'file'].includes(key)))
      throw new TypeError('Expected a version 1 host capture request');
    const { kind, adapter, direction = 'read', type, options = {}, file } = source;
    if (!['device', 'network'].includes(kind) || !['read', 'write'].includes(direction) ||
        kind === 'device' && direction !== 'read' || !id(adapter) || !typeNames.includes(type) || !plain(options) ||
        (direction === 'write' ? typeof file !== 'string' || !file.trim() : file !== undefined))
      throw new TypeError('Invalid device or network capture request');
    return { kind, adapter, direction, type, options: P.data.clone(options), file };
  }

  async function exchange(source, { value, signal } = {}) {
    const { kind, adapter, direction, type, options } = request(source);
    const call = method(kind, adapter, direction);
    const response = await call({ type, options, signal,
      ...(direction === 'write' && { value: portable(type, normalize(type, value)) }) });
    return direction === 'write' ? P.data.clone(response ?? null) : normalize(type, response);
  }

  function sync(value) {
    if (value?.then) throw new TypeError('Graph codecs must produce synchronous snapshots');
    return value;
  }

  function codecOptions(type, options) {
    if (!['audio', 'raster'].includes(type) || !plain(options)) throw new TypeError('A codec needs an audio or raster type and settings');
    return P.data.clone(options);
  }

  function decode(name, source, { type, file, options = {} } = {}) {
    const call = method('codec', name, 'decode');
    return normalize(type, sync(call({ bytes: bytes(source, 'Codec input'), type, file, options: codecOptions(type, options) })));
  }

  function encode(name, value, { type, options = {} } = {}) {
    const call = method('codec', name, 'encode');
    options = codecOptions(type, options);
    const result = sync(call({ value: normalize(type, value), type, options }));
    if (!plain(result) || typeof result.extension !== 'string' || !/^[a-z0-9]{1,16}$/i.test(result.extension))
      throw new RangeError('Codec output needs a safe extension and bytes');
    return { extension: result.extension.toLowerCase(), bytes: bytes(result.bytes, 'Codec output') };
  }

  async function importPxc(source, { using, file, options = {} } = {}) {
    source = bytes(source, 'PXC input', 64 * 1024 * 1024);
    if (using === undefined) return previewProject(source);
    const call = method('pxc', using, 'import');
    const result = await call({ bytes: source, file, options: P.data.clone(options), inspect: settings => inspectPxc(source, settings) });
    if (!plain(result) || !plain(result.project) || result.report !== undefined && !plain(result.report))
      throw new TypeError('PXC adapter needs to return an Ink graph project and optional report');
    return { project: P.data.clone(result.project), report: { ...P.data.clone(result.report ?? {}), mode: 'adapter', adapter: using } };
  }

  return Object.freeze({ request, normalize, exchange, decode, encode, importPxc,
    requireCodec(name, action) { method('codec', name, action); }
  });
}

function httpJsonAdapter(location, { maxBytes = 1048576, timeout = 5000, headers = {} } = {}) {
  const endpoint = new URL(location);
  if (!['http:', 'https:'].includes(endpoint.protocol) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      maxBytes > 32 * 1024 * 1024 || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600000 ||
      !plain(headers)) throw new RangeError('Invalid HTTP JSON adapter endpoint or bounds');
  async function transfer(method, { value, signal }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const stop = () => controller.abort(signal.reason);
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
    try {
      const body = method === 'POST' ? JSON.stringify(value) : undefined;
      if (body && Buffer.byteLength(body) > maxBytes) throw new RangeError('HTTP JSON request exceeds the byte budget');
      const response = await fetch(endpoint, { method, headers: { accept: 'application/json', ...headers,
        ...(body && { 'content-type': 'application/json' }) }, body, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('HTTP JSON transport returned ' + response.status);
      }
      if (!response.body) return null;
      const reader = response.body.getReader(), chunks = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) throw new RangeError('HTTP JSON response exceeds the byte budget');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return total ? JSON.parse(Buffer.concat(chunks, total).toString('utf8')) : null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  }
  return Object.freeze({ read: arg => transfer('GET', arg), write: arg => transfer('POST', arg) });
}

async function recordInputEvents(source, { initial, signal, kit = require('../index.js').load() } = {}) {
  const recorder = kit.KIT.procedural.mediaGraph.recorder(initial);
  if (signal?.aborted) throw signal.reason;
  for await (const row of source) {
    if (signal?.aborted) throw signal.reason;
    recorder.append(row);
  }
  return recorder.snapshot();
}

module.exports = { createGraphHost, httpJsonAdapter, inspectPxc, recordInputEvents };
