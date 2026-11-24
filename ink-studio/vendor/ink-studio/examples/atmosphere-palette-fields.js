/* The lighthouse uses one scalar palette field at each point in the atmosphere. */
const lighthouse = require('./lighthouse-mist.js');
const bands = stops => ({ type:'bands', stops:stops.map(([at,color])=>({at,color})) });
const skyField = {
  source:'elevation',domain:[-.025,.32],gain:'pigment',field:bands([
    [0,'#f09b6f'],[.14,'#ffc084'],[.24,'#d77b82'],[.39,'#b06d8a'],
    [.52,'#8d6591'],[.69,'#625987'],[.86,'#324566']
  ])
};
const mistField = {
  source:'depth',domain:[5,38],strength:.84,field:bands([
    [0,'#7399ac'],[.34,'#998da8'],[.62,'#c896ac'],[.84,'#eab29c']
  ])
};
const cloudField = {
  source:'altitude',domain:[5.8,10.1],strength:.9,field:bands([
    [0,'#463c63'],[.28,'#745476'],[.56,'#a66f82'],[.82,'#d48f83']
  ])
};
const beamField = {
  source:'intensity',domain:[0,8],field:bands([
    [0,'#616edd'],[.12,'#a66aca'],[.32,'#e77bac'],[.55,'#ffb16c'],[.81,'#fff2ac']
  ])
};

module.exports = kit => ({
  id:'atmosphere-palette-fields', name:'Pigment lighthouse', seed:42,
  build(seed,{controls}={}) {
    const mode=controls?.mode ?? 'shared';
    if (!['plain','shared','separate-reflection'].includes(mode))
      throw new RangeError('Choose plain, shared or separate-reflection');
    const useFields=mode!=='plain';
    const world=lighthouse(kit).build(seed);
    world.cam={ ...world.cam, target:[-.89,2.98,-2.6], dist:16.8, pitch:.077, fov:.731 };
    world.look={ ...world.look, coverageAware:true, splatCoverage:'continuous' };
    world.skyEnvironment={
      defaults:{ zenith:'#283b60', horizon:'#7c7788', ground:'#294053',
        sunAzimuth:2.88, sunAltitude:.125, sunSize:.022, sunColor:'#ffcc8e', sunStrength:.54, pigment:1 },
      sky:{ ...(useFields && { paletteField:{...skyField,reflections:mode==='shared'} }) }
    };
    world.cloudField={
      recipe:'coastal-stratus',seed:38,bounds:{min:[-72,-84],max:[72,-13]},resolution:[88,72],
      height:7.75,thickness:4.3,shape:{scale:8.5,stretch:2.2,heading:-.19},coverage:.49,
      opacity:.67,velocity:[.32,.07],steps:24,color:'#696a83',
      lighting:{color:'#ecd2c0',ambient:.12,strength:.32,rim:.10},
      ...(useFields && { paletteField:cloudField })
    };
    world.atmosphere=world.atmosphere.map(volume=>({
      ...volume, density:volume.density*.78, ...(useFields && { paletteField:mistField })
    }));
    world.volumeQuality={ ...world.volumeQuality, steps:64, scale:2 };
    world.surfaces=world.surfaces.map(entry=>{
      const sky=entry.settings.layers?.sky;
      if (sky?.source!=='scene') return entry;
      return {...entry,settings:{...entry.settings,layers:{...entry.settings.layers,sky:{...sky,f0:.75,strength:.91}}}};
    });
    world.volumeLighting={
      ...world.volumeLighting,ambient:.42,spots:world.volumeLighting.spots.map(spot=>({
        ...spot, intensity:15, innerAngle:4.4, outerAngle:9.8, radius:22,
        ...(useFields && { paletteField:beamField })
      }))
    };
    return world;
  }
});
