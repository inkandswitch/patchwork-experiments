// The stage's renderer (API.md, "`api`"): the WebGL renderer
// and the frame loop, put together from small modules, each one idea:
//   ./object-tree.js, ./object-content.js  the objects: their tree, and what's in each
//   ./atmosphere.js, ./draw-atmosphere.js  the atmosphere's value; its lights, fog and sky drawn
//   ./shadows.js                           the sun's shadow frame
//   ./clearance.js                         the depth range, from the nearest geometry
//   ./camera.js                            the orbit, hold and ride
//   ./picking.js                           rays, hits and the vertex snap
//   ./widget-layers.js, ./labels.js        what extensions draw: groups, DOM labels
// It draws nothing of its own beyond the objects and the sky, listens to no
// input but the orbit's, and knows nothing about automerge: the stage
// drives it from the scene doc.

import { Color, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, PMREMGenerator, Raycaster, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { installLazyBVH } from "../pick-accel.js";
import { colorSchemeOf, onThemeChange, readTheme } from "../theme.js";
import { cleanAtmosphere, clearColourOf, LIGHTS } from "./atmosphere.js";
import { createLights, drawAtmosphere } from "./draw-atmosphere.js";
import { aimShadow, castShadows, fitShadow, SHADOW_MAP } from "./shadows.js";
import { contentOf, disposeObject, display, placeholderLook, setHint, setOutline, swapGLB } from "./object-content.js";
import { createObjectTree } from "./object-tree.js";
import { depthRange, nearestClear, sceneDepth } from "./clearance.js";
import { createCamera, toBox3 } from "./camera.js";
import { aimRay, bvhQueue, castRay, pickAt, projectPoint, screenOf } from "./picking.js";
import { addLayer, followLayers, layerMeshes, removeLayers, widgetAt } from "./widget-layers.js";
import { LabelLayer } from "./labels.js";
import { createRides } from "./ride.js";
import { realTime } from "./time.js";

const color = (rgb) => new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);

export class Viewport {
  /**
   * @param {object} o
   * @param {HTMLElement} o.port       the element the canvas and labels fill (position: relative); port-local px are its
   * @param {HTMLElement} o.themeRoot  element whose CSS variables define colours
   * @param {import("./time.js").Time} [o.time]  where frames come from (time.js): the browser's unless given
   */
  constructor({ port, themeRoot, time = realTime() }) {
    this.port = port;
    this.themeRoot = themeRoot;
    this.time = time;
    this.initState();

    const tc0 = performance.now();
    try {
      // no logarithmic depth: it writes depth from the shader, which turns off
      // the GPU's hidden-surface removal (a close look at many stacked thin
      // layers went from 20 to 250 ms a frame). Precision comes from the near
      // plane (clearance.js).
      this.renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    } catch (err) {
      this.error = err;
      // no renderer, but still a scene and a camera: extensions that only
      // need the camera's maths still work, and tests run
      this.initScene();
      return;
    }
    this.ok = true;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = SRGBColorSpace;
    // reset per frame by render(), so the stats are the main pass only
    r.info.autoReset = false;
    this.canvas = r.domElement;
    this.canvas.className = "canvas";
    // under the labels: a positioned element later in the DOM paints over earlier ones
    port.insertBefore(this.canvas, this.labels.el);

    this.initScene();
    this.pmrem = new PMREMGenerator(r);
    // The room is only needed to render the environment map once. Disposed
    // at once: left alive, its materials' programs stay registered with the
    // renderer, and three's shared DFG LUT texture keeps a dispose listener
    // that reaches them, so a closed viewport's renderer (and, through its
    // last render state, the whole scene graph) could never be collected.
    const tc1 = performance.now();
    const room = new RoomEnvironment();
    this.envTexture = this.pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    const tc2 = performance.now();
    this.scene.environment = this.envTexture;
    this.initCamera(this.canvas);

    this.readTheme();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(port);
    this.disposers.push(() => ro.disconnect());
    this.disposers.push(onThemeChange(() => this.applyTheme()));
    this.resize();

    // A frame: the loops, the ride and the orbit, the picture. A frame its
    // time says not to draw (a manual clock's steps between pictures) moves
    // all the same and only skips the render, keeping the matrices it would
    // have updated current for picking.
    const tick = (now, draw = true) => {
      this.raf = time.frame(tick);
      this.runLoops(now);
      // a ride carries the camera with what it's on, now that the loops have moved it
      const moved = this.rig.step();
      if (!(moved || this.needsRender || this.loops.size)) return;
      if (!draw) {
        this.needsRender = true;
        this.skipRender();
        return;
      }
      this.needsRender = false;
      this.render();
    };
    this.raf = time.frame(tick);
    /** what building the viewport cost (ms), for probes */
    this.perf.construct = { renderer: +(tc1 - tc0).toFixed(1), environment: +(tc2 - tc1).toFixed(1), total: +(performance.now() - tc0).toFixed(1) };
  }

