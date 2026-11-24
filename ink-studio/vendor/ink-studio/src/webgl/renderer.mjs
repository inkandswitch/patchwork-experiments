import { createMaterialControls } from './material-controls.mjs';
import { createLightEmitters } from './light-emitters.mjs';
import { createInspection, inspectionDepth } from './inspection.mjs';
import { waterReflectionPlan, selectReflectionWorld } from './reflections.mjs';
import { createRenderGraph, graphOwner } from './render-graph.mjs';
import { createFrameComposite, frameCamera, captureFrameCamera } from './frame-composite.mjs';
import { createSurfacePipeline } from './surfaces.mjs';
import { createResources } from './resources.mjs';
import { createTargets } from './targets.mjs';
import { createSplatPipeline } from './pipeline.mjs';
import { pixelShaderSources } from './shaders.mjs';
import { createDepthSorter, makeCamera, cameraPose, withCameraPose, captureStreamingCamera } from './view.mjs';
import { waterBackgroundShader } from './water-optics.mjs';
import { createEnvironment } from './environment.mjs';
import { environmentBackgroundShader } from './environment-shaders.mjs';
import { portalComposite } from './portal-composite.mjs';
import { createExpandedInstances, createInstanceDraw, groupVisibility } from './instance-draw.mjs';
import { instancePlan, validateSize } from './instances.mjs';
import { prepareMaskRows } from './contribution-plan.mjs';
import { createViewerInput } from './viewer-input.mjs';

const zero = new Float32Array(4);
const empty = new Float32Array(0);
const reconstructionSource = Symbol('reconstruction source');

function reconstruct(toolkit, world, frame, definition) {
  const api = toolkit.KIT?.reconstruction;
  if (!api) throw new Error('World reconstruction needs the Ink Studio KIT');
  return api.frame(world, frame.time ?? world.lookSnapshot?.time ?? 0, definition);
}
const rgb = hex => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];

function palette(values, max = 64) {
  const result = new Float32Array(max * 3);
  for (let i = 0; i < Math.min(max, values.length); i++) result.set(rgb(values[i]), i * 3);
  return result;
}

function viewProjection(projection, view) {
  const matrix = new Float32Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += projection[k * 4 + row] * view[col * 4 + k];
    matrix[col * 4 + row] = v;
  }
  return matrix;
}

function inverseView(view, eye) {
  return new Float32Array([
    view[0], view[4], view[8], 0, view[1], view[5], view[9], 0,
    view[2], view[6], view[10], 0, ...eye, 1
  ]);
}

function anchorPlane({ origin, normal: [x, y, z] }) {
  return [x, y, z, -(x * origin[0] + y * origin[1] + z * origin[2])];
}

function planeInView([x, y, z, d], { view, eye }) {
  return [view[0] * x + view[4] * y + view[8] * z, view[1] * x + view[5] * y + view[9] * z,
    view[2] * x + view[6] * y + view[10] * z, x * eye[0] + y * eye[1] + z * eye[2] + d];
}

function materialData(pixel, world) {
  const data = pixel.gpu(world);
  const lens = Float32Array.from(data.lens);
  const colors = Array.from(lens, (v, i) => Array.from(
    data.ramps.slice(i * 8, i * 8 + (Math.round(v) & 15)), Math.round));
  const group = colors.map((_, i) => i);
  const root = i => {
    while (group[i] !== i) i = group[i];
    return i;
  };
  for (let a = 0; a < lens.length; a++) for (let b = a + 1; b < lens.length; b++) {
    let shared = 0;
    for (const c of colors[a]) if (colors[b].includes(c)) shared++;
    if (shared >= 2) group[root(b)] = root(a);
  }
  lens.forEach((v, i) => { lens[i] = (Math.round(v) & 31) + root(i) * 32; });
  return { ...data, lens };
}

function simpleResolve(source) {
  return source
    .replaceAll('u_pixOn > 0.5', 'false')
    .replaceAll('u_ao > 0.0', 'false')
    .replaceAll('u_toneOn > 0.5', 'false')
    .replaceAll('u_remapLine > 0', 'false')
    .replaceAll('u_grade > 0.5', 'false')
    .replace('if (u_gk <= 0.0) return c;', 'return c;');
}

function sameValues(a, b) {
  return a?.length === b.length && b.every((value, i) => value === a[i]);
}

