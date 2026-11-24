const estuary = require('./celestial-estuary.js');

module.exports = kit => ({
  id: 'art-direction-estuary',
  name: 'Three looks for Estuary Watch',
  seed: 129,
  build(seed, options) {
    const { KIT: K } = kit;
    const world = estuary(kit).build(seed);
    const skyEnvironment = {
      defaults: { zenith:'#225370', horizon:'#ed977c', ground:'#3b5d78', sunStrength:.68, daylight:.28 }
    };
    const celestialTracks = K.celestialTracks.compile({ primarySun:'sun', bodies:[{
      id:'sun', kind:'sun', radius:.077, color:'#ffe5b3', softness:.08, glow:.48, glowRadius:.30,
      keys:[{at:0,azimuth:Math.PI-.155,elevation:.078}]
    }] });
    const cloudField = K.clouds.compile({
      bounds:{min:[-55,-82],max:[55,-11]},height:7.15,thickness:1.45,steps:24,resolution:[92,94],
      velocity:[2.4,.12],color:'#414761',opacity:.95,
      lighting:{color:'#ae8499',ambient:.54,strength:.59,rim:.29},
      coverage(x,z) {
        const shear=x*.144+z*.39, stream=Math.sin(shear)+.62*Math.cos(z*.57-x*.19)+.30*Math.sin(x*.73+z*.22);
        const edge=K.clamp((z+82)*.12,0,1)*K.clamp((-z-11)*.34,0,1);
        return edge*K.clamp(.36+.48*stream,0,1);
      }
    });
    const atmosphere = [
      K.atmosphere.fog({id:'river-haze',density:.075,color:'#9bb4bb',bottom:-.72,top:.63,near:16,far:42}),
      K.atmosphere.fog({id:'far-bank',density:.028,color:'#a8b7bd',bottom:-.55,top:1.63,near:25,far:49})
    ];
    return { ...world, skyEnvironment, celestialTracks, cloudField, atmosphere,
      cam:{...world.cam,pitch:-.085}, aerialPerspective:{start:20,density:.034,contrast:.23},
      look:{...world.look,artDirection:options?.controls?.look ?? 'painted-pixel'} };
  }
});
