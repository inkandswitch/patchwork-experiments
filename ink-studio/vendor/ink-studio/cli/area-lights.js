const AreaLights=require('../src/area-lights.js'),Cookies=require('../src/light-cookies.js');
const ColorSpace = require('../src/color-space.js');
const { spotWeight } = require('../src/volume-light.js');
const { slab } = require('../src/scene-optics.js');
const linear = ColorSpace.prepare('srgb','srgb-linear');
const srgb = ColorSpace.prepare('srgb-linear','srgb');
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const clamp = n => Math.max(0,Math.min(1,n));
const spotBias = .025;

function rasterize(lights, { w, h, rayAt, near, capture, clip }) {
  const visible = lights.filter(light => light.intensity && (capture ? light.reflection : light.visible));
  if (!visible.length) return null;
  const hits = new Array(w*h);
  let any = false;
  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    const {origin,direction,axial} = rayAt(x+.5,y+.5);
    let nearest = Infinity;
    for (const light of visible) {
      const facing = dot(light.normal,direction);
      if (Math.abs(facing)<1e-8 || (!light.twoSided && facing>=0)) continue;
      const distance = light.at.reduce((sum,n,k)=>sum+(n-origin[k])*light.normal[k],0)/facing;
      const z = distance*axial;
      if (z<near || z>=nearest) continue;
      const point = origin.map((n,k)=>n+distance*direction[k]);
      const delta = point.map((n,k)=>n-light.at[k]);
      const u = dot(delta, light.u)/light.half[0], v = dot(delta, light.v)/light.half[1];
      if ((light.shape === 'disk' ? u*u+v*v>1 : light.shape==='line'? Math.hypot(Math.max(0,Math.abs(u)*light.half[0]-Math.max(0,light.half[0]-light.half[1])),v*light.half[1])>light.half[1] : Math.max(Math.abs(u),Math.abs(v))>1) || clip && !clip(point)) continue;
      const transmission=light.cookie?Cookies.sample(light.cookie.image,(u+1)/2,(1-v)/2):[1,1,1];
      const color = light.rgb.map((n,k)=>n*Math.min(1,light.intensity)*transmission[k]);
      hits[p] = { p,z,position:point,objectPosition:point,normal:light.normal,alpha:1,
        surface:true,emission:color,color };
      nearest = z;
      any = true;
    }
  }
  return any ? hits : null;
}

const {staticSources,occludes}=AreaLights;

function createLighting(lights, world, data, alpha, { spots = [], shadow } = {}) {
  const active = lights.filter(light=>light.intensity>0).map(light=>({
    ...light, extent:Math.hypot(...light.half), tint:linear(light.rgb)
  }));
  const projectors = spots.map(light => ({ ...light, tint:linear(light.rgb) }));
  if (!active.length && !projectors.length) return null;
  const sources = active.some(light=>light.shadows) || (!shadow && spots.some(light=>light.castsShadow))
    ? staticSources(world,data,alpha) : [];
  const cache = [];

  function evaluate(point, normal) {
    const rgb=[0,0,0];
    AreaLights.evaluate(active,point,normal,rgb,{shadow:sources.length?(o,d,s)=>occludes(sources,o,d,s):null});
    for (const light of projectors) {
      const offset = light.at.map((value,k) => value-point[k]), distance = Math.hypot(...offset);
      if (distance <= spotBias || distance >= light.radius) continue;
      const direction = offset.map(value => value/distance);
      const receive = dot(normal,direction);
      if (receive <= 0) continue;
      const weight = spotWeight(light,direction);
      if (!weight) continue;
      if (light.castsShadow && (shadow || sources.length)) {
        const origin = point.map((value,k) => value+normal[k]*spotBias);
        const ray = light.at.map((value,k) => value-origin[k]), stop = Math.hypot(...ray);
        if (stop > spotBias) {
          const toLight = ray.map(value => value/stop);
          if (shadow ? shadow(...origin,toLight,stop) : occludes(sources,origin,toLight,stop-spotBias)) continue;
        }
      }
      const level = light.surfaceIntensity*weight*receive*(1-distance/light.radius)**2;
      const projected=light.cookie?.rgb?light.cookie.rgb(direction):[1,1,1];
      for (let c=0;c<3;c++) rgb[c]+=light.tint[c]*level*projected[c];
    }
    return rgb;
  }

  return function shade(pixel, point, normal, rgb, fog, fogMix = 0) {
    const previous = cache[pixel];
    let light;
    if (previous && point.every((n,k)=>Math.abs(n-previous.point[k])<1e-6) &&
        normal.every((n,k)=>Math.abs(n-previous.normal[k])<1e-6)) light=previous.light;
    else {
      light=evaluate(point,normal);
      cache[pixel]={point,normal,light};
    }
    if (!light.some(Boolean) || fogMix>=1) return rgb;
    const surface = fogMix ? rgb.map((n,k)=>clamp((n-fog[k]*fogMix)/(1-fogMix))) : rgb;
    const shaded = srgb(linear(surface).map((n,k)=>Math.min(1,n*(1+light[k]))));
    return fogMix ? shaded.map((n,k)=>n+(fog[k]-n)*fogMix) : shaded;
  };
}

function sceneOccluder(world, data, alpha) {
  const sources = staticSources(world, data, alpha);
  return sources.length ? (origin, direction, distance) => occludes(sources, origin, direction, distance) : null;
}

module.exports = { rasterize, createLighting, sceneOccluder };
