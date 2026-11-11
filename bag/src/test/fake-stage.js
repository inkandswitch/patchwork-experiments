// For tests: the part of the stage's extension api (scene/STAGE.md, "api")
// that the bag's extension uses, over FakeHandles. Each thing the stage would
// do is recorded so a test can read it back: notices, sends, labels, arms,
// loops, edges, addObject calls.
import { FakeHandle, FakeRepo } from "./fake-repo.js";

export const SCENE_URL = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";

const compose = (t = {}) => {
  const [x, y, z] = t.position ?? [0, 0, 0];
  const s = Number(t.scale) || 1;
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1];
};

/** A snapshot like api.scene(): objects, members (group → objects in it), world(id) (translation and scale only). */
export function snapshot(doc) {
  const objects = doc.objects ?? {};
  const members = new Map();
  for (const [id, o] of Object.entries(objects)) if (o?.group) members.set(o.group, [...(members.get(o.group) ?? []), id]);
  const world = (id) => {
    const o = objects[id];
    if (!o) return compose();
    const m = compose(o.transform);
    if (o.parent && objects[o.parent]) {
      const p = world(o.parent);
      m[12] += p[12];
      m[13] += p[13];
      m[14] += p[14];
    }
    return m;
  };
  return { d: doc, objects, ids: Object.keys(objects), members, parents: new Map(Object.entries(objects).flatMap(([id, o]) => (o?.parent ? [[id, o.parent]] : []))), world };
}

/**
 * @param {object} sceneDoc  @param {{ session?: string, repo?: FakeRepo, activity?: string, sizes?: Record<string, number> }} [o]
 *   sizes: half-widths (m) of objects that have content; an object with none has no box yet
 */
export function fakeStage(sceneDoc, { session = "s-me", repo = new FakeRepo(), activity = "play", half = {} } = {}) {
  const handle = repo.handles.get(SCENE_URL) ?? repo.add(sceneDoc, SCENE_URL);
  const rec = { notices: [], sends: [], labels: [], arms: [], loops: new Set(), edges: [], added: [], removed: [], held: new Map(), contributions: {}, local: { activities: { current: activity, available: ["edit", "play"] } } };
  let n = 0;
  const boxOf = (id) => {
    const h = half[id];
    const o = handle.doc().objects[id];
    if (h == null || !o) return null;
    const m = snapshot(handle.doc()).world(id);
    return { min: [m[12] - h, m[13], m[14] - h], max: [m[12] + h, m[13] + 2 * h, m[14] + h] };
  };
  const api = {
    id: "bag",
    repo,
    handle,
    url: SCENE_URL,
    viewer: "automerge:viewerMe",
    session,
    signal: { aborted: false },
    doc: () => handle.doc(),
    change: (fn) => handle.change(fn),
    scene: () => snapshot(handle.doc()),
    newId: (prefix) => `${prefix}new${++n}`,
    remove(ids) {
      rec.removed.push([...ids]);
      handle.change((d) => {
        for (const id of ids) {
          // a group goes with what is in it, as the stage's remove does
          if (d.objects[id]?.kind === "group") for (const [m, o] of Object.entries(d.objects)) if (o.group === id) delete d.objects[m];
          delete d.objects[id];
        }
        d.order = d.order.filter((x) => d.objects[x]);
      });
    },
    async addObject(url, opts) {
      const id = `ocopy${++n}`;
      rec.added.push({ url, opts: JSON.parse(JSON.stringify(opts)) });
      handle.change((d) => {
        d.objects[id] = { name: opts.name, sourceUrl: url, providerId: opts.providerId ?? null, renderUrl: opts.render ? "automerge:newrender" : null, parent: opts.parent ?? null, group: opts.group ?? null, transform: opts.transform, ...(opts.fields ?? {}) };
        d.order.push(id);
      });
      return id;
    },
    notify: (text, kind) => rec.notices.push(kind ? `${kind}: ${text}` : text),
    send: (type, data) => rec.sends.push([type, JSON.parse(JSON.stringify(data))]),
    collect: (name) => (rec.contributions[name] ?? []).map((value, i) => ({ id: `other${i}`, value })),
    box: boxOf,
    content: (id) => (half[id] != null && handle.doc().objects[id] ? { loaded: true, box: { min: [-half[id], 0, -half[id]], max: [half[id], 2 * half[id], half[id]] } } : null),
    worldOf: (id) => (handle.doc().objects[id] ? snapshot(handle.doc()).world(id) : null),
    heldBy: (id) => rec.held.get(id) ?? null,
    labels: () => ({ set: (items) => (rec.labels = items) }),
    style: () => {},
    edge(side) {
      const el = document.createElement("div");
      el.dataset.side = side;
      document.body.append(el);
      rec.edges.push(el);
      return el;
    },
    arm(handlers) {
      const a = { handlers, on: true };
      rec.arms.push(a);
      return () => void (a.on = false);
    },
    loop(fn) {
      rec.loops.add(fn);
      return () => rec.loops.delete(fn);
    },
    schedule: (fn) => fn(),
    listen: () => () => {},
    port: null,
    local: { get: () => rec.local },
  };
  return { api, rec, handle, repo, half, frame: () => [...rec.loops].forEach((fn) => fn(0.016)) };
}

export { FakeHandle, FakeRepo };
