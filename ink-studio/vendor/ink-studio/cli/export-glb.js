// Export model geometry with the native writer, or repackage existing glTF assets.
const fs = require('node:fs');
const path = require('node:path');
const { document, readGlb, embed } = require('./glb-file');
const files = require('./asset-files');
const writeRig = require('./glb-rig');
const writeMesh = require('./glb-mesh');

function summarize({ meshes = [], skins = [], accessors = [] }) {
  const count = i => accessors[i]?.count || 0;
  return {
    meshes: meshes.map(mesh => ({
      name: mesh.name,
      vertices: mesh.primitives.reduce((n, p) => n + count(p.attributes.POSITION), 0),
      triangles: mesh.primitives.reduce((n, p) => n + ((p.mode ?? 4) === 4 ? (count(p.indices) || count(p.attributes.POSITION)) / 3 : 0), 0),
      uvLayers: Math.min(...mesh.primitives.map(p => Object.keys(p.attributes).filter(key => /^TEXCOORD_\d+$/.test(key)).length)),
      generatedUVs: false
    })),
    joints: new Set(skins.flatMap(skin => skin.joints)).size
  };
}

function exportGlb(modelOrFile, { out, uvMargin = 0.008, textureSize = 1024 } = {}) {
  if (!out || path.extname(out).toLowerCase() !== '.glb') throw new Error('Choose an .glb output filename');
  if (!Number.isFinite(uvMargin) || uvMargin <= 0 || uvMargin >= 0.1)
    throw new Error('UV margin must be between 0 and 0.1');
  if (![0, 256, 512, 1024, 2048, 4096].includes(textureSize))
    throw new Error('Texture size must be 0, 256, 512, 1024, 2048 or 4096');
  const input = typeof modelOrFile === 'string' ? path.resolve(modelOrFile) : null, output = path.resolve(out);
  if (input === output) throw new Error('Choose an output different from the input mesh');
  const studio = require('../index'), extension = input && path.extname(input).toLowerCase();
  let bytes, report;
  if (extension === '.gltf' || extension === '.glb') {
    const original = fs.readFileSync(input);
    const { gltf, bin } = extension === '.glb' ? readGlb(original) : { gltf: JSON.parse(original.toString('utf8')) };
    const preserved = extension === '.glb' && !gltf.buffers?.some(b => b.uri !== undefined) &&
      !gltf.images?.some(i => i.uri !== undefined);
    bytes = preserved ? original : embed(gltf, input, bin);
    report = { ...summarize(gltf), preserved };
  } else {
    if (input && extension !== '.obj') throw new Error('Mesh input must be an OBJ, glTF or GLB');
    const { KIT: K } = studio.load();
    if (K.authoring.gltfAssets.is(modelOrFile))
      return { ...summarize(modelOrFile.snapshot().document), preserved: true, ...studio.writeGltfAsset(modelOrFile, { out }) };
    if (input) modelOrFile = K.model.fromMesh(studio.readMesh(input, { attributes: true }));
    const model = modelOrFile?.meshes ? modelOrFile : { meshes: [modelOrFile] };
    if (!model.meshes.length || model.meshes.some(m => !m)) throw new Error('GLB export requires a model');
    const doc = document(), rig = writeRig(doc, model, K);
    const geometry = model.meshes.flatMap(mesh => K.model.mapModelMeshes(mesh, part => part));
    const meshes = geometry.map((mesh, i) => writeMesh(doc, {
      ...mesh,
      name: mesh.name || path.parse(output).name + (geometry.length > 1 ? ' ' + (i + 1) : '')
    }, rig, K, { uvMargin, textureSize }));
    bytes = doc.finish();
    report = { meshes, joints: rig.size };
  }
  files.write(output, bytes);
  return { ...report, file: output };
}

module.exports = exportGlb;