function createBackend(gl, toolkit, specialize, reuseOrder) {
  const resources = createResources(gl);
  const sampleCoverage = toolkit.KIT?.procedural?.sampleCoverage;
  const coverageRules = toolkit.ContributionRules ?? toolkit.KIT?.procedural?.contributionRules;
  const stableDetailAPI = toolkit.StableDetail ?? toolkit.KIT?.stableDetail;
  const cutawayAPI = toolkit.KIT?.cutaway;
  let pipeline;
  try {
    const pixelSources = options => pixelShaderSources(toolkit.PixelLook, { packedTone: true, ...options });
    const sources = pixelSources();
    const program = source => resources.program(sources.POST_VS, source);
    const post = program(sources.POST_FS), clean = program(sources.CLEAN_FS);
    // Rebirth hosts can opt into geometry specialization through the lower
    // level pipeline. The canvas path specializes its own fullscreen resolve.
    const motionAPI = toolkit.ArtDirection ?? toolkit.KIT?.artDirection;
    const airflow = toolkit.KIT?.procedural?.airflow, climateAPI = toolkit.KIT?.environmentFrame;
    pipeline = createSplatPipeline(gl, { specialize: false, sampleCoverage, coverageRules, stableDetail: stableDetailAPI, cutaway:cutawayAPI?.glsl, airflow });
    const emptyVao = resources.allocate('VertexArray');
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE), maxBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS);
    const targets = createTargets(gl, resources);
    const { target, table, textureUnit } = targets;
    const environment = createEnvironment(gl,resources,targets,maxSize,toolkit);
    const emitterLighting=createLightEmitters(gl,resources,targets,maxSize,toolkit);
    const materialControls=createMaterialControls(gl,resources,targets,maxSize,toolkit);
    const skyPrograms = new Map();
    const dryGeometry = target(2), dryContours = target(2), plainOwner = target(), key = target(1, { integer: true });
    const wetVariants = new Map();
    let graphOwnership, wetGeometry, wetContours, waterTexture, packedWater, maskOwner, glassBoundary, dryGlassGeometry, wetGlassGeometry;
    let portalSource, portalDestination, portalMask, portalSpriteLayer, portalProgram;
    let lastWater, lastWaterTime, uploadedWater, waterWidth = 0, waterHeight = 0;
    let waterLookSource, waterLookPlan, waterOpticalPlan, mappedWater;
    let opticsDefinition, opticsWorld, opticsPlan, opticsTime;
    const cleaned = target(), finished = target(), history = [target(), target()];
    const detailAPI = toolkit.DetailBudgets ?? toolkit.KIT?.detailBudgets;
    const qualityAPI = toolkit.KIT?.passQuality;
    const contract = toolkit.KIT?.renderContract;
    const lighting = toolkit.KIT?.splatRelighting, relightUnit = 21;
    const relitSprites = new Map();
    let relightData, relightRows, lastRelighting;
    const opticalUnit = 22;
    let opticalData, opticalRows, lastOptical;
    const detailPlans = new WeakMap();
    const qualityPlans = new WeakMap();
    let detailTable, uploadedDetailFlags;
    let materialStyleTable, materialStyleUpload;
    let paintOverlay, paintData, lastPaintView;
    const data = table(2048, 0, maxSize), bones = table(768, 4, maxSize);
    const fine = table(1536, 7, maxSize), pattern = table(2048, 10, maxSize);
    const toneStops = resources.texture();
    let constraintRows, constraintSlots, constraintPlan, constraintKey, constraintWorld, constraintMetadata, constraintCount, constraintMap, maskAt, constraintLab, constraintPairs;
    const contributionPost = new Map(), constrainedPosts = new Map();
    let maskSites, siteState, maskTexture, glassWorld, glassData, glassIndices;
    const rasterKeys = new WeakMap();
    let rasterKey = 0;
    const sort = createDepthSorter(), transparencyAPI = toolkit.KIT?.procedural?.splatOrder;
    const afterimagesAPI = toolkit.KIT?.afterimages;
    const afterimageHistory = afterimagesAPI?.history(), portalAfterimages = afterimagesAPI?.history();
    const mainTransparency = new WeakMap(), portalTransparency = new WeakMap();
    const previewPipelines = [];
    let surfacePipeline,emitterSurfacePipeline, reflectionTarget, secondaryReflectionTarget, reflectionAtlas, reflectionAtlasSize, reflectionAtlasFramebuffer;
    let simple, simpleUnavailable = false, keyProgram, damp, copy, spriteProgram, spriteEnvProgram, spriteLayer, spriteTable, anchors;
    let lastWorld, lastData, lastCount, lastOutput, lastDetail, lastEnvironment, lastStaged, fineValues, materials, anchorCount = 0;
    let packed = empty, historyIndex = 0, historyValid = false, previousVP, previousColorGrade, previousDetailRanges, previousSection, lastQualityKey;
    let toneKey, tone, sorted, instanceDraw, expandInstances, lastInstances;

    function orderFor(world, frame, camera, time, isNew, plan, width, height, scale,
      tolerance, histories, source, rainClocks, rainWind, quality) {
      const sceneTime = frame.time ?? world.lookSnapshot?.time ?? 0;
      const seeking = tolerance && sorted?.source === source && sorted.histories === histories && sceneTime < sorted.sceneTime;
      let history = histories.get(source);
      if (!tolerance || frame.order) histories.delete(source);
      else {
        if (!history) histories.set(source, history = transparencyAPI.history());
        if (frame.resetTransparency || seeking) history.reset();
      }
      if (frame.order) {
        pipeline.setOrder(quality ? frame.order.filter(i => quality.keep[i]) : frame.order);
        sorted = null;
        return;
      }
      const moving = world.moving ?? [], back = world.back ?? [];
      const canReuse = reuseOrder && !world.anim?.bones?.length;
      const clock = moving.length ? [time,...rainClocks,...rainWind] : [];
      const viewport = plan ? [width,height,scale,camera.tangent,camera.clipNear,+camera.ortho] : [];
      if (canReuse && !isNew && (frame.changedRows?.length === 0 || plan && !world.count && !frame.changedRows) &&
          !frame.resetTransparency && !seeking && sorted?.tolerance === tolerance && sameValues(sorted.clock,clock) &&
          (!tolerance || sorted.histories === histories) &&
          sorted.quality === quality && sorted.revision === plan?.orderRevision && sameValues(sorted.viewport,viewport) &&
          sameValues(sorted.view, camera.view) && sameValues(sorted.moving, moving) && sameValues(sorted.back, back)) {
        sorted.sceneTime = sceneTime;
        return;
      }
      const visible = plan && groupVisibility(plan,camera,width,height,scale);
      const backRows = tolerance && back.length ? new Set(back) : null;
      const { data, opticalSplats } = world;
      const stabilize = tolerance ? (order, depths) => history.sort(order, {
        data: source.data, layout: frame.instances, view: camera.view, time: sceneTime, tolerance, depthAt: i => depths[i],
        transparentAt: i => transparencyAPI.isTransparent(data, i, data[i * 16 + 3], opticalSplats?.[i * 12 + 3], backRows)
      }) : undefined;
      const order = sort(world, camera.view, time, visible, plan?.rows, stabilize, rainClocks, rainWind);
      pipeline.setOrder(quality ? order.filter(i => quality.keep[i]) : order, !!plan);
      sorted = canReuse ? { view: camera.view, moving: Int32Array.from(moving), back: Int32Array.from(back),
        clock, tolerance, sceneTime, source, histories, revision:plan?.orderRevision, viewport, quality } : null;
    }

    function prepareDetail(world, budget) {
      if (!budget?.affectsCleanup && !budget?.fineOff) return null;
      const definition = world.look.detailBudgets;
      const previous = detailPlans.get(world);
      if (previous?.definition === definition && previous.count === world.count &&
          previous.metadata === world.renderMetadata && previous.tiles === world.fine) return previous;
      const at = budget.bind(world);
      const flags = budget.affectsCleanup && Float32Array.from({ length: world.count }, (_, i) => detailAPI.flags(at(i)));
      let fine = world.fine;
      if (fine && budget.fineOff) {
        for (let i = 0; i < world.count; i++) {
          const marker = i * 12 + 11;
          if (fine[marker] && at(i)?.fine === false) {
            if (fine === world.fine) fine = fine.slice();
            fine[marker] = 0;
          }
        }
      }
      const detail = { definition, count: world.count, metadata: world.renderMetadata, tiles: world.fine,
        fine, flags: flags && flags.some(Boolean) ? flags : null };
      detailPlans.set(world, detail);
      return detail;
    }

    function prepareQualityRows(world, frame, quality, key, particleStart) {
      if (!quality?.rows) return null;
      const prior = qualityPlans.get(world);
      if (frame.changedRows?.length === 0 && prior?.key === key && prior.data === world.data &&
          prior.metadata === world.renderMetadata && prior.count === world.count && prior.particleStart === particleStart)
        return prior.selection;
      const selection = qualityAPI.planRows(world, quality, { particleStart, silhouette: frame.silhouetteProtection });
      qualityPlans.set(world, { key, data: world.data, metadata: world.renderMetadata, count: world.count, particleStart, selection });
      return selection;
    }

    function bindMaterialStyles(world, group, plan, dirtyRows) {
      const source = world.materialPixelStyles, previous = materialStyleUpload;
      const fresh = !previous || previous.group !== group || previous.source !== source ||
        previous.count !== world.count;
      if (fresh) {
        let rows = source;
        if (plan) {
          rows = new Float32Array((world.count + plan.sharedCount) * 4);
          if (source) rows.set(source.subarray(0, world.count * 4));
          for (const asset of plan.assets) if (asset.materialPixelStyles)
            rows.set(asset.materialPixelStyles, (world.count + asset.offset) * 4);
        }
        materialStyleUpload = { group, source, rows, count: world.count };
        materialStyleTable.upload(rows, (world.count + (plan?.sharedCount ?? 0)) * 4);
      } else if (dirtyRows?.length && source) {
        if (plan) for (const row of dirtyRows) {
          const from = row * 512 * 4, end = Math.min(from + 512 * 4, world.count * 4);
          previous.rows.set(source.subarray(from, end), from);
        }
        materialStyleTable.upload(previous.rows, (world.count + (plan?.sharedCount ?? 0)) * 4, dirtyRows);
      } else materialStyleTable.bind();
    }

    function resolveProgram(patterned, glass, ao, definition, grade) {
      if (!specialize || simpleUnavailable || patterned || glass || ao || definition || grade) return post;
      if (!simple) {
        try {
          simple = program(simpleResolve(sources.POST_FS));
        } catch (error) {
          if (gl.isContextLost()) throw error;
          simpleUnavailable = true;
          return post;
        }
      }
      return simple;
    }

    function fullscreen(shader, destination, width, height, values) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
      gl.viewport(0, 0, width, height);
      gl.bindVertexArray(emptyVao);
      gl.useProgram(shader.p);
      shader.set(values);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function prepareTone(definition) {
      const next = JSON.stringify(definition);
      if (toneKey !== next) {
        const prepared = definition ? toolkit.PixelLook.prepareTone(definition,
          toolkit.KIT?.procedural?.materials?.blueNoise
            ? ({ seed }) => toolkit.KIT.procedural.materials.blueNoise({ seed })
            : undefined) : null;
        if (prepared) {
          // Reserve the first row for palette stops so the resolve needs only
          // one texture for tone mapping, including in water and fog frames.
          const width = Math.max(48, prepared.width), height = prepared.height + 1;
          const table = new Float32Array(width * height * 4);
          prepared.stops.forEach(([at, hex], i) => table.set([...rgb(parseInt(hex.slice(1), 16)), at], i * 4));
          for (let y = 0; y < prepared.height; y++) for (let x = 0; x < prepared.width; x++)
            table[((y + 1) * width + x) * 4] = prepared.thresholds[y * prepared.width + x];
          textureUnit(12, toneStops);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, table);
        }
        toneKey = next;
        tone = prepared;
      }
      if (tone) {
        textureUnit(12, toneStops);
        return { u_toneOn: 1, u_toneCut: tone.cutoff, u_toneAmt: tone.amount, u_toneN: tone.stops.length,
          u_toneStops: 12, u_toneThSize: [tone.width, tone.height] };
      }
      return { u_toneOn: 0 };
    }

    function prepareConstraints(world, definition, skipMasks) {
      if (definition === undefined || definition === false) return null;
      const key = JSON.stringify([definition, world.pal, world.paletteRoles, skipMasks],(name,value)=>{
        if (name !== 'frames' || !Array.isArray(value)) return value;
        if (!rasterKeys.has(value)) rasterKeys.set(value,++rasterKey);
        return { rasterFrames:rasterKeys.get(value) };
      });
      if (key === constraintKey && world === constraintWorld && world.renderMetadata === constraintMetadata &&
          world.count === constraintCount) return constraintPlan;
      const plan = toolkit.PixelLook.preparePaletteConstraints(definition, {
        palette: world.pal, roles: world.paletteRoles, blueNoise: toolkit.KIT?.procedural?.materials?.blueNoise, skipMasks, skipDitherRegions: true,
        maskSupported:mask=>Boolean(coverageRules?.supportsMask(mask))
      });
      if (plan) {
        constraintRows ??= resources.texture();
        constraintSlots ??= table(1024, 4, maxSize);
        constraintMap = 49 + Math.ceil(Math.max(...plan.palettes.map(row => row.ranks.length)) / 4);
        maskAt = constraintMap + Math.max(...plan.palettes.map(row => (row.grade?.length ?? 0) / 3));
        plan.masked = plan.palettes.some(row => row.maskSource);
        const masks = plan.masked && prepareMaskRows(plan.palettes,coverageRules,maxSize);
        plan.textured = Boolean(masks?.texture);
        constraintLab = maskAt + (plan.masked ? 6 : 0);
        constraintPairs = constraintLab + (plan.palettes.some(row=>row.matchId) ? 48 : 0);
        const width = constraintPairs + Math.max(...plan.palettes.map(row=>row.pairs?.length ?? 0));
        const rows = new Float32Array(width * 4 * plan.palettes.length);
        plan.palettes.forEach((palette, i) => {
          const offset = i * width * 4;
          rows.set([palette.count, palette.packed.length, palette.width, palette.height], offset);
          if (!palette.mapOnly) palette.swatches.forEach((swatch, j) => rows.set(swatch, offset + (j + 1) * 4));
          rows[offset + 7] = palette.amount;
          rows[offset + 11] = Number(palette.source === 'graded');
          rows[offset + 15] = palette.mapOnly ? 2 : Number(Boolean(palette.grade));
          rows[offset + 19] = palette.matchId ?? 0;
          rows[offset + 23] = palette.pairs ? palette.pairs.length+1 : 0;
          rows[offset + 27] = palette.tuning?.scale ?? 1;
          rows[offset + 31] = palette.tuning?.screenGain ?? 1;
          // Two 24-bit words per permission fit exactly in the float texture.
          palette.reserveAccess?.forEach((access, i) => {
            const slot = palette.count + i, word = Math.floor(slot / 24), bit = 1 << (slot % 24);
            if (access & 1) rows[offset + (8 + word) * 4 + 3] += bit;
            if (access & 2) rows[offset + (10 + word) * 4 + 3] += bit;
          });
          palette.pairs?.forEach(({slots,lightness},j)=>
            rows.set([...slots,...(lightness ?? [-1,1])],offset+(constraintPairs+j)*4));
          palette.lab?.forEach((row,j)=>rows.set(row,offset+(constraintLab+j)*4));
          rows.set(palette.ranks, offset + 49 * 4);
          if (palette.grade) for (let j = 0; j < palette.grade.length / 3; j++)
            rows.set(palette.grade.subarray(j * 3, j * 3 + 3), offset + (constraintMap + j) * 4);
          if (masks?.rows?.[i]) rows.set(masks.rows[i],offset+maskAt*4);
        });
        textureUnit(8, constraintRows);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, plan.palettes.length, 0, gl.RGBA, gl.FLOAT, rows);
        constraintSlots.upload(Float32Array.from(plan.slots(world)));
        if (masks?.texture) {
          const {width,height,values} = masks.texture;
          maskTexture ??= resources.texture();
          textureUnit(14,maskTexture);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,width,height,0,gl.RED,gl.FLOAT,values);
        }
      }
      constraintKey = key;
      constraintWorld = world;
      constraintMetadata = world.renderMetadata;
      constraintCount = world.count;
      constraintPlan = plan;
      return plan;
    }

    function bindMaskSites(world,dirty) {
      maskSites ??= table(1024,10,maxSize);
      const {data,pix,renderMetadata,surfaceData,anim,count} = world, rest = world.rest ?? anim?.base ?? data;
      const sources = [world,pix,renderMetadata,surfaceData,rest,count], reusable = sameValues(siteState?.sources,sources);
      const values = reusable ? siteState.values : new Float32Array(count*8);
      const rows = reusable ? (rest === data ? dirty : []) : undefined;
      const fill = (first,end) => {
        const normals = renderMetadata?.normals;
        for (let i=first; i<end; i++) {
          const a=i*3, b=i*8, o=i*16;
          let array, at;
          if (pix?.[b]) { array=pix; at=b+3; }
          else if (normals?.[a] || normals?.[a+1] || normals?.[a+2]) { array=normals; at=a; }
          else if (surfaceData?.[b]) { array=surfaceData; at=b+1; }
          for (let n=0;n<3;n++) {
            values[b+n]=array?.[at+n]??0;
            values[b+4+n]=rest[o+n];
          }
        }
      };
      if (rows === undefined) fill(0,count);
      else for (const row of rows) fill(row*512,Math.min(count,(row+1)*512));
      maskSites.upload(values,values.length,rows);
      siteState={sources,values};
    }

    function uploadBones(values) {
      if (!values) {
        bones.bind();
        return;
      }
      if (packed.length !== values.length) packed = new Float32Array(values.length);
      for (let b = 0; b < values.length; b += 12) for (let row = 0; row < 3; row++) {
        const from = b + row * 3, to = b + row * 4;
        packed[to] = values[from];
        packed[to + 1] = values[from + 1];
        packed[to + 2] = values[from + 2];
        packed[to + 3] = values[b + 9 + row];
      }
      bones.upload(packed);
    }

    function updateSprites(world, pixel) {
      anchorCount = 0;
      const descriptions = pixel.edgeTable?.(world);
      if (!descriptions?.any || !pixel.anchors) return;
      // The toolkit caches anchors on its input. Keep that cache private to
      // this upload so a replaced material table can rebuild the sprite list.
      const { count, data, detail, pix, pats } = world;
      const points = world.reconstructionPose ? world._anchors : pixel.anchors({ count, data, detail, pix, pats });
      if (!points?.n) return;
      spriteProgram ??= resources.program(sources.SPR_VS, sources.SPR_FS);
      spriteLayer ??= target(1, { depth: true });
      spriteTable ??= resources.texture();
      anchors ??= table(768, 14, maxSize);
      const sprites = new Float32Array(12 * 96 * 4);
      for (let i = 0; i < 32; i++) sprites.set(descriptions.per.subarray(i * 8, i * 8 + 8), i * 48);
      descriptions.sprites.forEach((sprite, i) => {
        const start = (32 + i) * 48;
        sprites.set([sprite.w, sprite.h, sprite.ax, sprite.sink], start);
        sprites.set(sprite.cells.slice(0, 44), start + 4);
      });
      textureUnit(12, spriteTable);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 12, 96, 0, gl.RGBA, gl.FLOAT, sprites);
      anchors.upload(points.data);
      anchorCount = points.n;
    }

    function waterUniforms(scene, camera, time, plane, captures, width, height) {
      if (!scene) return null;
      waterTexture ??= resources.texture();
      textureUnit(3, waterTexture);
      if (scene !== uploadedWater || !packedWater) {
        const { width, height, data, uniforms } = scene.pack();
        if (width === waterWidth && height === waterHeight)
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, data);
        else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
          waterWidth = width;
          waterHeight = height;
        }
        packedWater = uniforms;
        uploadedWater = scene;
      }
      return { ...packedWater, u_waterData: 3, u_waterView: camera.view, u_waterEye: camera.eye, u_arrivalPlane: plane,
        u_waterCamera: [camera.tangent * camera.aspect, camera.tangent, +camera.ortho], u_waterTime: time,
        u_waterReflections: captures ? 23 : 0, u_waterReflectionCount: captures?.count ?? 0,
        u_waterReflectionActive: captures?.active ?? zero, u_waterReflectionHeights: captures?.heights ?? zero,
        u_waterReflectionGrid: captures?.grid ?? [2,1], u_waterReflectionViewport:[width,height], u_waterProjection:camera.projection };
    }

    function wetVariant(water, media) {
      const airPockets = Boolean(water.u_waterAirCount), layered = Boolean(water.u_waterLayered), atlas = Boolean(water.u_waterAtlas);
      const key = +airPockets + 2 * layered + 4 * atlas + 8 * Number(media);
      if (!wetVariants.has(key)) wetVariants.set(key, {
        airPockets, layered, atlas, sources: pixelSources({ water: true, airPockets, layered, atlas, environment:media })
      });
      return wetVariants.get(key);
    }
    function drawGeometry(shader, buffer, width, height, options, water, wet, env) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.framebuffer);
      gl.viewport(0, 0, width, height);
      if (options.u_paintPass) {
        gl.clearBufferfv(gl.COLOR, 0, zero);
        gl.clearBufferfv(gl.COLOR, 1, zero);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      } else if (options.u_idx) {
        gl.disable(gl.BLEND);
        if(options.u_idx===3){
          gl.clearBufferfv(gl.DEPTH,0,zero);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.GREATER);
        }
        gl.clearBufferfv(gl.COLOR, 0, zero);
        if (options.u_idx === 1 && buffer.textures.length > 1) gl.clearBufferfv(gl.COLOR,1,zero);
        if (options.u_idx === 1 && buffer.textures.length > 2) gl.clearBufferfv(gl.COLOR,2,zero);
      } else {
        if (env) {
          let programs = wet ? (wet.skyPrograms ??= new Map()) : skyPrograms;
          const glass = !!options.layeredGlass, skyKey=+glass+2*!!env.lit;
          if (!programs.has(skyKey)) programs.set(skyKey,program(wet ?
            waterBackgroundShader(wet.airPockets,wet.layered,wet.atlas,true,glass,env.lit) : environmentBackgroundShader(glass,env.lit)));
          gl.disable(gl.BLEND);
          fullscreen(programs.get(skyKey),buffer.framebuffer,width,height,{ ...water, ...env.uniforms,
            u_envViewport:[width,height],u_waterViewport:[width,height] });
        } else {
          if (water) {
            wet.background ??= program(waterBackgroundShader(wet.airPockets, wet.layered, wet.atlas));
            gl.disable(gl.BLEND);
            fullscreen(wet.background, buffer.framebuffer, width, height, { ...water,
              u_waterViewport: [width, height], u_waterBackground: options.background.slice(0, 3) });
          } else {
            gl.clearBufferfv(gl.COLOR, 0, options.background);
            gl.clearBufferfv(gl.COLOR, 1, [1, 0, 0, 1]);
          }
          if (options.layeredGlass) {
            const at = buffer.textures.length-2;
            gl.clearBufferfv(gl.COLOR,at,options.background);
            gl.clearBufferfv(gl.COLOR,at+1,[1,1,1,1]);
          }
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      const surfaces = options.surfaces, previews = options.scaleSurfaces;
      const hasSurfaces = Boolean(surfaces || previews?.some(Boolean));
      if (hasSurfaces || options.surfaceFrame?.lighting?.display) {
        const surfaceOptions = { geometryUpdatesSince: toolkit.SpriteSurface?.geometryUpdatesSince,
          updatesSince: toolkit.SpriteSurface?.updatesSince ?? toolkit.KIT?.ecology?.atlasUpdates, cutaway: cutawayAPI?.glsl };
        buffer.ensureDepth();
        gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);
        gl.clearBufferfv(gl.DEPTH,0,[1]);gl.disable(gl.BLEND);
        if (surfaces) {
          surfacePipeline ??= createSurfacePipeline(gl, surfaceOptions);
          surfacePipeline.draw(surfaces, { ...options.surfaceFrame, water, wet, width, height });
        }
        if (previews) {
          gl.depthFunc(gl.LESS);
          for (const [i, atlas] of previews.entries()) if (atlas) {
            previewPipelines[i] ??= createSurfacePipeline(gl, surfaceOptions);
            previewPipelines[i].draw(atlas, { ...options.surfaceFrame, water, wet, width, height });
          }
          gl.depthFunc(gl.LEQUAL);
        }
        if(options.surfaceFrame?.lighting?.display){emitterSurfacePipeline??=createSurfacePipeline(gl,{cutaway:cutawayAPI?.glsl});emitterSurfacePipeline.draw(options.surfaceFrame.lighting.display,{...options.surfaceFrame,lighting:null,water,wet,width,height});}
        data.bind();
        gl.depthMask(false);
        if(!options.u_idx){gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);}
      }else if(options.u_idx!==3)gl.disable(gl.DEPTH_TEST);
      gl.useProgram(shader.p);
      shader.set({
        ...options,u_geometryDepth:+hasSurfaces,
        u_paintPass: !!options.u_paintPass,
        u_materialGridScale: options.u_materialGridScale ?? 1,
        u_viewport: [width, height], u_lookViewport: [width,height],
        ...(options.lookGrid && { u_lookViewportScale: [options.lookGrid[0]/width,options.lookGrid[1]/height] }),
        u_focal: height / 2 / options.tangent
      });
      if(options.u_idx===3){
        pipeline.drawSubset(options.indices);
        gl.disable(gl.DEPTH_TEST);
      } else pipeline.draw();
      gl.disable(gl.DEPTH_TEST);gl.depthMask(true);
    }

    function drawSprites(camera, world, width, height, time, pixelOutline, water, pal, wet, clip, foreground, env, relighting, section) {
      const buffer = foreground ? portalSpriteLayer : spriteLayer;
      buffer.resize(width, height);
      data.bind();
      textureUnit(13, null);
      textureUnit(12, spriteTable);
      anchors.bind();
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.clearBufferfv(gl.COLOR, 0, zero);
      if (foreground) gl.clearBufferfv(gl.COLOR, 1, zero);
      gl.clearBufferfv(gl.DEPTH, 0, [1]);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      let sprites;
      if (relighting || section) {
        const key = [!!wet, wet?.airPockets, wet?.layered, wet?.atlas, !!env?.media, !!relighting,!!env?.lit, !!section].join('/');
        if (!relitSprites.has(key)) {
          const shaders = pixelSources({
            water: !!wet, airPockets: wet?.airPockets, layered: wet?.layered, atlas: wet?.atlas,
            environment: !!env?.media,emitterFog:!!env?.lit, relighting, cutaway:section ? cutawayAPI.glsl : undefined
          });
          relitSprites.set(key, resources.program(shaders.SPR_VS, shaders.SPR_FS));
        }
        sprites = relitSprites.get(key);
      } else sprites = wet ? (wet.sprites ??= resources.program(wet.sources.SPR_VS, wet.sources.SPR_FS)) :
        env?.media ? (spriteEnvProgram ??= resources.program(sources.SPR_VS,
          pixelSources({environment:true}).SPR_FS)) : spriteProgram;
      gl.useProgram(sprites.p);
      sprites.set({
        u_anc: 14, u_sprTex: 12, u_dat: 0, u_depth: 2, u_idxTex: 9, u_pixTex: 10,
        u_view: camera.view, u_proj: camera.projection, u_vp: [width, height],
        u_splatPlane: clip, u_spriteCover: foreground ?? zero,
        u_rng: camera.depthRange, u_time: time, u_keep: toolkit.KIT.pixel.anchorKeep(world, camera.footprint),
        u_ortho: +camera.ortho, u_rmpN4: materials.gpu.lens, u_pview: camera.view, u_peye: camera.eye,
        u_tanF: camera.tangent, u_asp: camera.aspect, u_portho: +camera.ortho,
        u_eGap: (pixelOutline?.gap ?? 0.3) / (2 * camera.radius), u_tol: 3 * camera.footprint + 0.02,
        ...water, ...env?.uniforms, ...section,
        ...(relighting && { u_relight: relightUnit }),
        ...(water || env?.media || relighting ? { u_waterSpritePalette: pal, u_rmp4: materials.gpu.ramps } : {})
      });
      gl.bindVertexArray(emptyVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, anchorCount);
      gl.disable(gl.DEPTH_TEST);
      textureUnit(13, buffer.textures[0]);
      return buffer.textures[1];
    }

    function captureWater(world, frame, camera, width, height, trailStart, quality) {
      const plan = waterReflectionPlan(world, frame, camera, width, height, toolkit.KIT?.reflection, maxSize,
        quality?.captures && (ids => qualityAPI.reflectionPlan(quality, ids)));
      if (!plan?.captures.length) return null;
      reflectionAtlas ??= resources.texture();
      const size = [plan.width*plan.grid[0],plan.height*plan.grid[1]];
      textureUnit(23,reflectionAtlas);
      if (!sameValues(reflectionAtlasSize,size)) {
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,...size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        reflectionAtlasSize=size;
      }
      // Read the current geometry each frame; no baked or manually synchronized mirror splats.
      for (const capture of plan.captures) {
        const { width, height } = capture;
        const scaled = width !== plan.width || height !== plan.height;
        const buffer = scaled ? (secondaryReflectionTarget ??= target()) : (reflectionTarget ??= target());
        buffer.resize(width, height);
        let source = world, instances = frame.instances;
        if (instances && capture.plane.select) {
          expandInstances ??= createExpandedInstances();
          source = expandInstances(world,instances,frame.changedRows).world;
          instances = undefined;
        }
        const t = frame.time ?? world.lookSnapshot?.time ?? 0;
        const time = contract?.clock(world, frame).scene ?? t;
        source = selectReflectionWorld(source,capture.plane,time,toolkit);
        render(source,{...frame,instances,order:undefined,changedRows:undefined,water:false,reflections:false,
          raw:frame.raw??false,outline:false,dither:0,damp:false,edges:false,clean:false,tone:false},
          width,height,buffer.framebuffer,capture.camera,capture.equation,undefined,true,trailStart);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,buffer.framebuffer);
        textureUnit(23,reflectionAtlas);
        const x = (capture.slot % 2) * plan.width, y = Math.floor(capture.slot / 2) * plan.height;
        if (scaled) {
          reflectionAtlasFramebuffer ??= resources.allocate('Framebuffer');
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, reflectionAtlasFramebuffer);
          gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reflectionAtlas, 0);
          gl.blitFramebuffer(0, 0, width, height, x, y, x + plan.width, y + plan.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
        } else {
          gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, x, y, 0, 0, width, height);
        }
      }
      gl.activeTexture(gl.TEXTURE0);
      return plan;
    }

    const reconstructionInstances = createExpandedInstances(), portalReconstructionInstances = createExpandedInstances();
    function reconstructFrame(world, frame, expand) {
      const definition = frame.reconstruction ?? world.look?.reconstruction;
      if (definition === undefined || definition === false) return { world, frame };
      const source = world, layout = frame.instances;
      const expanded = layout ? expand(world, layout, frame.changedRows) : null;
      const posed = reconstruct(toolkit, expanded?.world ?? world, frame, definition);
      if (posed === (expanded?.world ?? world)) return { world, frame };
      return { world: posed, frame: { ...frame, [reconstructionSource]: { source, layout }, instances: undefined,
        changedRows: undefined } };
    }

    function render(world, frame, width, height, output, cameraOverride, plane = zero, cover, reflectionCapture = false,
      reflectedTrailStart = 0) {
      const reconstruction = frame[reconstructionSource];
      const source = reconstruction?.source ?? world, histories = plane === zero ? mainTransparency : portalTransparency;
      const camera = cameraOverride ?? makeCamera(world, frame, width, height);
      if (world.shadowLod && frame.shadowArt !== false)
        world = toolkit.KIT?.shadowArt?.frame(world, camera.shadowFootprint) ?? world;
      const { raw = false, outline = true, dither = 0.35, scale = 1 } = frame;
      const transparent = frame.transparent === true;   // Patchwork: host compositing, see presentFrame
      const look = world.look ?? {};
      const clock = contract?.clock(world, frame);
      const t = clock?.time ?? frame.time ?? world.lookSnapshot?.time ?? 0;
      const time = clock?.scene ?? (frame.stepAnimation !== false && look.pixel ? Math.floor(t * 10) / 10 : t);
      if (frame.strictContract) {
        if (!contract) throw new Error('Strict frame validation needs the Ink Studio KIT');
        contract.requirePortable(world, frame);
      }
      const canStage = contract?.hasStages(world, frame) && !contract.compatibility(world, frame).length;
      const qualityDefinition = frame.passQuality ?? look.passQuality;
      if (qualityDefinition && !qualityAPI) throw new Error('Pass quality needs the Ink Studio KIT');
      const quality = qualityAPI?.prepare(qualityDefinition);
      const qualityKey = quality ? JSON.stringify([qualityDefinition, frame.silhouetteProtection ?? look.silhouetteProtection]) : '';
      const cutawayDefinition = frame.cutaway ?? look.cutaway;
      if (cutawayDefinition && !cutawayAPI) throw new Error('Cutaways need the Ink Studio KIT');
      const cutaway = cutawayAPI?.prepare(cutawayDefinition);
      const section = cutaway && cutawayAPI.uniforms(cutaway,camera.setback);
      if (!reflectionCapture && plane === zero) {
        const signature = cutaway ? JSON.stringify(cutaway) : null;
        if (signature !== previousSection) historyValid = false;
        previousSection = signature;
      }
      const detailDefinition = frame.stableDetail ?? look.stableDetail;
      if (detailDefinition && !stableDetailAPI) throw new Error('Stable detail needs the Ink Studio KIT');
      const stableDetail = stableDetailAPI?.prepare(detailDefinition);
      const detailTexture = stableDetail?.texture ?? [0,0], detailGeometry = stableDetail?.geometry ?? [0,0];
      const detailRanges = [...detailTexture,...detailGeometry];
      if (!sameValues(previousDetailRanges,detailRanges)) historyValid = false;
      previousDetailRanges = detailRanges;
      const tolerance = transparencyAPI?.transparency(frame.stableTransparency ?? look.stableTransparency)?.depthTolerance ?? 0;
      const budget = raw ? null : detailAPI?.prepare(look.detailBudgets);
      const globalCleanup = !raw && (frame.clean ?? !!look.clean);
      const needsDetailFlags = budget?.affectsCleanup && (globalCleanup || budget?.enablesCleanup);
      const constraintDefinition = frame.paletteConstraints ?? look.paletteConstraints;
      const wantsEmitters=frame.areaLights!==false&&world.areaLights?.length||Array.isArray(frame.areaLights)&&frame.areaLights.length||(frame.volumeLighting??world.volumeLighting)?.spots?.length;
      const wantsRelight = lighting && (frame.relighting ?? world.relighting);
      let group = frame.instances;
      const afterimageDefinition = frame.afterimages ?? look.afterimages;
      const trails = !reflectionCapture && !frame.order && afterimageDefinition !== undefined && afterimageDefinition !== false;
      if (trails && !afterimagesAPI) throw new Error('Afterimages need the Ink Studio KIT');
      const rules = trails ? afterimagesAPI.prepare(afterimageDefinition) : [];
      const normalCaptures = rules.length ? null : captureWater(world, frame, camera, width, height, 0, quality);
      // Per-pixel material, palette, and detail rules index the expanded world.
      if (group && (materialControls.has(world) || canStage || quality?.rows || rules.length || frame[graphOwner] || frame.order || tolerance || wantsRelight || wantsEmitters || world.opticalSplats || instancePlan(group).hasOpticalSplats || !raw && (constraintDefinition || look.pixel && world.pix ||
          needsDetailFlags || budget?.fineOn || budget?.fineOff))) {
        expandInstances ??= createExpandedInstances();
        const expanded = expandInstances(world,group,frame.changedRows);
        world = expanded.world;
        frame = { ...frame, changedRows:expanded.changedRows };
        group = undefined;
      }
      const trailHistory = frame.afterimageHistory ?? (plane === zero ? afterimageHistory : portalAfterimages);
      let trailStart = reflectedTrailStart;
      if (!reflectionCapture && (frame.resetAfterimages || !rules.length)) trailHistory?.clear();
      if (rules.length) {
        const rows = trailHistory.frame(world, t, rules, { source, layout: reconstruction?.layout ?? frame.instances, poseTime: time, bornAt: frame.bornAt,
          withdrawal: frame.sampleWithdrawal ?? world.sampleWithdrawal ?? 0 });
        if (rows.length) {
          trailStart = world.count;
          world = afterimagesAPI.append(world, rows);
        }
      }
      const captures = rules.length ?
        captureWater(world, { ...frame, instances: group }, camera, width, height, trailStart, quality) : normalCaptures;
      const portableStages = canStage && contract.stagePlan(world, frame, time, { skipMasks: frame.lookMasks === false,
        blueNoise: settings => toolkit.KIT.procedural.materials.blueNoise(settings),
        query: () => toolkit.KIT.world.query.fromScene(world, time) });
      const selection = prepareQualityRows(world, frame, quality, qualityKey, trailStart || world.count);
      const constraints = !raw && prepareConstraints(world, constraintDefinition, frame.lookMasks === false);
      const coverage = !raw && (frame.coverageAware ?? look.coverageAware) === true;
      const masked = Boolean(constraints?.masked);
      if (masked && !coverage) maskOwner ??= target(2);
      const owner = frame[graphOwner]?.depth || transparent ? (graphOwnership ??= target(3)) : masked && !coverage ? maskOwner : plainOwner;
      const sourceWater = frame.water !== false && world.water?.count ? world.water : null;
      const drivenOptics = Array.isArray(look.optics) && look.optics.some(rule => rule.driver);
      const inputTime = drivenOptics ? frame.time ?? world.lookSnapshot?.time ?? 0 : undefined;
      if (!raw && sourceWater && (look.optics !== opticsDefinition || world !== opticsWorld || inputTime !== opticsTime)) {
        opticsDefinition = look.optics;
        opticsWorld = world;
        opticsTime = inputTime;
        opticsPlan = toolkit.RenderStages?.optics(look.optics, { palette: world.pal, roles: world.paletteRoles,
          time: inputTime, query: () => world.lookSnapshot?.query ?? world.surfaceEffects?.query ??
            toolkit.KIT?.world?.query.fromScene(world, inputTime),
          blueNoise: toolkit.KIT?.procedural?.materials?.blueNoise });
      }
      const optical = raw ? null : opticsPlan;
      if (sourceWater && (sourceWater !== waterLookSource || constraints !== waterLookPlan || optical !== waterOpticalPlan)) {
        waterLookSource = sourceWater;
        waterLookPlan = constraints;
        waterOpticalPlan = optical;
        mappedWater = (constraints || optical) && sourceWater?.mapColors ?
          sourceWater.mapColors((medium, mediumKind) => optical?.transform({ kind: 'medium', medium, mediumKind }) ??
            toolkit.PixelLook.mediumTransform(constraints, { medium, mediumKind })) : sourceWater;
      }
      const waterScene = sourceWater ? mappedWater : null;
      if (waterScene) {
        wetGeometry ??= target(3);
        wetContours ??= target(3);
      }
      let layeredGlass = false;
      if (!transparent && coverage && (world.refract ?? 6)>0 && plane===zero && !cover &&
          maxBuffers >= (waterScene ? 5 : 4)) {
        if (world!==glassWorld || world.data!==glassData || frame.changedRows?.length!==0) {
          const indices=[];
          for(let i=0;i<world.count;i++)if(Math.round(world.data[i*16+11])&256)indices.push(i);
          if(!sameValues(glassIndices,indices))glassIndices=Int32Array.from(indices);
          glassWorld=world;glassData=world.data;
        }
        layeredGlass=Boolean(glassIndices?.length);
      }
      if(layeredGlass){
        glassBoundary ??= target(1,{depth:true});
        glassBoundary.resize(width,height);
        if(waterScene)wetGlassGeometry ??= target(5);
        else dryGlassGeometry ??= target(4);
      }
      const geometry = waterScene ? (layeredGlass ? wetGlassGeometry : wetGeometry) :
        (layeredGlass ? dryGlassGeometry : dryGeometry), contours = waterScene ? wetContours : dryContours;
      const isNew = world !== lastWorld || world.data !== lastData || world.count !== lastCount || group !== lastInstances;
      const pixel = toolkit.KIT?.pixel;
      const patterned = !raw && !!(look.pixel && world.pix && pixel?.gpu);
      const materialStyles = !!(world.materialPixelStyles || group && instancePlan(group).hasMaterialPixelStyles);
      const coverageSetting = frame.splatCoverage ?? look.splatCoverage ?? 'legacy';
      const splatCoverage = coverageRules?.coverageMode?.(coverageSetting) ?? ['legacy', 'continuous', 'soft'].indexOf(coverageSetting);
      if (splatCoverage < 0) throw new RangeError('Splat coverage must be legacy, continuous or soft');
      const colored = !raw && !portableStages && !patterned && !coverage && (frame.colored ?? true);
      const detail = prepareDetail(world, budget);
      const scopedCleanup = !transparent && !!needsDetailFlags && !!detail?.flags;
      const cleaning = globalCleanup || scopedCleanup;
      const damping = !raw && !portableStages && !coverage && !colored && !constraints && !!look.pixel && frame.damp !== false;
      const samples = colored ? 2 : 1, rw = width * samples, rh = height * samples;
      if (rw > maxSize || rh > maxSize ||
          rw > viewportLimit[0] || rh > viewportLimit[1])
        throw new RangeError('Ink Studio frame exceeds the WebGL viewport or texture size limit');
      if (!output) {
        if (gl.canvas.width !== width) gl.canvas.width = width;
        if (gl.canvas.height !== height) gl.canvas.height = height;
      }
      const resized = width !== finished.width || height !== finished.height;
      if (isNew || qualityKey !== lastQualityKey || resized || output !== lastOutput || detail !== lastDetail || !damping || waterScene !== lastWater ||
          (waterScene && frame.time !== lastWaterTime)) historyValid = false;
      geometry.resize(rw, rh);
      contours.resize(colored ? width : 1, colored ? height : 1);
      const ownsPixels = transparent || !!frame[graphOwner] || patterned || !!constraints && !coverage || scopedCleanup;
      owner.resize(ownsPixels ? width : 1, ownsPixels ? height : 1);
      if (scopedCleanup) detailTable ??= table(512, 7, maxSize);
      if (materialStyles) materialStyleTable ??= table(512, 16, maxSize);
      key.resize(patterned ? width : 1, patterned ? height : 1);
      if (cover && patterned && frame.edges !== false) portalSpriteLayer ??= target(2, { depth: true });
      if (cleaning) cleaned.resize(width, height);
      if (damping) {
        finished.resize(width, height);
        history.forEach(buffer => buffer.resize(width, height));
      }

      const paint = world.paintCorrections;
      let geometryData = world.data, paintActive = false;
      if (paint && frame.paintCorrections !== false) {
        if (paintData?.length !== world.count * 16) paintData = new Float32Array(world.count * 16);
        paintData.set(world.data.subarray(0, world.count * 16));
        const { view: m, ortho, eye } = camera;
        paintActive = paint.paint(paintData, world.pal,
          { direction: [m[2], m[6], m[10]], ...(ortho ? {} : { eye }) });
        geometryData = paintData;
      }
      const paintView = paintActive ? camera.view : undefined;
      if (portableStages) geometryData = contract.materialData(portableStages, world, geometryData);
      if ((paintView || lastPaintView) && (!paintView || !lastPaintView || !sameValues(paintView, lastPaintView)))
        historyValid = false;
      lastPaintView = paintView;
      const paintOnPatterns = patterned && (paintActive || !!trailStart || !!world.opticalSplats);
      if (paintOnPatterns) {
        paintOverlay ??= target(2);
        paintOverlay.resize(width, height);
      }
      const clip = plane === zero ? zero : planeInView(plane, camera);
      const direction = clock?.direction ?? motionAPI?.prepare(look.artDirection,frame.artDirection);
      const motion = clock ?? motionAPI?.motion(direction,t,frame.skyTime ?? t,time);
      const rainClocks = motion ? [motion.falling, motion.rain] : [time,time];
      const hasCadence = rainClocks.some(value => value !== time) ||
        ['foliage','cloth','rain','water','emissive'].some(key => direction?.cadence[key] !== undefined);
      const windResponse = direction?.windResponse;
      const useWind = climateAPI && airflow && (hasCadence || windResponse?.water || windResponse?.emissive) &&
        (frame.windField ?? world.windField ?? world.weatherBinding);
      let flex = () => [0,0], rainWind = [0,0];
      if (useWind) {
        const sampled = climateAPI.timeline(world,frame,t,direction,toolkit.KIT?.weather?.tracks);
        const weather = climateAPI.opticalWeather(world,frame,sampled,frame.weatherFronts !== false);
        const air = climateAPI.wind(world,frame,{ ...sampled, weather });
        const velocity = (channel) => air.windAt?.(direction?.cadence[channel] === undefined ? sampled.skyTime :
          frame.skyTime ?? motion[channel]) ?? air.wind.velocity;
        flex = channel => airflow.frame(velocity(channel)).flex;
        if (direction?.cadence.rain !== undefined) rainWind = velocity('rain');
      }
      const water = waterUniforms(waterScene, camera, motion?.water ?? time, plane, captures, width, height);
      if (water) water.u_waterWindGain = (windResponse?.water ?? 0) * Math.hypot(...flex('water'));
      const env = environment.prepare(world,frame,camera,t,width,height,reflectionCapture);
      if (env || lastEnvironment) historyValid = false;
      lastEnvironment = !!env;
      const wet = water && wetVariant(water,!!env?.media);
      const opticalMaterials = !!world.opticalSplats;
      if (opticalMaterials) {
        const K = toolkit.KIT;
        opticalRows = K.optical.frame(world, camera, K.splatFrames.create(world, time, K.M), null, opticalRows);
        opticalData ??= table(1536, opticalUnit, maxSize);
        opticalData.upload(opticalRows);
      }
      if (opticalMaterials || lastOptical) historyValid = false;
      lastOptical = opticalMaterials;
      let relighting = false;
      if (wantsRelight) {
        const K = toolkit.KIT;
        const timeline = K.environmentFrame.timeline(world, frame, t,
          K.artDirection.prepare(look.artDirection, frame.artDirection), K.weather?.tracks);
        const active = lighting.frame(world, frame, timeline);
        if (active) {
          const next = lighting.rows(world, active, K.splatFrames.create(world, time, K.M), null, relightRows);
          if (next) {
            relightRows = next;
            relightData ??= table(512, relightUnit, maxSize);
            relightData.upload(next);
            relighting = true;
          }
        }
      }
      const emitterFrame=emitterLighting.prepare(world,frame,t,reflectionCapture,camera);
      relighting=emitterLighting.compose(emitterFrame,world,time,relightRows,relighting);
      emitterLighting.fog(emitterFrame,world,frame);
      if(emitterFrame){historyValid=false;if(env){env.emitters=emitterFrame;env.uniforms={...env.uniforms,...emitterFrame.uniforms};}}
      if(env)env.lit=!!(env.lit&&emitterFrame);
      if (relighting || lastRelighting) historyValid = false;
      lastRelighting = relighting;
      const fineTiles = detail?.fine ?? world.fine;
      const hasFine = !raw && !!fineTiles;
      const pal = palette(world.pal);
      const palCount = Math.min(world.pal.length, 64);
      const fog = transparent ? {} : world.fog ?? {};
      // An editor may provide a row diff against the exact bake currently on the GPU.
      const incremental = frame.previousWorld && frame.previousWorld === lastWorld &&
        lastWorld.data === lastData && world.count === lastCount && !group && !lastInstances &&
        !paint && !lastWorld.paintCorrections && !world.anim && !lastWorld.anim;
      const dirty = !isNew || incremental ? frame.changedRows : undefined;
      const geometryDirty = portableStages || lastStaged ? undefined : dirty && paint ?
        [...new Set([...dirty, ...paint.dirtyRows.filter(row => row * 512 < world.count)])] : dirty;
      let plan;
      if (group) {
        instanceDraw ??= createInstanceDraw(table,data,maxSize);
        plan = instanceDraw.bind(group, world, geometryDirty, lastInstances !== group, geometryData);
      } else data.upload(geometryData, world.count * 16, geometryDirty);
      if (materialStyles) bindMaterialStyles(world, group, plan, dirty);
      if (hasFine && (isNew || fineValues !== fineTiles)) {
        const fineDirty = incremental && !detail && fineValues === lastWorld.fine ? frame.changedFineRows : undefined;
        fine.upload(fineTiles, world.count * 12, fineDirty);
        fineValues = fineTiles;
      } else fine.bind();
      uploadBones(world.anim?.bones);
      relighting=materialControls.compose(world,frame,camera,time,relighting);
      if(materialControls.has(world))historyValid=false;
      orderFor(world, frame, camera, time, isNew, plan, width, height, scale, tolerance, histories, source, rainClocks, rainWind, selection);
      if (patterned) {
        if (isNew || materials?.world !== world || materials.values !== world.pix ||
            materials.ramps !== world.ramps || materials.rampOff !== world.rampOff || materials.patterns !== world.pats) {
          const patternDirty = incremental && materials?.world === lastWorld &&
            materials.values === lastWorld.pix ? frame.changedPatternRows : undefined;
          pattern.upload(world.pix, world.count * 8, patternDirty);
          const gpu = materialData(pixel, world);
          updateSprites(world, pixel);
          materials = { world, values: world.pix, ramps: world.ramps, rampOff: world.rampOff, patterns: world.pats, gpu };
        } else if (world.anim?.dynamicPatternNormals) {
          const patternDirty = dirty && [...new Set(dirty.map(row => Math.floor(row / 2)))];
          pattern.upload(world.pix, world.count * 8, patternDirty);
        } else pattern.bind();
      }

      const paletteFrame = toolkit.PixelLook.framePalette?.(world, frame, { grading: !raw && !portableStages, tone: !raw && !coverage }) ??
        { toneDefinition: raw || coverage ? null : frame.tone ?? look.tone, grade: frame.ignoreLookGrade ? undefined : world.anim?.grade };
      const { toneDefinition: definition, colorGrade } = paletteFrame;
      const grade = reflectionCapture ? null : paletteFrame.grade;
      if (masked) bindMaskSites(world,dirty);
      if (constraints?.textured) textureUnit(14,maskTexture);
      if (constraints && (coverage || masked)) {
        constraintSlots.bind(9);
        textureUnit(8,constraintRows);
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      gl.blendEquation(gl.FUNC_ADD);
      const shader = pipeline.programFor({
        water: !!wet, airPockets: wet?.airPockets, layered: wet?.layered, atlas: wet?.atlas, portal: plane !== zero || !!cover,
        instances: !!plan, contributions:coverage && !!constraints, masked, textured:constraints?.textured, layeredGlass,
        materialStyles, environment:env?.media,emitterFog:!!env?.lit, relighting, optical:opticalMaterials, cutaway:!!section,
        hostDepth:transparent
      });
      gl.useProgram(shader.p);
      const growth = world.grow ?? {};
      shader.set({
        u_data: 0, u_bones: 4, u_fine: 7, ...(plan && { u_instances: 15 }), u_fineOn: +hasFine, u_fpal: pal, u_view: camera.view,
        ...(materialStyles && { u_materialStyles: 16, u_materialPatterned: patterned, u_materialStylesOn: !raw }),
        u_proj: camera.projection, u_time: time, u_scale: scale, u_ortho: +camera.ortho,
        u_motionCadence: hasCadence, u_rainWind:rainWind,
        u_motionWind: !!useWind && (direction?.cadence.foliage !== undefined || direction?.cadence.cloth !== undefined),
        ...(hasCadence && { u_effectTimes:[motion.foliage,motion.cloth,rainClocks[0],motion.emissive],
          u_waterAndRainTime:[motion.water,rainClocks[1]] }),
        ...(useWind && { u_effectWind:[...flex('foliage'),...flex('cloth')] }),
        u_emissiveWind:(windResponse?.emissive ?? 0) * Math.hypot(...flex('emissive')),
        ...(constraints && (coverage || masked) && { u_constraintSlots:9,u_constraintRows:8,
          u_constraintDefault:constraints.defaultSlot,u_constraintMap:constraintMap,u_constraintMask:maskAt,u_constraintLab:constraintLab,u_constraintPairs:constraintPairs,
          u_lookSites:10,u_maskTextures:14,u_maskTime:t,u_lookProjection:camera.projection,u_lookRadius:camera.radius,u_lookOrtho:+camera.ortho,
          u_pal:pal,u_n:palCount,u_grade:+Boolean(grade),u_out:grade??pal,u_toneOn:0,u_lookGrid:[width,height] }),
        u_arrivalPlane: plane, u_splatPlane: clip, ...(layeredGlass&&{u_glassBoundary:13,u_glassTolerance:tolerance}),
        u_sampleWithdrawal: sampleCoverage?.amount(frame.sampleWithdrawal ?? world.sampleWithdrawal ?? 0) ?? 0,
        u_born: [frame.bornAt ?? 0, growth.rate ?? 1, growth.fade ?? 0.5, growth.loop ?? 0],
        u_detailTexture: detailTexture, u_detailGeometry: detailGeometry,
        u_crisp: +!raw, u_splatCoverage: splatCoverage, u_dilate: raw ? 0.3 : 0.15, u_near: camera.clipNear,
        u_paintMarker: paint?.marker ?? 0, u_afterimageStart: trailStart,
        ...(opticalMaterials && { u_optical: opticalUnit }),
        ...(relighting && { u_relight: relightUnit }),
        u_fog: rgb(world.pal[fog.c ?? 0] ?? 0),
        u_fogp: [fog.start ?? 1, fog.max ?? 0, ...camera.depthRange], ...water, ...env?.uniforms, ...section
      });
      const background = transparent ? [0, 0, 0, 0] : [...rgb(world.pal[0]), 1], tangent = camera.tangent;
      const surfaces = frame.spriteSurfaces === false ? null : world.spriteSurfaces;
      const preview = frame.spriteSurfaces !== false && frame.scalePreviews !== false && world.scalePreviews;
      const previewAPI = toolkit.KIT?.procedural?.lod?.preview;
      if (preview && !previewAPI) throw new TypeError('Scale previews need the Ink Studio KIT');
      const scaleSurfaces = preview ? previewAPI.surfaces(preview, {
        view: camera.view, width, height, focal: height / (2 * tangent), ortho: camera.ortho,
        near: camera.clipNear, far: camera.clipFar
      }, reflectionCapture || plane !== zero ? undefined : frame.scalePreviewFrame) : undefined;
      const surfaceFrame={lighting:emitterFrame,environment:env,view:camera.view,projection:camera.projection,range:[...camera.depthRange,fog.start??1,fog.max??0],
        fog:rgb(world.pal[fog.c??0]??0),arrivalPlane:plane,clip,section};
      if(layeredGlass){
        textureUnit(13,null);
        const indices = selection ? glassIndices.filter(i => selection.keep[i]) : glassIndices;
        drawGeometry(shader,glassBoundary,width,height,{u_idx:3,u_snap:1,u_hard:0,tangent,indices});
        textureUnit(13,glassBoundary.textures[0]);
      }
      drawGeometry(shader, geometry, rw, rh, { u_idx: 0, u_snap: +(!raw && !colored), u_hard: 0,
        u_materialGridScale: samples, background, tangent, lookGrid:coverage&&[width,height],layeredGlass,surfaces,scaleSurfaces,surfaceFrame }, water, wet, env);
      if (colored)
        drawGeometry(shader, contours, width, height, { u_idx: 0, u_snap: 1, u_hard: 0, background, tangent,surfaces,scaleSurfaces,surfaceFrame }, water, wet, env);
      if (paintOnPatterns) {
        drawGeometry(shader, paintOverlay, width, height, { u_idx: 0, u_snap: 1, u_hard: 0, u_paintPass: true,
          tangent, lookGrid: coverage && [width, height] }, water, wet, env);
      }
      if (ownsPixels)
        drawGeometry(shader, owner, width, height, { u_idx: 1, u_snap: 1, u_hard: 0, tangent,surfaces,scaleSurfaces,surfaceFrame:{...surfaceFrame,index:true,graphDepth:Boolean(frame[graphOwner]?.depth) || transparent} });
      frame[graphOwner]?.(world, owner.textures[0], frame[graphOwner].depth ? owner.textures[2] : undefined, camera);
      if (cover)
        drawGeometry(shader, cover.buffer, width, height,
          { u_idx: 2, u_snap: +(!raw && !colored), u_hard: 0, u_splatPlane: cover.plane, tangent, surfaces, scaleSurfaces, surfaceFrame:{...surfaceFrame,index:true,clip:cover.plane} });
      gl.disable(gl.BLEND);
      textureUnit(1, geometry.textures[0]);
      textureUnit(2, geometry.textures[1]);
      textureUnit(5, paintOnPatterns ? paintOverlay.textures[0] : contours.textures[0]);
      textureUnit(6, paintOnPatterns ? paintOverlay.textures[1] : contours.textures[1]);
      textureUnit(9, owner.textures[0]);
      const pixelOutline = look.outline === true ? {} : look.outline;
      const mat = materials?.gpu;
      const patternedUniforms = patterned ? {
        u_idxTex: 9, u_pixTex: 10, u_dat: 0, u_depth: 2, u_tanF: tangent,
        u_portho: +camera.ortho, u_asp: camera.aspect, u_pview: camera.view, u_peye: camera.eye,
        u_fpG: camera.footprint, u_ptime: time, u_shape: +(frame.lightShape !== false),
        u_ol: +!!pixelOutline, u_olK: pixelOutline?.k ?? 2,
        u_olEps: pixelOutline ? (pixelOutline.eps ?? 0.6) / (world.detail || 12) / (2 * camera.radius) : 0,
        u_olGap: pixelOutline ? (pixelOutline.gap ?? 0.3) / (2 * camera.radius) : 1,
        u_patK4: mat.kinds, u_patP: mat.params, u_rmp4: mat.ramps, u_rmpN4: mat.lens, u_detail: world.detail || 12
      } : {};
      if (patterned) {
        keyProgram ??= program(sources.KEY_FS);
        textureUnit(15, null);
        pattern.bind();
        fullscreen(keyProgram, key.framebuffer, width, height, { u_pixOn: 1, ...patternedUniforms });
      }
      textureUnit(15, key.textures[0]);
      const sprites = patterned && anchorCount > 0 && frame.edges !== false;
      const spriteCover = sprites && drawSprites(camera, world, width, height, time, pixelOutline, water, pal, wet, clip, cover?.plane, env,
        relighting, section);
      const lines = outline && look.lines;
      const lineIndex = world.outline?.c ?? 0;
      const glass = raw ? null : world.glass;
      const glassUniforms = {};
      if (glass) {
        const gaps = new Float32Array(24 * 4), count = Math.min(24, glass.gaps?.length ?? 0);
        if (count) for (let i = 0; i < count; i++) gaps.set(glass.gaps[i], i * 4);
        Object.assign(glassUniforms, {
          u_gview: camera.view, u_geye: camera.eye, u_gd: glass.dir,
          u_gw: [...glass.at, glass.r], u_gcam: [tangent * camera.aspect, tangent, ...camera.depthRange],
          u_gortho: +camera.ortho, u_gtime: t, u_gc: palette(glass.cols.map(c => world.pal[c]), 6),
          u_gm: +(glass.mode === 'gaps'), u_gq: glass.steps ?? 0,
          u_gh: gaps, u_ghn: count, u_gfl: glass.floor ?? -50
        });
      }
      const destination = damping ? finished.framebuffer : output;
      let resolve;
      const styledPattern = patterned && materialStyles;
      const relitPattern = patterned && relighting;
      if (transparent || coverage || constraints || styledPattern || relitPattern || env?.media && patterned) {
        const cache = coverage ? contributionPost : constrainedPosts;
        const mode = (wet ? 1+Number(wet.airPockets)+2*Number(wet.layered)+4*Number(wet.atlas) : 0) +
          16*Number(masked) + 32*Number(layeredGlass) + 64*Number(styledPattern) + 128*Number(!!constraints) +
          256*Number(!!env?.media) + 512*Number(relitPattern)+1024*Number(!!env?.lit)+2048*Number(transparent);
        if (!cache.has(mode)) cache.set(mode,program(pixelSources({
          water:!!wet,airPockets:wet?.airPockets,layered:wet?.layered,atlas:wet?.atlas,
          paletteConstraints:!!constraints && !coverage,masked,contributions:coverage,layeredGlass,materialStyles:styledPattern,
          environment:!!env?.media,emitterFog:!!env?.lit,relighting:relitPattern,transparent
        }).POST_FS));
        resolve = cache.get(mode);
        if (constraints && !coverage) {
          constraintSlots.bind();
          textureUnit(8,constraintRows);
          if (masked) textureUnit(7, owner.textures[1]);
        }
      } else resolve = wet ? (wet.post ??= program(wet.sources.POST_FS)) : resolveProgram(patterned, glass, world.ao, definition, grade);
      if (water) textureUnit(11, (colored ? contours : geometry).textures[2]);
      if (transparent) textureUnit(17, owner.textures[2]);   // packed owner depth for the second output
      if (layeredGlass) {
        const at = geometry.textures.length - 2;
        textureUnit(4, geometry.textures[at]);
        textureUnit(7, geometry.textures[at + 1]);
        textureUnit(8, glassBoundary.textures[0]);
      }
      fullscreen(resolve, cleaning ? cleaned.framebuffer : destination, width, height, {
        ...patternedUniforms, ...glassUniforms, ...prepareTone(definition), ...water, ...env?.uniforms, u_waterMask: 11,
        ...(layeredGlass&&{u_glassBoundary:8,u_glassBack:4,u_glassThrough:7,
          u_glassRange:camera.depthRange,u_glassProjection:camera.projection}),
        ...(constraints ? { u_constraintSlots: 4, u_constraintRows: 8, u_constraintDefault: constraints.defaultSlot,
          u_constraintMap: constraintMap, u_constraintMask: maskAt, u_constraintLab: constraintLab, u_constraintPairs: constraintPairs, u_maskOwner: 7 } : {}),
        u_scene: 1, u_depth: 2, u_crispScene: 5, u_crispDepth: 6, u_keyTex: 15,
        u_pixOn: +patterned, u_keyOn: +patterned, u_sprOn: +sprites,
        u_paintOn: paintOnPatterns,
        ...(styledPattern && { u_materialStyles: 16 }),
        ...(relitPattern && { u_relight: relightUnit, u_relightFog: rgb(world.pal[fog.c ?? 0] ?? 0),
          u_relightFogRange: [fog.start ?? 1, fog.max ?? 0] }),
        u_idxTex: 9,
        u_sprLayer: 13, u_markA: +cleaning, u_pal: pal, u_n: palCount, u_luma: 0,
        u_bypass: +(raw || !!portableStages), u_colored: +colored, u_dither: dither * 0.3 * (world.dither ?? 1),
        u_line: rgb(world.pal[lineIndex] ?? 0),
        u_remapLine: colorGrade && Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < palCount ? lineIndex + 1 : 0,
        u_edge: outline ? (world.outline?.edge ?? 0) / (2 * camera.radius) : 0,
        u_lines: +!!lines, u_lineGap: lines ? (lines.gap ?? 0.3) / (2 * camera.radius) : 1,
        u_lineK: lines ? (lines.k ?? 0.55) : 1, u_lineLit: lines ? (lines.lit ?? 1.15) : 1,
        u_refract: world.refract ?? 6, u_ao: world.ao ? (world.ao.k ?? 0.5) : 0,
        u_aor: (world.ao?.range ?? 0.4) / (2 * camera.radius),
        u_gk: glass ? (glass.k || 0.14) : 0, u_bars: Math.min(0.45, world.anim?.bars ?? 0),
        u_grade: +!!grade, ...(grade ? { u_out: grade, u_outl: grade } : {}),
        ...(transparent && { u_ownerDepth: 17 })
      });
      if (cleaning) {
        if (scopedCleanup) {
          if (uploadedDetailFlags !== detail.flags) {
            detailTable.upload(detail.flags);
            uploadedDetailFlags = detail.flags;
          } else detailTable.bind();
        }
        textureUnit(8, cleaned.textures[0]);
        textureUnit(6, colored ? contours.textures[1] : geometry.textures[1]);
        fullscreen(clean, destination, width, height, {
          u_look: 8, u_dep: 6, u_keep: look.clean?.keep ?? 0.3,
          u_scopedOnly: !globalCleanup, u_hasDetailFlags: scopedCleanup,
          u_detailOwners: scopedCleanup ? 9 : 8, u_detailFlags: scopedCleanup ? 7 : 8,
          u_detailWater: scopedCleanup && !!water, u_waterMask: scopedCleanup && water ? 11 : 8,
          u_lineClean: +(frame.lineClean !== false && !!look.pixel)
        });
      }
      if (damping) {
        damp ??= program(sources.DAMP_FS);
        copy ??= program(sources.COPY_FS);
        const activeColorGrade = colorGrade || empty;
        if (!sameValues(previousColorGrade, activeColorGrade)) historyValid = false;
        previousColorGrade = activeColorGrade;
        const next = 1 - historyIndex, vp = viewProjection(camera.projection, camera.view);
        const still = previousVP && vp.every((v, i) => Math.abs(v - previousVP[i]) < 1e-6);
        textureUnit(8, finished.textures[0]);
        textureUnit(11, history[historyIndex].textures[0]);
        textureUnit(6, geometry.textures[1]);
        fullscreen(damp, history[next].framebuffer, width, height, {
          u_cur: 8, u_hist: 11, u_dep: 6, u_pal: colorGrade || pal, u_n: palCount,
          u_have: +(historyValid && !!still), u_iview: inverseView(camera.view, camera.eye),
          u_pvp: previousVP ?? vp, u_cam: [tangent, camera.aspect, +camera.ortho, 0],
          u_rng: camera.depthRange
        });
        textureUnit(8, history[next].textures[0]);
        fullscreen(copy, output, width, height, { u_src: 8 });
        historyIndex = next;
        historyValid = true;
        previousVP = vp;
      }
      gl.activeTexture(gl.TEXTURE0);
      lastWorld = world;
      lastInstances = group;
      lastData = world.data;
      lastStaged = Boolean(portableStages);
      lastCount = world.count;
      lastOutput = output;
      lastDetail = detail;
      lastQualityKey = qualityKey;
      lastWater = waterScene;
      lastWaterTime = frame.time;
      if (!reflectionCapture) {
        frame[frameCamera]?.(camera);
        frame[inspectionDepth]?.(world, geometry.textures[1], camera);
      }
      return spriteCover;
    }

    function present(world, frame, width, height, output) {
      const { portal, fade = 0 } = frame;
      if (!portal && !fade) return render(world, frame, width, height, output);
      const camera = makeCamera(world, frame, width, height), opening = portal?.opening;
      const front = opening && planeInView(anchorPlane(opening.from), camera);
      const visible = front && (camera.ortho ? front[2] > 1e-7 : front[3] > 1e-6);
      if (!visible && !fade) return render(world, frame, width, height, output, camera);
      if (width > maxSize || height > maxSize || width > viewportLimit[0] || height > viewportLimit[1])
        throw new RangeError('Ink Studio frame exceeds the WebGL viewport or texture size limit');
      if (!output) {
        if (gl.canvas.width !== width) gl.canvas.width = width;
        if (gl.canvas.height !== height) gl.canvas.height = height;
      }
      portalSource ??= target();
      portalSource.resize(width, height);
      if (visible) {
        portalDestination ??= target();
        portalMask ??= target();
        portalDestination.resize(width, height);
        portalMask.resize(width, height);
        const nextCamera = withCameraPose(camera, opening.camera(cameraPose(camera)));
        const { raw, outline, dither, scale, clean, lineClean, colored, tone, edges, water, time, skyTime, cameraTime,
          stepAnimation, artDirection, renderStages, strictContract, environment,
          stableTransparency, resetTransparency, stableDetail, passQuality, silhouetteProtection, scalePreviews } = frame;
        const destination = reconstructFrame(portal.destination, { raw, outline, dither, scale, clean, lineClean, colored, tone,
          edges, water, time, skyTime, cameraTime, stepAnimation, artDirection, renderStages, strictContract,
          environment, stableTransparency, resetTransparency, stableDetail, passQuality,
          silhouetteProtection, scalePreviews, ...portal.destinationFrame, damp: false },
          portalReconstructionInstances);
        render(destination.world, destination.frame, width, height, portalDestination.framebuffer, nextCamera, anchorPlane(opening.to));
      }
      const spriteCover = render(world, visible ? { ...frame, damp: false } : frame, width, height,
        portalSource.framebuffer, camera, zero, visible ? { buffer: portalMask, plane: front } : undefined);
      portalProgram ??= program(portalComposite);
      textureUnit(0, portalSource.textures[0]);
      textureUnit(1, visible ? portalDestination.textures[0] : portalSource.textures[0]);
      textureUnit(2, visible ? portalMask.textures[0] : portalSource.textures[0]);
      textureUnit(3, spriteCover || portalSource.textures[0]);
      fullscreen(portalProgram, output, width, height, { u_source: 0, u_destination: 1,
        u_cover: 2, u_spriteCover: 3, u_hasSpriteCover: +!!spriteCover,
        u_opening: visible ? (opening.shape === 'ellipse' ? 2 : 1) : 0, u_size: [width, height], u_fade: fade,
        ...(visible ? { u_origin: opening.from.origin, u_right: opening.from.right, u_up: opening.from.up,
          u_normal: opening.from.normal, u_half: [opening.halfWidth, opening.halfHeight],
          u_eye: camera.eye, u_portalView: camera.view, u_far: camera.clipFar,
          u_settings: [camera.tangent * camera.aspect, camera.tangent, +camera.ortho] } : {}) });
      gl.activeTexture(gl.TEXTURE0);
    }
    const viewportLimit = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    let composite;
    function presentMixed(world, frame, width, height, output) {
      const definition = frame.composite ?? world.look?.composite;
      if (definition === undefined || definition === false) return present(world, frame, width, height, output);
      const api = toolkit.KIT?.frameComposite;
      if (!api) throw new Error('Mixed-resolution frames need the Ink Studio KIT');
      const plan = api.prepare(definition, width, height, world.look?.pixelSize ?? 1);
      if ([plan, plan.world].some(({ w, h }) => w > Math.min(maxSize, viewportLimit[0]) ||
          h > Math.min(maxSize, viewportLimit[1])) || plan.layers.some(({ w, h }) => w > maxSize || h > maxSize))
        throw new RangeError('Composite frame exceeds the WebGL viewport or texture size limit');
      const time = frame.interfaceTime ?? frame.time ?? world.lookSnapshot?.time ?? 0;
      let camera;
      const drawFrame = plan.needsCamera ? { ...frame, ...captureFrameCamera(frame, view => { camera = view; }) } : frame;
      const layers = plan.needsCamera ? () => api.layers(plan, world, time, camera, gl, frame.time) : api.layers(plan, world, time, undefined, gl, frame.time);
      composite ??= createFrameComposite(gl, { program, resources, target, textureUnit, fullscreen });
      composite(world, drawFrame, plan, layers, output, present);
    }
    let renderGraph;
    function presentGraph(world, frame, width, height, output) {
      const definition = frame.renderGraph ?? world.look?.renderGraph;
      if (definition === false || definition === undefined) {
        renderGraph?.reset();
        return presentMixed(world, frame, width, height, output);
      }
      const api = toolkit.KIT?.renderGraph;
      if (!api) throw new Error('Render graphs need the Ink Studio KIT');
      const plan = api.prepare(definition);
      if (!plan?.passes.length) {
        renderGraph?.reset();
        return presentMixed(world, frame, width, height, output);
      }
      if (width > Math.min(maxSize, viewportLimit[0]) || height > Math.min(maxSize, viewportLimit[1]))
        throw new RangeError('Render graph exceeds the WebGL viewport or texture size limit');
      renderGraph ??= createRenderGraph(gl, { api, program, resources, target, textureUnit, fullscreen, maxSize });
      renderGraph(world, frame, plan, width, height, output, presentMixed);
    }
    let inspection;
    function presentFrame(world, frame, width, height, output) {
      frame = contract?.options(world, frame, toolkit.KIT.timeDomains?.frame) ??
        { ...frame, time: frame.time ?? frame.t };
      const source = frame.renderHistoryKey ?? world;
      ({ world, frame } = reconstructFrame(world, frame, reconstructionInstances));
      if (source !== world) frame = { ...frame, renderHistoryKey: source };
      const presentation = toolkit.KIT?.presentationTimeline?.sample(world, frame.interfaceTime ?? frame.time ?? world.lookSnapshot?.time ?? 0, frame);
      if (presentation) frame = { ...frame, ...presentation };
      // Patchwork: a transparent frame is composited by the host with its own
      // sky, water and fog, straight into a two-attachment target (colour,
      // packed depth). Single-pass only: no wrappers, captures or history.
      if (frame.transparent === true) return render(world, { ...frame, water: false, reflections: false,
        environment: false, colored: false, damp: false, clean: false }, width, height, output);
      const definition = frame.inspection ?? world.look?.inspection;
      if (definition === undefined || definition === false) return presentGraph(world, frame, width, height, output);
      const api = toolkit.KIT?.inspection;
      if (!api) throw new Error('Target inspection needs the Ink Studio KIT');
      const settings = api.prepare(definition);
      if (!settings.targets.length) return presentGraph(world, frame, width, height, output);
      inspection ??= createInspection(gl, { api, program, resources, target, textureUnit, fullscreen, maxSize, viewportLimit });
      inspection(world, frame, settings, width, height, output, presentGraph);
    }
    return { render: presentFrame, dispose() {
      surfacePipeline?.dispose();
      for (const preview of previewPipelines) preview?.dispose();
      emitterSurfacePipeline?.dispose();
      pipeline.dispose();
      resources.dispose();
    } };
  } catch (error) {
    pipeline?.dispose();
    resources.dispose();
    throw error;
  }
}

