const beacon = require('./live-sun.js');
const reviewCamera = require('./environment-review-camera.js');

module.exports = kit => {
  const { KIT:K } = kit;
  const camera = reviewCamera([
    {time:0, target:[-.75,.83,0], dist:10.7, yaw:.34, pitch:.40},
    {time:4.8, target:[-.50,.94,-.18], dist:10.9, yaw:.16, pitch:.36}
  ]);
  return {
    id:'review-beacon', name:'Beacon after rain', seed:13,
    review:{duration:4.8,checkpoints:[0,2.4,4.7]},
    animate:camera.animate,
    build(seed) {
      const wetness = {type:'weather',channel:'wetness',low:.08,high:.58};
      const world = beacon(kit).build(seed,{floorFinish:{layers:{
        damp:{type:'directionalColor',color:'#4c5564',crossColor:'#626976',strength:.82,mask:wetness},
        sheen:{type:'reflection',source:'scene',strength:.67,f0:.47,mask:wetness},
        gleam:{type:'specular',color:'#ffe4bf',roughness:[.16,.24],strength:.49,mask:wetness}
      }}});
      const morning = {
        zenith:'#596ba0',horizon:'#ffd1ad',ground:'#677e91',sunColor:'#ffe1b1',
        sunAzimuth:-.96,sunAltitude:.29,sunStrength:.78,rain:.17,humidity:.86,daylight:.56
      };
      const clearing = {
        ...morning,zenith:'#487aa6',horizon:'#e6d7b6',ground:'#718a90',sunColor:'#fff0c9',
        sunAzimuth:.87,sunAltitude:.64,sunStrength:.94,rain:0,humidity:.53,daylight:.87
      };
      const skyEnvironment = K.skyEnvironment.compile({
        profiles:{morning,clearing},
        sequences:{break:{duration:4.8,loop:false,keys:[{at:0,profile:'morning'},{at:4.7,profile:'clearing'}]}},
        tracks:[{id:'weather',sequence:'break'}]
      });
      return {...world,cam:{...camera.at(0),sway:0}, skyEnvironment,
        liveSun:{...world.liveSun,direction:t=>skyEnvironment.frame(t).sky.sun,ambient:.30,intensity:1.08,mapSize:256,
          skyBounce:{color:'#94bdd5',intensity:.22}},
        weatherBinding:{surface:{
          width:32,height:22,cell:.31,origin:[-4.96,-3.41],step:.125,wetDiffusion:.012,evaporation:.38,
          initial:(x,z)=>({wetness:.20+.48*Math.exp(-.12*(x-1.1)**2-.31*(z-.8)**2),temperature:12})
        }}
      };
    }
  };
};