  /** Everything that doesn't need WebGL or a scene graph. The labels exist even when WebGL doesn't, so syncing them is always safe. */
  initState() {
    /** owner → Set of its world-layer groups (widget-layers.js) */
    this.layers = new Map();
    /** owner → Box3 the near plane must not cut (setExtent) */
    this.extents = new Map();
    this.loops = new Set();
    /** the camera's rides (ride.js) */
    this.rides = createRides();
    this.afterHooks = new Set();
    this.themeListeners = new Set();
    this.cameraEndListeners = new Set();
    this.theme = readTheme();
    this.disposers = [];
    this.needsRender = true;
    /** what's shown, as the depth range and the shadow frame are fitted from it (fitted()); null: stale */
    this.fit = null;
    /** the extensions' atmosphere, cleaned (setAtmosphere); null: the stage's own look */
    this.atmosphere = null;
    this.atmosphereKey = "null";
    /** the sky's mesh, made the first time a sky is asked for */
    this.sky = null;
    /** the faint box every loading object's placeholder shares (object-content.js placeholderLook), made at the first */
    this.placeholder = null;
    /** does the sun cast shadows (objects cast and receive them)? */
    this.shadows = false;
    /** the sun's shadow frame now and its key (shadows.js fitShadow); key null: fit again */
    this.sunFrame = null;
    this.sunKey = null;
    /** GLB contents prepared but not attached yet (their shaders are compiling) */
    this.compiling = new Set();
    /** the last frame's main pass, from renderer.info */
    this.stats = { calls: 0, triangles: 0, lines: 0, points: 0, geometries: 0, textures: 0, frames: 0 };
    /** slow work, for probes: GLB loads (ms per step) and frames over 16 ms */
    this.perf = { loads: [], slowFrames: [] };
    this.size = { w: 1, h: 1 };
    this.ok = false;
    this.labels = new LabelLayer(this.port, () => this.invalidate());
  }

  /** The scene graph, lights and picking; no renderer needed. */
  initScene() {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(45, this.size.w / this.size.h, 0.01, 1000);
    this.camera.position.set(2.5, 2, 3.5);
    this.scene.add(this.camera);
    this.lights = createLights(this.scene, this.camera);
    this.content = new Group();
    this.content.name = "objects";
    // extensions' world groups, drawn with (and depth-tested against) the objects
    this.widgets = new Group();
    this.widgets.name = "widgets";
    this.scene.add(this.content, this.widgets);
    this.tree = createObjectTree({ root: this.content, changed: () => this.contentChanged() });
    // The on-top pass: extensions' onTop groups, drawn after the main pass
    // over a cleared depth buffer, so they're depth-tested among themselves
    // but never hidden by an object. Its own light rig, so a lit widget isn't
    // black (the main scene's lights don't reach another scene).
    this.topScene = new Scene();
    this.topScene.name = "on-top";
    this.topScene.add(new HemisphereLight(0xffffff, 0x555555, 1.2));
    const topKey = new DirectionalLight(0xffffff, 1.2);
    topKey.position.set(...LIGHTS.keyFrom);
    this.topScene.add(topKey);
    installLazyBVH();
    this.raycaster = new Raycaster();
    // with a BVH, each mesh reports only its nearest hit; picking wants just that
    this.raycaster.firstHitOnly = true;
    this.bvh = bvhQueue(this.time);
  }

  /** The camera rig, its orbit on `dom` (the canvas). */
  initCamera(dom) {
    this.rig = createCamera({ camera: this.camera, dom, rides: this.rides, worldOf: (id) => this.worldOf(id), invalidate: () => this.invalidate(), ended: (how) => this.endCamera(how) });
  }

  invalidate() {
    this.needsRender = true;
  }