export function createRenderer(canvas, { toolkit, specialize = true, reuseOrder = true, contextAttributes, input } = {}) {
  if (typeof canvas?.getContext !== 'function')
    throw new TypeError('Ink Studio needs a canvas or OffscreenCanvas');
  if (typeof toolkit?.PixelLook?.glsl !== 'string')
    throw new TypeError('Pass the Ink Studio toolkit, including PixelLook, to createRenderer');
  const gl = canvas.getContext('webgl2', {
    ...contextAttributes, alpha: false, antialias: false, depth: false, stencil: false
  });
  if (!gl) throw new Error('Ink Studio GPU rendering requires WebGL 2');
  let backend = createBackend(gl, toolkit, specialize, reuseOrder);
  let controls;
  if(input!==undefined&&input!==false) {
    try { controls=createViewerInput(canvas,{...input,toolkit}); }
    catch(error){ backend.dispose();throw error; }
  }
  let disposed = false, picking, streamAssemblies = new WeakMap();
  const pickInstances = createExpandedInstances();
  const lose = event => {
    event.preventDefault();
    // The restored context cannot delete or reuse the old resources.
    backend = null;
  };
  canvas.addEventListener?.('webglcontextlost', lose);
  function validateWorld(world, frame) {
    if (!(world?.data instanceof Float32Array) || !Number.isSafeInteger(world.count) ||
        world.count < 0 || world.count * 16 > world.data.length || !world.pal?.length)
      throw new TypeError('Render expects a world with packed splats, a count, and a palette');
    if (world.fine && world.fine.length < world.count * 12 || world.pix && world.pix.length < world.count * 8)
      throw new RangeError('Ink Studio material data is shorter than the splat count');
    if (world.materialPixelStyles != null && (!(world.materialPixelStyles instanceof Float32Array) ||
        world.materialPixelStyles.length < world.count * 4))
      throw new RangeError('Ink Studio material pixel styles must cover the splat count');
    if (world.opticalSplats != null && (!(world.opticalSplats instanceof Float32Array) ||
        world.opticalSplats.length !== world.count * 12))
      throw new RangeError('Ink Studio optical materials must match the splat count');
    const plan = frame.instances === undefined ? null : instancePlan(frame.instances);
    if (plan) validateSize(world.count,plan);
    const logicalCount = world.count + (plan?.count ?? 0);
    if (frame.order !== undefined &&
        (!(frame.order instanceof Int32Array) || frame.order.length !== logicalCount ||
         frame.order.some(index => index < 0 || index >= logicalCount)))
      throw new TypeError('Draw order must contain valid Int32 splat indices');
    for (const [key, perRow] of [['changedRows', 512], ['changedFineRows', 512], ['changedPatternRows', 1024]]) {
      const rows = frame[key];
      if (rows !== undefined && (!Array.isArray(rows) || rows.some(row =>
        !Number.isInteger(row) || row < 0 || row >= Math.max(1, Math.ceil(world.count / perRow)))))
        throw new RangeError(key + ' must contain valid ' + perRow + '-splat row indices');
    }
    if (![frame.time ?? frame.t ?? 0, frame.bornAt ?? 0, frame.scale ?? 1, frame.dither ?? 0.35].every(Number.isFinite))
      throw new RangeError('Ink Studio frame parameters must be finite');
  }
  const api = {
    ...(controls&&{input:controls}),
    describeFrame(world, frame = {}) {
      const contract = toolkit.KIT?.renderContract;
      if (!contract) throw new Error('Frame descriptions need the Ink Studio KIT');
      const width = frame.width ?? frame.w ?? frame.target?.width ?? canvas.width;
      const height = frame.height ?? frame.h ?? frame.target?.height ?? canvas.height;
      const description = contract.describe(world, { ...frame, width, height }, toolkit.KIT.timeDomains?.frame);
      if (frame.viewMatrix === undefined) return description;
      // Patchwork: report the host camera that render() will use.
      const camera = makeCamera(world, frame, width, height);
      return { ...description, camera: { ...description.camera, pose: cameraPose(camera), ortho: false,
        tangent: camera.tangent, clipNear: camera.clipNear, clipFar: camera.clipFar, setback: 0 } };
    },
    cameraPose(world, frame = {}) {
      return cameraPose(makeCamera(world, frame, frame.width ?? frame.w ?? frame.target?.width ?? canvas.width,
        frame.height ?? frame.h ?? frame.target?.height ?? canvas.height));
    },
    renderStream(stream, cameraWorld, { place, portals = [], selected, assemble, ...frame } = {}) {
      if (disposed) throw new Error('The Ink Studio renderer has been disposed');
      if (typeof stream?.advance !== 'function' || typeof assemble !== 'function')
        throw new TypeError('Stream rendering needs a scene stream and a world assembler');
      const width = frame.width ?? frame.w ?? frame.target?.width ?? canvas.width;
      const height = frame.height ?? frame.h ?? frame.target?.height ?? canvas.height;
      const { snapshot, camera } = captureStreamingCamera(cameraWorld, frame, width, height);
      const scene = stream.advance({ place, camera, portals, selected, portalLimit: 1 });
      const previous = streamAssemblies.get(stream), current = new Map();
      function worldFor({ id, place, entries }) {
        const saved = previous?.assemble === assemble && previous.worlds.get(id);
        const same = saved?.place === place && entries.length === saved.entries.length &&
          entries.every((row, i) => {
            const old = saved.entries[i];
            return old.key === row.key && old.revision === row.revision && old.value === row.value;
          });
        const world = same ? saved.world : assemble(place, entries);
        if (world?.count > entries.reduce((sum, row) => sum + row.splats, 0))
          throw new RangeError('Assembled scene exceeds its packed splat budget');
        current.set(id, { place, entries, world });
        return world;
      }
      const world = worldFor(scene.views[0]), next = scene.views[1];
      const portal = next?.entries.length ? { opening: next.opening, destination: worldFor(next) } : undefined;
      api.render(world, { ...frame, cameraSnapshot: snapshot, portal });
      streamAssemblies.set(stream, { assemble, worlds: current });
      return { world, portal, scene };
    },
    render(world, frame = {}) {
      if (disposed) throw new Error('The Ink Studio renderer has been disposed');
      if (gl.isContextLost()) throw new Error('The Ink Studio WebGL context is lost');
      validateWorld(world, frame);
      if (frame.portal) {
        const { source, destination, opening, destinationFrame = {} } = frame.portal;
        if ((source && source !== world) || typeof opening?.camera !== 'function' || !opening.from || !opening.to)
          throw new TypeError('Expected an oriented portal view for the rendered world');
        validateWorld(destination, destinationFrame);
      }
      if (frame.fade !== undefined && (!Number.isFinite(frame.fade) || frame.fade < 0 || frame.fade > 1))
        throw new RangeError('Scene fade opacity must be in [0, 1]');
      const target = Array.isArray(frame.target) || ArrayBuffer.isView(frame.target) ? undefined : frame.target;
      const width = frame.width ?? frame.w ?? target?.width ?? canvas.width;
      const height = frame.height ?? frame.h ?? target?.height ?? canvas.height;
      const output = target?.framebuffer ?? null;
      if (target && (width !== target.width || height !== target.height || !output || !gl.isFramebuffer(output)))
        throw new TypeError('Draw target must match the frame size and use the renderer WebGL context');
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
        throw new RangeError('Ink Studio frame width and height must be positive integers');
      backend ??= createBackend(gl, toolkit, specialize, reuseOrder);
      backend.render(world, frame, width, height, output);
      if (picking?.world === world && (frame.changedRows?.length !== 0 || world.anim?.bones?.length)) picking = undefined;
    },
    pick(world, ray, frame = {}) {
      if (disposed) throw new Error('The Ink Studio renderer has been disposed');
      validateWorld(world,frame);
      const create = toolkit.KIT?.procedural?.contributions?.create;
      if (!create) throw new Error('Contribution picking needs the Ink Studio KIT');
      const group = frame.instances, revision = group && instancePlan(group).revision;
      const time = frame.time ?? frame.t ?? world.lookSnapshot?.time ?? 0;
      const withdrawal = frame.sampleWithdrawal ?? world.sampleWithdrawal ?? 0;
      const splatCoverage = frame.splatCoverage ?? world.look?.splatCoverage;
      const materialStyles = world.materialPixelStyles;
      const marks = world.dataMarks?.snapshot();
      const definition = frame.reconstruction ?? world.look?.reconstruction;
      const reconstruction = definition === undefined || definition === false ? undefined : JSON.stringify(definition);
      if (picking?.world !== world || picking.data !== world.data || picking.count !== world.count || picking.opticalSplats !== world.opticalSplats ||
          picking.group !== group || picking.revision !== revision || picking.withdrawal !== withdrawal ||
          picking.splatCoverage !== splatCoverage || picking.materialStyles !== materialStyles || picking.marks !== marks ||
          picking.reconstruction !== reconstruction || picking.time !== time &&
            (reconstruction !== undefined || world.moving?.length || world.grow || world.anim?.bones)) {
        let posed = group ? pickInstances(world, group, frame.changedRows).world : world;
        if (reconstruction !== undefined) posed = reconstruct(toolkit, posed, frame, definition);
        const picker = create(posed, { time, sampleWithdrawal: withdrawal, splatCoverage, cutaway:false });
        picking = { world, data: world.data, count: world.count, opticalSplats: world.opticalSplats,
          group, revision, time, withdrawal, reconstruction, splatCoverage, materialStyles, marks, picker };
      }
      const section = toolkit.KIT.cutaway?.prepare(ray?.cutaway ?? frame.cutaway ?? world.look?.cutaway);
      let camera = ray?.camera;
      if (section?.range && !camera) {
        const view = makeCamera(world,frame,frame.width ?? frame.target?.width ?? canvas.width,
          frame.height ?? frame.target?.height ?? canvas.height);
        camera = { ...cameraPose(view),setback:view.setback };
      }
      return picking.picker.ray({ water:frame.water !== false,...ray,cutaway:section,camera });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      streamAssemblies = new WeakMap();
      try { controls?.dispose(); }
      finally {
        backend?.dispose();
        canvas.removeEventListener?.('webglcontextlost', lose);
      }
    }
  };
  return api;
}
