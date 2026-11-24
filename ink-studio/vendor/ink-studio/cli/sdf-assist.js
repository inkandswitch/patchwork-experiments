const { slab } = require('../src/scene-optics.js');
const { surfacePoint } = require('./scene-optics.js');
const TargetSelectors = require('../src/target-selectors.js');
const OpticalMaterials = require('../src/optical-materials.js');

const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const opaqueFlags = 15 | 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 32768;

function normalAt(field, [x,y,z], step) {
  const n = [field(x+step,y,z)-field(x-step,y,z),field(x,y+step,z)-field(x,y-step,z),field(x,y,z+step)-field(x,y,z-step)];
  const length = Math.hypot(...n);
  return length > 1e-10 && Number.isFinite(length) ? n.map(v=>v/length) : null;
}

function bind(world, data, settings) {
  const labels = TargetSelectors.index(world), rows = [];
  const normals = world.renderMetadata?.normals;
  const boned = new Set(world.anim?.boned ?? []), owned = world.anim?.geometryOwned;
  const { nearest } = require('../index.js').load().KIT.procedural.attributes;
  const sources = [];
  for (const source of world.renderSdfs) {
    if (!(source.rows instanceof Map) || typeof source.distance !== 'function' || typeof source.locate !== 'function') continue;
    const parts = new Map();
    let selected = false;
    for (const [owner,ranges] of source.rows) {
      const part = { records:[], points:[] };
      for (const [start,end,points] of ranges) for (let i=start;i<Math.min(end,world.count);i++) {
        const q = i*16, offset = (i-start)*3;
        if (data[q] !== points[offset] || data[q+1] !== points[offset+1] || data[q+2] !== points[offset+2]) continue;
        if (owned?.[i] || data[q+3]<1 || Math.round(data[q+11]) & opaqueFlags || boned.has(i) || world.anim?.rig?.bid?.[i] ||
            world.opticalSplats?.[i*OpticalMaterials.STRIDE+3]) continue;
        const target = {object:owner.renderOwner,entity:owner.renderOwner,material:owner.mat.materialId,
          surface:owner.mat.surfaceId ?? owner.mat.surface?.id,
          ...(owner.tag && {tags:[owner.tag]}),...owner.renderTarget,...labels.row(i)};
        const reach = 3*Math.sqrt(Math.max(0,data[q+4]+data[q+8]+data[q+10]));
        const row = {i,part,target,reach,point:Array.from(data.subarray(q,q+3)),
          normal:normals && normals.subarray(i*3,i*3+3)};
        part.records.push(row);
        part.points.push(row.point);
        if (settings.candidates(target)) {
          rows[i]=row;
          selected=true;
        }
      }
      if (part.records.length) parts.set(owner,part);
    }
    if (selected) sources.push({...source,parts});
  }
  for (const source of sources) for (const part of source.parts.values())
    part.nearest = nearest({points:part.points,entities:part.records,read:i=>part.records[i]});
  return {sources,rows};
}

const facing = (row,normal) => !row.normal || dot(row.normal,row.normal)<1e-8 || dot(row.normal,normal)>.25;
function trace(source, ray, near, far, settings, clip) {
  const {origin,direction,axial} = ray, {min,max} = source.bounds, {epsilon,steps} = settings;
  const range = [near/axial,far/axial];
  for (let k=0;k<3;k++) if (!slab(range,origin[k],direction[k],min[k],max[k])) return null;
  const point = origin.slice(), field = source.distance;
  let along=range[0];
  for (let j=0;j<steps && along<=range[1];j++) {
    for (let k=0;k<3;k++) point[k]=origin[k]+along*direction[k];
    const distance = field(...point);
    if (!Number.isFinite(distance)) return null;
    if (Math.abs(distance)>epsilon) {
      along+=Math.abs(distance)*.7;
      continue;
    }
    let normal;
    if ((!clip || clip(point)) && (!source.accepts || source.accepts(...point))) {
      const {body,owner} = source.locate(...point);
      const part = source.parts.get(owner) ?? source.parts.get(body);
      if (part && (normal=normalAt(field,point,epsilon))) {
        const row = part.nearest.sample(point,i=>facing(part.records[i],normal))?.values;
        if (row && settings.allows(row.target,point)) return {z:along*axial,position:point,normal,row};
      }
    }
    along+=6*epsilon/Math.max(.12,normal ? Math.abs(dot(normal,direction)) : 1);
  }
  return null;
}

function rasterize(world, data, settings, {w,h,rayAt,near,clip}) {
  const {sources,rows} = bind(world,data,settings);
  if (!sources.length) return null;
  const hits = new Array(w*h), samples=[];
  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    const ray=rayAt(x+.5,y+.5);
    let closest;
    for (const source of sources) {
      const hit=trace(source,ray,near,closest?.z ?? 400,settings,clip);
      if (hit && (!closest || closest.z>hit.z)) closest=hit;
    }
    if (!closest) continue;
    const sample={...closest,p,alpha:1,sdf:true,objectPosition:closest.position};
    samples.push(sample);
    hits[p]=sample;
  }
  function fragment(row, pixel, ray, axial) {
    const hit = hits[pixel];
    if (hit?.row.part === row.part && facing(row,hit.normal) && settings.allows(row.target,hit.position)) {
      const distance=Math.hypot(hit.position[0]-row.point[0],hit.position[1]-row.point[1],hit.position[2]-row.point[2]);
      if (distance <= row.reach) return hit;
    }
    const point = row.normal && surfacePoint(ray,row.normal,...row.point,axial,row.reach) || row.point;
    return settings.allows(row.target,point) ? false : null;
  }
  return {rows,hits,samples,fragment};
}

module.exports = { rasterize };
