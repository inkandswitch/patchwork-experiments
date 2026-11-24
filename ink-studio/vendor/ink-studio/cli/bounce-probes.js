const BounceProbes = require('../src/bounce-probes.js');
const ColorSpace = require('../src/color-space.js');
const ShadowArt = require('../src/shadow-art.js');
const SkyEnvironment = require('../src/sky-environment.js');
const linear = ColorSpace.prepare('srgb','srgb-linear');
const srgb = ColorSpace.prepare('srgb-linear','srgb');
const bakes = new WeakMap();

function create(world, override, sky, sun, source = world) {
  const authored = world.bounceProbes ?? source.bounceProbes;
  const value = override === true ? authored : override ?? authored;
  let settings = BounceProbes.prepare(value);
  if (!settings?.probes.length || !settings.strength) return null;
  if (!settings.format) {
    const key = JSON.stringify(settings), cached = bakes.get(source);
    settings = cached?.key === key ? cached.bake : require('../index.js').load().KIT.bounceProbes.bake(source,value);
    bakes.set(source,{ key,bake:settings });
  }

  const receive = ShadowArt.bind(settings,world,'receive');
  const { pointIndex } = require('../index.js').load().KIT.procedural.spatial;
  const { samples,strength,bounceStrength,skyStrength } = settings;
  const weight = 4*Math.PI/samples;
  const skySamples = BounceProbes.directions(samples).map(({direction,basis})=>{
    const upper=direction[1]>=0;
    const incoming=sky ? linear(upper ? SkyEnvironment.scattering(sky,direction) : sky.ground) :
      upper ? sun?.sky : sun?.ground;
    return { basis,color:skyStrength && incoming?.some(Boolean) ? incoming.map(n=>n*skyStrength) : null };
  });
  const index = pointIndex(settings.probes.map(probe=>{
    const coefficients=probe.coefficients.map(n=>n*bounceStrength), { at,radius,bounds } = probe;
    for (let i=0;i<samples;i++) {
      const {basis,color}=skySamples[i];
      if (color && probe.open[i]) BounceProbes.project(coefficients,basis,color,weight*probe.open[i]);
    }
    const extent={ min:at.map(n=>n-radius), max:at.map(n=>n+radius) };
    return { bounds:extent, probe:{ ...probe,coefficients,bounds } };
  }));

  function sample(point, normal) {
    let mix=0,total=0, basis;
    const rgb=[0,0,0];
    index(point,({probe})=>{
      const amount=BounceProbes.influence(probe,point);
      if (!amount) return;
      basis ??= BounceProbes.basis(normal);
      mix=Math.max(mix,amount);
      const distance=Math.hypot(point[0]-probe.at[0],point[1]-probe.at[1],point[2]-probe.at[2])/probe.radius;
      const weight=amount/(.12+distance*distance);
      total+=weight;
      for (let i=0;i<9;i++) for (let c=0;c<3;c++) rgb[c]+=basis[i]*probe.coefficients[i*3+c]*weight;
    });
    return total>0 ? { mix:mix*strength,rgb:rgb.map(n=>Math.max(0,n/total)) } : null;
  }

  function shade(point, normal, rgb, fog, fogMix = 0, albedo) {
    const local = sample(point,normal);
    if (!local?.rgb.some(Boolean) || fogMix>=1) return rgb;
    const surface = fogMix ? rgb.map((n,k)=>Math.max(0,Math.min(1,(n-fog[k]*fogMix)/(1-fogMix)))) : rgb;
    const diffuse=linear(surface);
    const reflectance=albedo ? linear(albedo) : diffuse;
    const shaded=srgb(diffuse.map((n,k)=>Math.min(1,n+reflectance[k]*local.rgb[k]*local.mix)));
    return fogMix ? shaded.map((n,k)=>n+(fog[k]-n)*fogMix) : shaded;
  }

  return { sample,shade, receives:i=>!receive || receive(i) };
}

module.exports = { create };
