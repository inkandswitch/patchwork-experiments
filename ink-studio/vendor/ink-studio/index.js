// ink-studio: sculpt with signed distance, bake to pixel-art gaussian splats, and look at the result without a browser.
// The sources are plain scripts (they are concatenated into a web page as they stand), so this file offers them three ways:
//   files()   the library's source files, in the order they must be loaded
//   bundle()  those files as one piece of text, to put in a page or in front of your own scripts
//   load()    the same compiled for Node, with the demo dioramas: { makeBuilder, makeSculpt, KIT, SCENES, ... }
const fs = require('fs'),
  path = require('path'),
  { randomUUID } = require('crypto');
const KIT_DIR = path.join(__dirname, 'src', 'kit'),
  read = f => fs.readFileSync(f, 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');
const files = () =>
  [
    'src/randomness.js', 'src/fft.js', 'src/math-fields.js', 'src/typography-truetype.js', 'src/typography.js', 'src/frame-budget.js', 'src/target-inspection.js', 'src/drawing-primitives.js', 'src/view-annotations.js', 'src/frame-composite.js', 'src/ink-veil.js', 'src/textured-surface.js', 'src/sprite-surface.js', 'src/camera-atlas.js', 'src/sprite-cels.js', 'src/atlas-sprites.js', 'src/target-selectors.js', 'src/camera-lens.js', 'src/camera-impulses.js', 'src/camera-staging.js', 'src/splat-provenance.js',
    'src/art-passes.js', 'src/art-direction.js', 'src/art-ink.js', 'src/art-effects.js', 'src/art-stability.js', 'src/stable-detail.js', 'src/edge-filter.js', 'src/material-pixel-style.js',
    'src/color-space.js', 'src/paint-corrections.js', 'src/color-curves.js', 'src/color-lut.js', 'src/color-stack.js', 'src/pixel-look.js', 'src/palette-fields.js', 'src/palette-extract.js', 'src/palette-distributions.js', 'src/reflection-plane.js', 'src/airflow.js', 'src/wind-field.js', 'src/light-schedule.js', 'src/geometric-caustics.js', 'src/light-cookies.js', 'src/area-lights.js', 'src/emissive-finishes.js',
    'src/route-visibility.js', 'src/sample-coverage.js', 'src/contribution-rules.js', 'src/sample-visibility.js', 'src/swept-disc.js', 'src/splat-order.js', 'src/cutaway.js', 'src/splat-codec.js', 'src/ripple-field.js',
    'src/volume-field.js', 'src/field-bands.js', 'src/atmosphere-palette.js', 'src/geometry-density.js', 'src/volume-cutouts.js', 'src/cloud-recipes.js', 'src/cloud-detail.js', 'src/cloud-field.js', 'src/lightning.js', 'src/volume-light.js', 'src/celestial-tracks.js', 'src/sky-environment.js', 'src/environment-frame.js', 'src/weather-front.js', 'src/weather-binding.js', 'src/optical-materials.js', 'src/atmosphere-depth-bands.js', 'src/scene-optics.js', 'src/scene-exposure.js', 'src/splat-effects.js',
    'src/look-inputs.js', 'src/render-effects.js', 'src/render-graph.js', 'src/render-stages.js', 'src/render-contract.js', 'src/effect-palettes.js', 'src/silhouette-protection.js', 'src/pass-quality.js', 'src/detail-budgets.js', 'src/shadow-art.js', 'src/reflection-probes.js', 'src/contact-shadows.js', 'src/bounce-probes.js', 'src/horizon-bands.js', 'src/surface-detail-kits.js', 'src/surface-look.js', 'src/material-controls.js', 'src/splat-frames.js', 'src/splat-relighting.js', 'src/sdf-assist.js', 'src/sculpt-sampling.js', 'src/builder.js', 'src/sculpt.js'
  ]
    .map(f => path.join(__dirname, f))
    .concat(
      fs
        .readdirSync(KIT_DIR)
        .filter(f => f.endsWith('.js'))
        .sort()
        .map(f => path.join(KIT_DIR, f))
    );
const demoFiles = () => [path.join(__dirname, 'demos', 'labscenes.js')];
// the names the bundle defines at top level (add them to your own module.exports)
const EXPORTS =
  'Typography, Randomness, MathFields, MaterialControls, CameraLens, CameraImpulses, makeBuilder, makeSculpt, basis, flame, motes, pondMat, lilies, courses, PALETTES, PAL_HEX, KIT, FrameBudget, InkVeil, TexturedSurface, SpriteSurface, TargetSelectors, SplatProvenance, ColorSpace, PaintCorrections, ColorCurves, ColorLUT, ColorStack, PixelLook, PaletteFields, LookInputs, RenderStages, ContributionRules, SurfaceDetailKits, SurfaceLook, SceneOptics, ReflectionProbes, SceneExposure, SkyEnvironment, AtmospherePalette, EnvironmentFrame, CelestialTracks, CloudField, Lightning, VOX, SplatEffects, ArtPasses, ArtDirection, ArtInk, EffectPalettes, SilhouetteProtection, DetailBudgets, ContactShadows, BounceProbes, LightCookies, AreaLights, EmissiveFinishes, HorizonBands, ArtStability, StableDetail, EdgeFilter, ArtEffects, VolumeField, VolumeLight';
module.exports = {
  files,
  demoFiles,
  EXPORTS,
  version: require('./package.json').version,
  bundle: ({ format = 'script' } = {}) => {
    if (format !== 'script' && format !== 'module') throw Error('Ink bundle format must be script or module');
    const sources = files().map(read).join('\n');
    return format === 'module' ? sources + '\nexport { ' + EXPORTS + ' };\n' : sources;
  },
  // the seven built-in demo dioramas. They push onto an array called SCENES, which must already exist
  demos: () => demoFiles().map(read).join('\n'),
  // refuse-to-build check: code written after a // comment on the same line never runs. Returns the offending lines
  lint: require('./scripts/lint.js'),
  // a mesh file from disk, by its ending: .obj (with the .mtl beside it), .gltf (with its .bin files), .glb
  readMesh(file, { attributes = false } = {}) {
    const K = module.exports.load().KIT,
      ext = path.extname(file).toLowerCase(),
      dir = path.dirname(file);
    if (ext === '.obj') {
      const text = fs.readFileSync(file, 'utf8'),
        m = /^mtllib\s+(.+)$/m.exec(text),
        mf = m && path.join(dir, m[1].trim());
      const mtl = mf && fs.existsSync(mf) ? fs.readFileSync(mf, 'utf8') : null;
      const mesh = K.mesh.obj(text, mtl, { attributes });
      if (attributes && mtl && mesh.uvs) {
        let name;
        const textures = new Map();
        for (const raw of mtl.split('\n')) {
          const entry = /^(newmtl|map_Kd)\s+(.+)$/.exec(raw.trim());
          if (!entry) continue;
          if (entry[1] === 'newmtl') name = entry[2];
          else if (name && !entry[2].startsWith('-')) {
            const image = path.resolve(path.dirname(mf), entry[2].replace(/^["']|["']$/g, ''));
            const mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[path.extname(image).toLowerCase()];
            if (mimeType && fs.existsSync(image)) textures.set(name, { bytes: fs.readFileSync(image), mimeType });
          }
        }
        mesh.mats = mesh.mats.map(m => ({ ...m, texture: textures.get(m.name) }));
      }
      return mesh;
    }
    if (ext === '.glb') return K.mesh.glb(fs.readFileSync(file));
    if (ext === '.gltf') {
      const g = JSON.parse(fs.readFileSync(file, 'utf8'));
      return K.mesh.gltf(
        g,
        (g.buffers || []).map(b =>
          b.uri && !b.uri.startsWith('data:') ? fs.readFileSync(path.join(dir, decodeURIComponent(b.uri))) : null
        )
      );
    }
    throw new Error('do not know how to read ' + ext + ' (obj, gltf and glb are read)');
  },
  async readAsset(file, options = {}) {
    if (path.extname(file).toLowerCase() !== '.glb') throw Error('Portable asset import expects a GLB file');
    const decodeImage = options.decodeImage || ((bytes, mime) => {
      if (mime !== 'image/png') throw Error('Supply decodeImage to import embedded JPEG images');
      const image = require('./cli/png.js').raster(Buffer.from(bytes));
      return { width: image.w, height: image.h,
        pixels: image.max === 255 ? image.data : Uint8Array.from(image.data, v => Math.round(v * 255 / image.max)) };
    });
    return module.exports.load().KIT.authoring.assetMeshes.importGLB(
      new Uint8Array(fs.readFileSync(file)), { ...options, decodeImage });
  },
  readDataInputs(file) {
    const { KIT } = module.exports.load(), api = KIT.dataInputs;
    const input = JSON.parse(fs.readFileSync(file, 'utf8')), bundles = KIT.authoring.projectBundles;
    const { dataInputs } = input?.format === bundles.format ? bundles.open(input).scene() : input;
    if (dataInputs === undefined) throw new TypeError('Expected a dataInputs catalog in ' + file);
    return api.prepare(require('./cli/data-inputs.js').embed(api, dataInputs, file));
  },
  exportGlb: require('./cli/export-glb.js'),
  ...require('./cli/gltf-asset.js'),
  render: require('./cli/render.js').render,
  ...require('./cli/graph-project.js'),
  ...require('./cli/graph-host.js'),
  readWav: require('./cli/wav.js').read,
  decodeWav: require('./cli/wav.js').decode,
  encodeWav: require('./cli/wav.js').encode,
  ...require('./cli/graph-render.js'),
  paletteUsage: require('./cli/palette-usage.js').paletteUsage,
  reviewRampShot: require('./cli/ramp-review.js').reviewRampShot,
  comparePaletteDistributions: require('./cli/palette-distributions.js').comparePaletteDistributions,
  measureQuantizationError: require('./cli/palette-error.js').measureQuantizationError,
  reviewQuantizationError: require('./cli/palette-error.js').reviewQuantizationError,
  inspectPalettePixel: require('./cli/palette-pixel.js').inspectPalettePixel,
  reviewPaletteShimmer: require('./cli/palette-shimmer.js').reviewPaletteShimmer,
  reviewSubjectReadability: require('./cli/readability-review.js').reviewSubjectReadability,
  reviewPaletteWeather: require('./cli/palette-weather.js').reviewPaletteWeather,
  reviewPaletteStages: require('./cli/palette-stages.js').reviewPaletteStages,
  compareShotPalettes: require('./cli/palette-compare.js').compareShotPalettes,
  checkPaletteShot: require('./cli/palette-checks.js').checkPaletteShot,
  exportLayers: require('./cli/export-layers.js').exportLayers,
  exportScene: require('./cli/scene-export.js').exportScene,
  readSceneReplay: require('./cli/scene-replay.js').readSceneReplay,
  sampleSceneReplay: require('./cli/scene-replay.js').sampleSceneReplay,
  writeSceneEmbed: require('./cli/scene-replay.js').writeSceneEmbed,
  ...require('./cli/project-bundle.js'),
  describeRenderFrame: (world, frame) => require('./src/render-contract.js').describe(world, frame),
  createCameraAtlas(options) {
    return module.exports.load().KIT.cameraAtlas.raster(options, (world, frame) => {
      const { width: w, height: h, time: t, camera, cameraSnapshot, ...settings } = frame;
      if (cameraSnapshot !== undefined || camera?.pose !== undefined)
        throw new TypeError('Headless camera atlas views use orbit camera settings');
      const ortho = camera?.ortho ?? (camera?.projection === undefined ? settings.ortho :
        camera.projection === 'orthographic');
      return module.exports.render(world, { ...settings, ...camera, ortho, w, h, t, px: 1 });
    });
  },
  bakeBounceProbes: (world, settings) => module.exports.load().KIT.bounceProbes.bake(world, settings),
  inspectEnvironment: require('./cli/environment-inspector.js').inspectEnvironment,
  silhouetteReview: require('./cli/silhouette-review.js').silhouetteReview,
  transitionReview: require('./cli/transition-review.js').transitionReview,
  spriteAtlas: require('./cli/sprite-atlas.js').spriteAtlas,
  readSpriteAtlas: require('./cli/sprite-atlas.js').readSpriteAtlas,
  writeSpriteAtlas: require('./cli/sprite-atlas.js').writeSpriteAtlas,
  readHorizonBands: require('./cli/horizon-bands.js').readHorizonBands,
  readEnvironmentImage: require('./cli/horizon-bands.js').readEnvironmentImage,
  previewTimeline: require('./cli/animation-timeline.js').previewTimeline,
  readRasterAsset(file) {
    return require('./cli/raster-asset.js').readRasterAsset(file, module.exports.load().KIT.procedural.graph.raster);
  },
  readReferencePalette(file, options) {
    return require('./src/palette-extract.js').extract(require('./cli/png.js').paletteSource(file), options);
  },
  writeRasterAsset: require('./cli/raster-asset.js').writeRasterAsset,
  createSceneEditor(source, options) {
    return module.exports.load().KIT.authoring.sceneEditor.create(source, options);
  },
  createSplatPicker(world, options = {}) {
    const K = module.exports.load().KIT;
    const time = options.time ?? world.lookSnapshot?.time ?? 0;
    const posed = K.reconstruction.frame(world, time, options.reconstruction ?? world.look?.reconstruction);
    return K.procedural.contributions.create(posed, options);
  },
  createSimulationWorkers: require('./src/simulation-worker-pool.js'),
  openCheckpointStore: require('./src/simulation-checkpoint-store.js').openCheckpointStore,
  load() {
    const out = path.join(__dirname, 'dist', 'standalone.js'),
      srcs = files().concat(demoFiles()),
      newest = Math.max(...srcs.map(f => fs.statSync(f).mtimeMs));
    if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < newest) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      // Parallel consumers may compile together. Publish only complete bundles.
      const temporary = out + '.' + randomUUID() + '.tmp';
      try {
        fs.writeFileSync(
          temporary,
          module.exports.bundle() +
            '\nconst SCENES = [];\n' +
            module.exports.demos() +
            '\nmodule.exports = { SCENES, ' +
            EXPORTS +
            ' };\n'
        );
        fs.renameSync(temporary, out);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    }
    return require(out);
  }
};
