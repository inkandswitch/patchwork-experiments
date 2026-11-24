// Turns an ink-scene doc into an ink-studio scene: { id, name, seed, build(seed) }.
//
// The doc carries the scene the way upstream's CLI reads it from disk:
//   kind "js"       `main` names a CommonJS file in `files`; its export is called
//                   with the toolkit, exactly as `ink-studio render file.js` does
//                   (cli/ink-studio.js: require(file)(lib())).
//   kind "diorama"  `main` names a JSON diorama in `files`, built by
//                   KIT.diorama.scene (the CLI's dataScene, without its flags).
//   kind "builtin"  `main` is the id of one of the toolkit's seven demos.
//
// `files` is { [name]: text }: one folder, names without "/" (Automerge's
// updateText splits paths on "/"), so a scene's require("./y.json") and
// require("./z") resolve beside it, as every upstream example's do. This
// runs the doc's code in the page: the user's call (2026-11-20), the same trust
// as installing a package.

const NODE_ONLY = new Set(["fs", "path", "os", "crypto", "child_process", "worker_threads", "url", "zlib", "util"]);

/** A file's name in `files`: one folder, so no "/" (Automerge text paths can't hold one). */
export const isFileName = (name) => typeof name === "string" && /^[^/\\]+$/.test(name) && name !== "." && name !== "..";

function resolve(from, request, files) {
  if (!request.startsWith(".")) {
    if (NODE_ONLY.has(request.replace(/^node:/, "")))
      throw new Error(`this scene needs Node's "${request}", which a browser doesn't have`);
    throw new Error(`this scene needs the package "${request}"; only its own files can be required here`);
  }
  if (/^\.\.?\/?$/.test(request) || /^(\.\.\/)+(index(\.js)?)?$/.test(request))
    throw new Error(`this scene requires "${request}", ink-studio's Node API, which a browser doesn't have`);
  const name = request.replace(/^\.\//, "");
  if (!isFileName(name))
    throw new Error(`"${from}" requires "${request}"; a scene's files sit in one folder, so only "./name" can be required`);
  for (const candidate of [name, `${name}.js`, `${name}.json`]) if (Object.hasOwn(files, candidate)) return candidate;
  throw new Error(`"${from}" requires "${request}", which isn't among this scene's files`);
}

/** A CommonJS require over a file table. Each module evaluates once. */
export function makeRequire(files) {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const text = files[name];
    if (name.endsWith(".json")) {
      const value = JSON.parse(text);
      cache.set(name, { exports: value });
      return value;
    }
    const module = { exports: {} };
    cache.set(name, module);
    const run = new Function("module", "exports", "require", "__filename", "__dirname",
      `${text}\n//# sourceURL=ink-scene/${name}`);
    run(module, module.exports, (request) => load(resolve(name, request, files)), name, ".");
    return module.exports;
  }
  return (name) => {
    if (!Object.hasOwn(files, name)) throw new Error(`no file "${name}" in this scene`);
    return load(name);
  };
}

/** The kit a scene file is called with: what upstream's load() gives, minus Node. */
export function kitOf(toolkit) {
  return { ...toolkit };
}

export async function loadScene(toolkit, doc) {
  const files = doc.files ?? {};
  if (doc.kind === "builtin") {
    const scene = toolkit.SCENES.find((s) => s.id === doc.main);
    if (!scene) throw new Error(`no built-in scene called "${doc.main}"`);
    return scene;
  }
  if (!Object.hasOwn(files, doc.main)) throw new Error(`the scene's main file "${doc.main}" is missing`);
  if (doc.kind === "diorama") {
    const spec = JSON.parse(files[doc.main]);
    return toolkit.KIT.diorama.scene(spec, {});
  }
  if (doc.kind === "js") {
    const exported = makeRequire(files)(doc.main);
    const scene = await (typeof exported === "function" ? exported(kitOf(toolkit)) : exported);
    if (!scene || typeof scene.build !== "function")
      throw new Error(`"${doc.main}" doesn't export a scene: expected kit => ({ id, name, seed, build(seed) })`);
    return scene;
  }
  throw new Error(`unknown scene kind "${doc.kind}"`);
}