  /** Something that changes the scene's extent did: the depth is fitted again before the next frame (and the shadow map redrawn). */
  contentChanged() {
    this.fit = null;
    this.invalidate();
  }

  // ─── theme ────────────────────────────────────────────────────────────────

  readTheme() {
    this.theme = readTheme(this.themeRoot);
    this.renderer?.setClearColor(this.clearColor(), 1);
    // native controls (selects, checkboxes) in the stage follow Patchwork's theme, not the OS's
    const scheme = colorSchemeOf(this.theme.bg);
    if (this.themeRoot?.style && this.themeRoot.style.colorScheme !== scheme) this.themeRoot.style.colorScheme = scheme;
  }

  /** What shows where nothing is drawn: the atmosphere's (clearColourOf), else the theme's background. */
  clearColor() {
    const c = clearColourOf(this.atmosphere);
    return c ? new Color(c) : color(this.theme.bg);
  }

  applyTheme() {
    if (!this.ok) return;
    this.readTheme();
    this.placeholder?.material.color.copy(color(this.theme.muted));
    for (const [id, entry] of this.objects) if (entry.display) this.applyDisplay(id, entry.display, entry.parentId, entry.inherited);
    this.invalidate();
    for (const fn of [...this.themeListeners]) fn(this.theme);
  }

  /** Call fn(theme) whenever the colour tokens change. @returns {() => void} off */
  onTheme(fn) {
    this.themeListeners.add(fn);
    return () => this.themeListeners.delete(fn);
  }

  // ─── layout and drawing ───────────────────────────────────────────────────

