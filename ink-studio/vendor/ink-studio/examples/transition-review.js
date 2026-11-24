const coast = require('./weather-front.js');

module.exports = kit => ({
  id:'transition-review',
  name:'Headland weather and camera checks',
  seed:96,
  build(seed) {
    const world = coast(kit).build(seed);
    const skyEnvironment = {
      defaults:{ rain:0, fogDensity:0, windX:.09, windZ:.04, airTemperature:12, humidity:.41, daylight:.75 },
      profiles:{
        midnight:{zenith:'#111d4a',horizon:'#354567',ground:'#192838',sunStrength:0,overcast:0,stormLook:0},
        shore:{zenith:'#48769e',horizon:'#eac997',ground:'#577988',sunStrength:.52,overcast:0,stormLook:0},
        storm:{zenith:'#1b284f',horizon:'#485475',ground:'#293950',sunStrength:0,overcast:.25,stormLook:1},
        squall:{rain:.72,fogDensity:1.6,windX:1.95,windZ:.67,airTemperature:7,humidity:.97,daylight:.24}
      },
      sequences:{ day:{ duration:24, keys:[
        {at:0,profile:'midnight'}, {at:1.8,profile:'midnight'}, {at:3.2,profile:'shore',ease:'hold'},
        {at:4.4,profile:'storm'}, {at:6.8,profile:'storm'}, {at:10.8,profile:'shore'}, {at:21,profile:'midnight'}
      ] } },
      tracks:[{id:'coast-light',sequence:'day'}]
    };
    const transitionReview = {
      fps:12, neighbors:2, preroll:4,
      events:[
        {id:'Midnight wrap',kind:'midnight',at:1.25,skyTime:24,camera:{yaw:.045,pitch:.055,target:[.1,1.55,-1.6]}},
        {id:'Storm front arrives',kind:'storm',at:4.4,camera:{yaw:.045,pitch:.055,target:[.1,1.55,-1.6]}},
        {id:'Cut to the beacon',kind:'cut',at:7.25,skyTime:7,skyRate:0,
          camera:{yaw:.045,pitch:.055,target:[.1,1.55,-1.6]},incomingCamera:{target:[-5.8,2,-.3],yaw:-.46,pitch:.18,dist:10.8}}
      ]
    };
    const look = { ...world.look, effectPalettes:{ sky:{
      colors:['#252b48','#353d60','#505e7a','#707e94','#96a4b4'],
      threshold:.55, range:[.12,.65], when:{channel:'stormLook',min:.5}
    } } };
    return { ...world, look, skyEnvironment, transitionReview };
  }
});
