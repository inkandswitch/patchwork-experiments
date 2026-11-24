const ArtDirection = require('../src/art-direction.js');

const diagonal = Math.SQRT2;
const limit = value => Math.min(1,Math.max(0,value));
const smooth = value => {
  const t = limit(value);
  return t*t*(3-2*t);
};
const luma = (r,g,b) => .30*r+.55*g+.15*b;

function frame(settings, { passes, silhouetteMask }) {
  const { w,h,depth,objectId,materialId,emission } = passes;
  const size = w*h, { radius, depthBias, slots } = settings;
  const distance = new Float32Array(size).fill(radius), nearest = new Int32Array(size).fill(-1);
  const accepted = new Set(slots);
  let found = false;
  for (let p=0; p<size; p++) {
    if (!Number.isFinite(depth[p]) || !accepted.has(silhouetteMask[p])) continue;
    found = true;
    distance[p] = 0;
    nearest[p] = p;
  }
  if (!found) return null;
  // Two distance sweeps carry the closest visible seed and its depth to the surrounding pixels.
  function step(p, other, cost) {
    const candidate = distance[other]+cost;
    if (candidate >= distance[p]) return;
    distance[p] = candidate;
    nearest[p] = nearest[other];
  }
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    const p = y*w+x;
    if (x) step(p,p-1,1);
    if (!y) continue;
    step(p,p-w,1);
    if (x) step(p,p-w-1,diagonal);
    if (x+1<w) step(p,p-w+1,diagonal);
  }
  for (let y=h-1; y>=0; y--) for (let x=w-1; x>=0; x--) {
    const p = y*w+x;
    if (x+1<w) step(p,p+1,1);
    if (y+1>=h) continue;
    step(p,p+w,1);
    if (x) step(p,p+w-1,diagonal);
    if (x+1<w) step(p,p+w+1,diagonal);
  }
  const background = settings.grades && new Float32Array(size);
  const rain = (settings.subject !== 1 || settings.surroundings !== 1) && new Float32Array(size).fill(1);
  for (let p=0; p<size; p++) {
    const seed = nearest[p];
    if (seed < 0 || depth[p]+depthBias < depth[seed]) continue;
    const weight = smooth(1-distance[p]/radius);
    if (background && seed !== p && Number.isFinite(depth[p]) &&
        !(emission[p*3] || emission[p*3+1] || emission[p*3+2])) background[p] = weight;
    if (rain) {
      const core = smooth(1-distance[p]/Math.max(1,radius*.30));
      rain[p] = 1+(settings.surroundings-1)*weight+(settings.subject-settings.surroundings)*core;
    }
  }
  return { w,h,settings,background,rain,depth,objectId,materialId };
}

function raster(focus,w,h) {
  if (!focus) return null;
  const x = Int32Array.from({length:w}, (_,p)=>Math.floor(p*focus.w/w));
  const y = Int32Array.from({length:h}, (_,p)=>(focus.h-1-Math.floor(p*focus.h/h))*focus.w);
  return (p)=>y[Math.floor(p/w)]+x[p%w];
}

function grade(col,w,h,focus,index,precipitation) {
  if (!focus?.background) return;
  const { background,settings,depth,objectId,materialId } = focus;
  const { detail,pivot,saturation,contrast,depthBias } = settings;
  const source = detail === 1 ? col : col.slice(), out = [0,0,0];
  const radiusX = Math.max(1,Math.round(w/focus.w)), radiusY = Math.max(1,Math.round(h/focus.h));
  const tolerance = Math.max(.12,depthBias);
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    const p = y*w+x, seed = index(p), weight = background[seed], at = p*3;
    if (!weight) continue;
    let r = source[at], g = source[at+1], b = source[at+2];
    if (detail < 1 && precipitation[p] <= .02) {
      let rs = r*2, gs = g*2, bs = b*2, count = 2;
      for (let dy=-radiusY; dy<=radiusY; dy+=radiusY) for (let dx=-radiusX; dx<=radiusX; dx+=radiusX) {
        if ((!dx && !dy) || x+dx<0 || x+dx>=w || y+dy<0 || y+dy>=h) continue;
        const q = (y+dy)*w+x+dx, site = index(q);
        if (!background[site] || precipitation[q] > .02 || objectId[site] !== objectId[seed] ||
            materialId[site] !== materialId[seed] || Math.abs(depth[site]-depth[seed]) > tolerance) continue;
        rs += source[q*3];
        gs += source[q*3+1];
        bs += source[q*3+2];
        count++;
      }
      const blend = weight*(1-detail);
      r += (rs/count-r)*blend;
      g += (gs/count-g)*blend;
      b += (bs/count-b)*blend;
    }
    ArtDirection.gradeContrast(r,g,b,(contrast-1)*weight,pivot,out);
    const luminance = luma(...out), chroma = 1+(saturation-1)*weight;
    for (let c=0; c<3; c++) col[at+c] = limit(luminance+(out[c]-luminance)*chroma);
  }
}

module.exports = { frame,raster,grade };