  resize() {
    if (!this.ok) return;
    const w = Math.max(1, this.port.clientWidth);
    const h = Math.max(1, this.port.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.size = { w, h };
    // Resizing clears the drawing buffer; draw now, before the browser paints,
    // rather than show a blank (or stretched) frame until the next tick.
    this.needsRender = false;
    this.render();
  }

  /** What's shown, as the depth range (clearance.js sceneDepth) and the sun's frame (its boxes) are fitted from it; worked out again after a change. */
  fitted() {
    if (!this.fit) {
      const shown = [...this.tree.shown()];
      this.fit = {
        depth: sceneDepth(shown.map(({ entry, box }) => ({ content: entry.content, box })), this.extents.values()),
        sunBoxes: shown.map(({ box }) => ({ min: box.min.toArray(), max: box.max.toArray() })),
      };
      if (this.shadows && this.renderer) this.renderer.shadowMap.needsUpdate = true;
    }
    return this.fit;
  }

  /** How near the nearest geometry is to world point p (clearance.js nearestClear). */
  nearestClear(p) {
    return nearestClear(p, this.extents.values(), this.fitted().depth.near);
  }

  /** The camera's depth range for this frame: what a render sets first, and a frame not drawn sets too (picks use it). */
  fitDepth() {
    const held = this.rig.heldDepth;
    const { clear, known } = held?.near != null ? { clear: 0, known: false } : this.nearestClear(this.camera.position);
    const { near, far } = depthRange({ dist: this.rig.focusDistance(), radius: this.fitted().depth.radius, clear, known, held });
    if (this.camera.near !== near || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /** A frame not drawn (time.js: a manual clock between pictures): everything a render updates that picking reads. */
  skipRender() {
    if (!this.ok) return;
    this.fitDepth();
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
  }

  render() {
    if (!this.ok) return;
    const tStart = performance.now();
    const r = this.renderer;
    this.followLayers();
    this.fitDepth();
    if (this.shadows) this.fitSun();

    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.w, this.size.h);
    r.autoClear = true;
    r.info.reset();
    r.render(this.scene, this.camera);
    const info = r.info;
    this.stats = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      lines: info.render.lines,
      points: info.render.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      frames: this.stats.frames + 1,
    };

    if (this.topScene.children.some((c) => c.userData?.owner !== undefined && c.visible)) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.topScene, this.camera);
      r.autoClear = true;
    }
    const size = { ...this.size };
    for (const fn of [...this.afterHooks]) {
      try {
        fn(r, size);
      } catch (err) {
        console.error("scene: an afterRender hook failed", err);
      }
      // whatever it did to the renderer's state, the next one (and the next frame) starts clean
      r.setScissorTest(false);
      r.setViewport(0, 0, this.size.w, this.size.h);
      r.autoClear = true;
    }
    this.labels.update((w) => this.screenOf(w));
    const ms = performance.now() - tStart;
    if (ms > 16 && this.perf.slowFrames.length < 500) this.perf.slowFrames.push({ at: +tStart.toFixed(1), ms: +ms.toFixed(1), calls: this.stats.calls });
  }

  // ─── atmosphere and the sun's shadows ─────────────────────────────────────

  /**
   * The world's atmosphere (CONVENTIONS.md, "Atmosphere"), drawn. null (or
   * nothing usable) is the stage's own look, exactly: no sky, no fog, the
   * key light, no shadows. Only a change does anything.
   */
  setAtmosphere(atm) {
    const next = cleanAtmosphere(atm);
    const key = JSON.stringify(next);
    if (key === this.atmosphereKey) return;
    this.atmosphereKey = key;
    this.atmosphere = next;
    if (!this.scene) return;
    this.sky = drawAtmosphere(this.scene, this.lights, this.sky, next);
    this.setShadows(!!next?.sun?.shadows);
    // a new sun direction needs a new frame
    this.sunKey = null;
    this.renderer?.setClearColor(this.clearColor(), 1);
    this.contentChanged();
  }

  /** Turn the sun's shadows on or off: the light, the renderer's shadow map, and every object casting and receiving. */
  setShadows(on) {
    if (this.shadows === on) return;
    this.shadows = on;
    this.lights.key.castShadow = on;
    this.sunKey = null;
    if (on) this.lights.key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    if (this.renderer) {
      this.renderer.shadowMap.enabled = on;
      // drawn again only when something moves or the frame does, not every frame
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = true;
    }
    for (const e of this.objects.values()) if (e.content) castShadows(e.content, on);
  }

  /** Stand the sun where its shadow map covers what the camera looks about (shadows.js fitShadow); the map is redrawn only when that lands somewhere new. */
  fitSun() {
    const sun = this.atmosphere?.sun;
    if (!sun) return;
    const fit = fitShadow(this.fitted().sunBoxes, this.rig?.focusPoint() ?? this.camera.position.toArray(), sun.direction, this.sunFrame?.radius);
    if (!fit || fit.key === this.sunKey) return;
    this.sunKey = fit.key;
    this.sunFrame = fit.frame;
    aimShadow(this.lights.key, fit.frame);
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
  }

  // ─── frames ───────────────────────────────────────────────────────────────

  /**
   * Run fn(dt, now) before every frame; while any loop is live every frame
   * renders. `first` runs it before every other loop (the stage's own, which
   * moves what's drawn before anything reads it that frame).
   * @returns {() => void} off
   */
  addLoop(fn, { first = false } = {}) {
    if (first) this.loops = new Set([fn, ...this.loops]);
    else this.loops.add(fn);
    this.invalidate();
    // without WebGL there are no frames to join: the loops get their own while there are any
    const run = (now) => {
      this.raf = this.loops.size ? this.time.frame(run) : null;
      this.runLoops(now);
    };
    if (!this.ok && !this.raf) {
      this.lastTick = null;
      this.raf = this.time.frame(run);
    }
    return () => this.loops.delete(fn);
  }

  /** The loops, one frame: dt from the last, clamped so a backgrounded tab (or a debugger pause) isn't one enormous step. */
  runLoops(now) {
    const dt = this.lastTick == null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    for (const fn of [...this.loops])
      try {
        fn(dt, now);
      } catch (err) {
        console.error("scene: a frame loop failed", err);
      }
  }

  /** Call fn(renderer, size) after the main and on-top passes of every frame drawn. @returns {() => void} off */
  afterRender(fn) {
    this.afterHooks.add(fn);
    this.invalidate();
    return () => {
      if (this.afterHooks.delete(fn)) this.invalidate();
    };
  }

  /** A box (world { min, max } or Box3) the near plane must not cut, for this owner; null removes it. */
  setExtent(owner, box) {
    const b = toBox3(box);
    if (b && !b.isEmpty()) this.extents.set(owner, b.clone());
    else if (!this.extents.delete(owner)) return;
    this.contentChanged();
  }

  // ─── widget layers ────────────────────────────────────────────────────────

  /** A new world-space group for `owner` to draw in (widget-layers.js addLayer); `under`: the node a stage's root hangs under. */
  worldLayer(owner, { onTop = false, under = null } = {}) {
    const g = addLayer(this.layers, owner, { onTop, under }, this.ok ? (onTop ? this.topScene : this.widgets) : null);
    if (under != null) this.followLayers();
    this.invalidate();
    return g;
  }

  /** Every layer that hangs under a node, where it is now (before drawing and picking). */
  followLayers() {
    followLayers(this.layers, (key) => this.worldOf(key), (key) => this.contentShown(key));
  }

  /** Is what hangs in this node's body (a link's doc) drawn now? For a stage's labels and layers. */
  contentShown(key) {
    return !this.objects.has(key) || this.isShown(key);
  }

  /** Remove and dispose every world group this owner made. */
  removeLayers(owner) {
    if (removeLayers(this.layers, owner)) this.invalidate();
  }

  /** The widget under a port-local point (widget-layers.js widgetAt). */
  pickWidget(x, y) {
    if (!this.ok) return null;
    const meshes = layerMeshes(this.layers);
    if (!meshes.length) return null;
    // a widget moved since the last frame is picked where it is now
    this.followLayers();
    this.widgets.updateMatrixWorld();
    this.topScene.updateMatrixWorld();
    return widgetAt(meshes, aimRay(this.raycaster, this.camera, this.size, x, y));
  }

  // ─── objects (object-tree.js, object-content.js) ──────────────────────────

  /** The object tree's entries by key. */
  get objects() {
    return this.tree.entries;
  }
  /** The poses held over the doc's transforms, by key. */
  get poses() {
    return this.tree.poses;
  }
  ensureObject(id) {
    return this.tree.ensure(id);
  }
  removeObject(id) {
    this.tree.remove(id);
  }
  setPose(id, transform) {
    this.tree.setPose(id, transform);
  }
  worldOf(id) {
    return this.tree.worldOf(id);
  }
  isShown(entry, opts) {
    return this.tree.isShown(entry, opts);
  }
  contentShown(key) {
    return this.tree.contentShown(key);
  }
  objectBox(id, opts) {
    return this.tree.objectBox(id, opts);
  }
  groupBox(gid, opts) {
    return this.tree.groupBox(gid, opts);
  }
  sceneBox(opts) {
    return this.tree.sceneBox(opts);
  }
  setGroups(members, n = 0) {
    if (this.tree.setGroups(members, n)) this.invalidate();
  }

  /** What the stage knows of an object's content (object-content.js contentOf), or null if it isn't here. */
  contentOf(id) {
    const e = this.objects.get(id);
    return e ? contentOf(e) : null;
  }

  /** Where an object will be before its GLB arrives (object-content.js setHint); null clears. */
  setHint(id, bounds) {
    if (!this.ok) return;
    // the placeholders' look, made the first time one is shown, in the theme as it is then
    this.placeholder ??= placeholderLook(color(this.theme.muted));
    if (setHint(this.tree.ensure(id), bounds, this.placeholder)) this.contentChanged();
  }

  /** Draw an object's box in these colours (object-content.js setOutline); null clears. */
  setOutline(id, colors) {
    const entry = this.objects.get(id);
    if (!entry) return;
    setOutline(entry, colors);
    this.invalidate();
  }

  /** Swap in a new GLB (object-content.js swapGLB): the old content stays until the new one is ready. */
  async setGLB(id, bytes) {
    if (!this.ok) return;
    const entry = this.tree.ensure(id);
    const gen = ++entry.gen;
    const took = await swapGLB(entry, bytes, {
      compile: (content) => this.renderer.compileAsync?.(content, this.camera, this.scene),
      stale: () => entry.gen !== gen || this.objects.get(id) !== entry || !this.ok,
      compiling: this.compiling,
      themeColor: () => color(this.theme.object),
    });
    if (!took) return;
    if (this.shadows) castShadows(entry.content, true);
    this.bvh.add(entry.content);
    this.contentChanged();
    if (this.perf.loads.length < 1000) this.perf.loads.push({ id, ...took });
  }

  /**
   * Display state from the scene doc (object-content.js display), under
   * `parentId`'s group (the caller has already checked for cycles: see
   * hierarchy.js). A held pose wins over the doc's transform until it's let go.
   */
  applyDisplay(id, obj, parentId = null, inherited = null) {
    if (!this.ok) return;
    const entry = this.tree.ensure(id);
    entry.parentId = parentId ?? null;
    this.tree.setParent(id, parentId);
    display(entry, obj, inherited, this.poses.get(id) ?? obj?.transform, color(this.theme.object));
    this.contentChanged();
  }

  // ─── the camera (camera.js) ───────────────────────────────────────────────

  /** The camera's forward direction, unit, world. */
  forward() {
    return this.camera.getWorldDirection(new Vector3());
  }
  /** @returns {{ position: number[], target: number[], fov: number, up: number[] } | null} */
  getCamera() {
    return this.ok ? this.rig.get() : null;
  }
  setCamera(cam) {
    if (this.ok) this.rig.set(cam);
  }
  frame(box) {
    if (this.ok) this.rig.frame(box);
  }
  /** @returns {() => void} release */
  hold() {
    return this.ok ? this.rig.hold() : () => {};
  }
  get held() {
    return !!this.rig?.held;
  }
  /** @returns {() => void} off */
  ride(id, opts) {
    return this.ok ? this.rig.ride(id, opts) : this.rides.add(id, opts, null);
  }
  bodyRide(spec) {
    if (this.ok) this.rig.bodyRide(spec);
    else this.rides.body(spec ?? null, null);
  }
  /** Call fn(camera, how) when someone stops orbiting or zooming ("orbit") or frames something ("frame"); never while the camera is held. @returns {() => void} off */
  onCameraEnd(fn) {
    this.cameraEndListeners.add(fn);
    return () => this.cameraEndListeners.delete(fn);
  }
  /** Someone finished moving the camera (`how`, as onCameraEnd says). */
  endCamera(how) {
    if (this.held) return;
    const cam = this.getCamera();
    for (const fn of [...this.cameraEndListeners]) fn(cam, how);
  }
  touched() {
    return !!this.rig?.touched();
  }

  // ─── picking (picking.js) ─────────────────────────────────────────────────

  /** The ray through a port-local point, in world. @returns {{ origin: number[], dir: number[] } | null} */
  ray(x, y) {
    if (!this.ok) return null;
    const { ray } = aimRay(this.raycaster, this.camera, this.size, x, y);
    return { origin: ray.origin.toArray(), dir: ray.direction.toArray() };
  }

  /** The ray through the middle of the port (pointer lock aims along it). */
  centerRay() {
    return this.ray(this.size.w / 2, this.size.h / 2);
  }

  /** Where a world point lands in the port, or null behind the camera or past far. */
  screenOf(world) {
    return screenOf(this.camera, this.size, world);
  }

  /** A world point in port-local px, and whether it's visible. @returns {{ x: number, y: number, visible: boolean } | null} */
  project(p) {
    return this.ok ? projectPoint(this.camera, this.size, p) : null;
  }

  /** What's under a port-local point (picking.js pickAt). */
  pick(x, y, opts) {
    if (!this.ok) return null;
    return pickAt({ raycaster: this.raycaster, camera: this.camera, size: this.size, targets: this.tree.bodies(), focusDistance: this.rig.focusDistance() }, x, y, opts);
  }

  /** The nearest shown object along a world ray, up to `far`; skip(id) → true leaves one out (picking.js castRay). */
  raycast(origin, dir, { far = Infinity, skip = null } = {}) {
    return this.ok ? castRay(this.raycaster, this.tree.bodies(skip), origin, dir, far) : null;
  }

  dispose() {
    if (!this.ok) {
      this.raf?.();
      this.loops.clear();
      this.labels?.dispose();
      return;
    }
    this.ok = false;
    this.raf?.();
    this.bvh.dispose();
    for (const d of this.disposers) d();
    this.rig.dispose();
    disposeObject(this.scene);
    disposeObject(this.topScene);
    for (const c of this.compiling) disposeObject(c);
    this.compiling.clear();
    // Whatever might still hold the renderer (three keeps its last render
    // state, which holds the camera, which is in the scene) then reaches an
    // empty scene, not every object's geometry.
    this.scene.clear();
    this.topScene.clear();
    this.placeholder?.geometry.dispose();
    this.placeholder?.material.dispose();
    this.envTexture?.dispose();
    this.pmrem?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
    this.labels.dispose();
    this.objects.clear();
    this.poses.clear();
    this.layers.clear();
    this.extents.clear();
    this.loops.clear();
    this.afterHooks.clear();
    this.themeListeners.clear();
    this.cameraEndListeners.clear();
  }
}
