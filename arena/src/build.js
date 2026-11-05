// Laying out a level (the "arena.build" extension): commands that put down
// the sample arena, or one block where you're looking. Each kind of block is
// one GLB file doc, drawn once and named in the level trait so later blocks of
// that kind reuse it. Objects are written straight into the scene doc, as any
// importer does; the scene shows them like anything else.

import { encodeGLB } from "./glb.js";
import { KINDS, sampleArena } from "./level.js";

const LEVEL = "arena.level";
// The kinds' art changes now and then. Their GLBs are remembered in the level
// trait under "<kind>@<ART>", so a level drawn with older art gets this art's
// GLBs for what's added to it, not the old ones.
export const ART = 2;
export const kindKey = (kind) => `${kind}@${ART}`;
const ADDABLE = [
  ["target", "Add target", { "arena.target": {} }],
  ["crate", "Add crate", null],
  ["spawn", "Add spawn point", { "arena.spawn": {} }],
];

/** A kind's GLB bytes. */
export function kindGLB(kind) {
  const meshes = KINDS[kind].meshes();
  return encodeGLB({ generator: "patchwork arena", meshes: meshes.map((m) => ({ ...m, roughness: 0.75 })) });
}

/** An object for the scene doc: a passthrough GLB, filed in `group`. */
export function levelObject({ name, transform, traits }, url, group) {
  return {
    name,
    sourceUrl: url,
    providerId: "file-glb",
    renderUrl: null,
    parent: null,
    group,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    locked: true,
    transform: { position: [...transform.position], rotation: [...transform.rotation], scale: transform.scale ?? 1 },
    ...(traits ? { traits: JSON.parse(JSON.stringify(traits)) } : {}),
  };
}

export default {
  create(api) {
    /** Each kind's GLB doc, made the first time it's needed (and remembered in the level trait). */
    async function kindUrls(kinds) {
      const known = { ...(api.doc()?.traits?.[LEVEL]?.kinds ?? {}) };
      const urls = {};
      const made = {};
      for (const kind of kinds) {
        if (known[kindKey(kind)]) {
          urls[kind] = known[kindKey(kind)];
          continue;
        }
        const file = await api.repo.create2({
          "@patchwork": { type: "file" },
          name: `${KINDS[kind].name}.glb`,
          extension: "glb",
          mimeType: "model/gltf-binary",
          content: kindGLB(kind),
        });
        urls[kind] = made[kindKey(kind)] = file.url;
      }
      return { urls, made };
    }

    function writeLevelTrait(d, made) {
      if (!d.traits) d.traits = {};
      if (!d.traits[LEVEL]) d.traits[LEVEL] = { kinds: {} };
      if (!d.traits[LEVEL].kinds) d.traits[LEVEL].kinds = {};
      // someone else may have drawn one first: theirs wins, ours is an orphan
      for (const [k, url] of Object.entries(made)) if (!d.traits[LEVEL].kinds[k]) d.traits[LEVEL].kinds[k] = url;
    }

    async function buildSample() {
      const blocks = sampleArena();
      const { urls, made } = await kindUrls([...new Set(blocks.map((b) => b.kind))]);
      const gid = api.newId("g");
      api.change((d) => {
        writeLevelTrait(d, made);
        if (!d.objects) d.objects = {};
        if (!d.order) d.order = [];
        d.objects[gid] = { kind: "group", name: "Arena", group: null, visible: true, opacity: 1 };
        d.order.push(gid);
        // a level is for playing: whoever opens it gets the game, not the
        // editor (the "Arena level" kit brings the editor back, per viewer).
        // Only the sample arena says so: a target added to a boat leaves the
        // boat's kits alone.
        if (d.view && d.view.kits === undefined) d.view.kits = [];
        // and it has the arena's look (sky, haze, sun: play.js); a scene
        // that only had a target added keeps its own
        d.traits[LEVEL].look = "arena";
        for (const b of blocks) {
          const id = api.newId("o");
          d.objects[id] = levelObject(b, d.traits[LEVEL].kinds[kindKey(b.kind)] ?? urls[b.kind], gid);
          d.order.push(id);
        }
      });
      api.notify("Arena laid out. Press Play (or Enter) to walk it.", "info");
    }

    /** Where you're looking, on whatever is there (a boat's deck as well as a floor). */
    function spotAhead() {
      const cam = api.camera.get();
      const target = cam.target ?? [0, 0, 0];
      const hit = api.raycast([target[0], target[1] + 50, target[2]], [0, -1, 0], { far: 200 });
      const y = hit ? hit.point[1] : 0;
      const yaw = Math.atan2(cam.position[0] - target[0], cam.position[2] - target[2]);
      return { position: [target[0], y, target[2]], rotation: [0, yaw, 0], scale: 1 };
    }

    async function addOne(kind, name, traits) {
      const { urls, made } = await kindUrls([kind]);
      const transform = spotAhead();
      const id = api.newId("o");
      api.change((d) => {
        writeLevelTrait(d, made);
        if (!d.objects) d.objects = {};
        if (!d.order) d.order = [];
        d.objects[id] = levelObject({ name, transform, traits }, d.traits[LEVEL].kinds[kindKey(kind)] ?? urls[kind], null);
        d.order.push(id);
      });
      api.local.swap((l) => ({ ...l, selected: id }));
    }

    const fail = (err) => api.notify(`Couldn't add it: ${err?.message ?? err}`, "error");
    return {
      commands: [
        { id: "sample", name: "Sample arena", show: ["toolbar", "menu"], state: () => ({ title: "Lay out a walled arena with crates, a tower, targets and spawn points" }), run: () => buildSample().catch(fail) },
        ...ADDABLE.map(([kind, name, traits]) => ({
          id: `add-${kind}`,
          name,
          show: ["toolbar", "menu"],
          state: () => ({ title: `${name.replace("Add", "Put")} where you're looking` }),
          run: () => addOne(kind, KINDS[kind].name, traits).catch(fail),
        })),
      ],
    };
  },
};
