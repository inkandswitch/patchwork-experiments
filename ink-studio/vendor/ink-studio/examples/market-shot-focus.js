const market = require('./review-sheltered-market.js');
const reviewCamera = require('./environment-review-camera.js');

const camera = reviewCamera([
  {time:0,target:[-.78,1.26,-.32],dist:9.5,yaw:.25,pitch:.28},
  {time:2.3,target:[-.90,1.18,-.40],dist:8.72,yaw:.095,pitch:.24},
  {time:4.6,target:[-1.04,1.17,-.59],dist:8.65,yaw:-.17,pitch:.21}
]);

module.exports = kit => {
  const scene = market(kit);
  return {
    ...scene,
    id:'market-shot-focus',
    name:'The produce stall in a storm',
    animate:camera.animate,
    build(seed) {
      const world = scene.build(seed);
      return { ...world, cam:{...world.cam,...camera.at(0)}, look:{ ...world.look, silhouetteProtection:{
        targets:[
          {id:'produce', select:{object:'west-produce'}, fogScale:.32, contrast:1.6, pivot:.31},
          {id:'lanterns', select:{object:'west-lanterns'}, fogScale:.28}
        ],
        focus:{
          radius:57, depthBias:.24,
          background:{contrast:.52,pivot:.50,saturation:.42,detail:.32},
          rain:{subject:.10,surroundings:.78}
        }
      } } };
    }
  };
};
