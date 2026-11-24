module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'weather-traces',
  name:'Thaw at the terrace',
  seed:83,
  build(seed) {
    const B = makeBuilder(seed, [
      0x233952, 0x35464d, 0x50616a, 0x738588, 0x99a398,
      0x665348, 0x8b6f55, 0xb69369, 0xd0b18a, 0xe7cfa6,
      0x704b48, 0xa96c53, 0xd28e69, 0xe6a880,
      0x435c4a, 0x668160, 0x839674, 0xa0a47e,
      0x425a72, 0x667d93, 0x8292a0,
      0x81a4bf, 0xc8deeb, 0xeaf5f1, 0xf9e3b0,
      0x9d6541, 0xe7aa68, 0xffdaa2
    ]);
    const S = K.sculpt(makeSculpt(B));
    const sun = K.V.norm([-.75,.39,.51]);
    S.sun = sun;
    S.amb = .34;
    S.sky = .17;
    const mask = (channel, low, high) => ({ type:'weather', channel, low, high });
    const tint = (color, channel, low, high, strength=1, crossColor=color) =>
      ({ type:'directionalColor', color, crossColor, strength, mask:mask(channel,low,high) });
    const paving = K.surface.material({ r:[5,6,7,8,9] }, { layers:{
      damp:tint('#536572','wetness',.015,.28,.88,'#5b656d'),
      basin:tint('#274657','standingWater',.008,.19,.90),
      sheen:{ type:'reflection', source:'scene', strength:.85, f0:.70, power:3,
        mask:mask('standingWater',.023,.26) },
      frost:tint('#a7cbd7','frost',.023,.27,.77,'#7799af'),
      snow:tint('#eef2e8','snow',.016,.34,.94,'#d5e6eb')
    } });
    const granite = { r:[1,2,3,4] }, timber = { r:[5,6,7,8] }, roof = { r:[10,11,12,13] };
    const moss = { r:[14,15,16,17] };
    const basinAt = (x,z) => Math.max(0,
      1-((x-1.40)/1.42)**2-((z-.97)/.89)**2,
      .88-((x+1.08)/1.04)**2-((z+.05)/.76)**2,
      .67-((x-.12)/.80)**2-((z+1.6)/1.06)**2);
    for (const [x,z,w,h,d] of [
      [-27,-44,12,12,8],[-14,-45,10,10,7],[-2,-50,9,8,7],[10,-46,12,11,8],[24,-43,12,10,8],
      [-13,-29,7.8,6.2,5],[15,-31,8.7,6.6,6]
    ]) S.rock([x,-2.9,z],[w,h,d],{r:[18,19,20]},{res:.43});
    S.rock([.23,-1.81,-.9],[6.1,1.84,5.10],granite,{res:.21});
    S.box([0,-.193,.04],[4.16,.204,3.16],granite,{res:.139,rd:.16});
    for (let row=0;row<11;row++) for (let col=0;col<14;col++) {
      const x=(col-6.5)*.557+(row%2)*.05, z=(row-5)*.523;
      const y=.086-.08*basinAt(x,z)+.011*Math.cos(col*2.1+row*.43);
      S.box([x,y,z],[.269,.081,.252],paving,{res:.078,rd:.04});
    }

    const shelter={ min:[-3.56,-2.95], max:[-1.10,-1.27], heightAt:() => 2.68 };
    for (const x of [-3.35,-1.34]) for (const z of [-2.72,-1.49]) {
      S.box([x,.23,z],[.22,.14,.21],granite,{res:.068,rd:.035});
      S.lathe([x,.32,z],1.95,[.087,.075],timber,{res:.066});
    }
    S.box([-2.33,2.28,-2.11],[1.16,.100,.79],timber,{res:.071,rd:.047});
    for (let row=0;row<5;row++)
      S.box([-2.33,2.43+row*.109,-2.11],[1.26-row*.066,.071,.88-row*.16],roof,{res:.07,rd:.048});
    S.ball([-2.34,1.89,-1.50],[.146,.165,.128],{r:[26,27],em:true},{res:.047,ghost:true});
    S.lathe([-2.34,2.047,-1.50],.16,[.166,.043],timber,{res:.051});
    for (const [x,z,r] of [[-4.03,.28,.49],[3.86,-1.26,.66],[4.07,1.33,.57],[-3.57,2.62,.40],[2.76,2.55,.33]]) {
      S.rock([x,.03,z],[r,r*.94,r*.83],granite,{res:.094});
      S.rock([x,r*.62,z],[r*.76,r*.35,r*.64],moss,{res:.088});
    }
    for (const x of [-.53,3.10]) {
      S.box([x,.18,-2.52],[.25,.12,.27],granite,{res:.075,rd:.038});
      S.lathe([x,.28,-2.52],1.10,[.14,.103],granite,{res:.061});
      S.lathe([x,1.35,-2.52],.23,[.18,.048],roof,{res:.054});
    }
    const cast = K.atmosphere.occluder(S.modelSource().field.sdf,{ bias:.014, step:.027, steps:40 });
    S.bake();

    const drops = { worldSpace:true, profile:true, top:6.45, ground:() => .13, box:[-9,8,-6,5] };
    K.weather.fall(B,{ ...drops, kind:'rain', n:780, seed, cols:[21,22], len:.128, size:.012, speed:8.6 });
    K.weather.fall(B,{ ...drops, kind:'snow', n:550, seed:seed+14, cols:[21,22,23], size:.036, speed:1.2 });
    const cover = K.procedural.overheadCover.rasterize({ surfaces:[shelter] },{ spacing:.13 });
    const shaded = new Map();
    function localWeather(x,z) {
      const exposed = K.procedural.overheadCover.exposure(cover,[x,.19,z]);
      const key = x + ',' + z;
      if (!shaded.has(key)) shaded.set(key,cast(x,.23,z,sun,8));
      return { precipitationExposure:exposed, shelter:Math.max((1-exposed)*.92,shaded.get(key) ? .9 : 0) };
    }
    const profiles = {
      downpour:{ rain:.60, snowfall:0, windX:1.29, windZ:-.19, airTemperature:6, humidity:.96, daylight:.15,
        zenith:'#4b647c', horizon:'#c0cbd1', sunStrength:.11 },
      after:{ rain:0, snowfall:0, windX:.16, windZ:0, airTemperature:3, humidity:.81, daylight:.26,
        zenith:'#577396', horizon:'#d5d7d3', sunStrength:.27 },
      frost:{ rain:0, snowfall:.36, windX:-.72, windZ:.08, airTemperature:-6.2, humidity:.91, daylight:.055,
        zenith:'#547191', horizon:'#ccd5dc', sunStrength:0 },
      thaw:{ rain:0, snowfall:0, windX:.45, windZ:0, airTemperature:-1.25, humidity:.35, daylight:.98,
        zenith:'#568aba', horizon:'#f2d4a3', sunStrength:.83 }
    };
    const skyEnvironment = K.skyEnvironment.compile({
      defaults:{ sunAltitude:Math.asin(sun[1]), sunAzimuth:Math.atan2(sun[0],sun[2]), ground:'#496374' },
      profiles, sequences:{ weather:{ duration:10.8, loop:false, keys:[
        { at:0, profile:'downpour', ease:'hold' }, { at:1.85, profile:'downpour' }, { at:2.65, profile:'after', ease:'hold' },
        { at:3.35, profile:'after' }, { at:3.98, profile:'frost', ease:'hold' }, { at:6.05, profile:'frost' },
        { at:6.85, profile:'thaw' }
      ] } }, tracks:[{ id:'weather', sequence:'weather' }]
    });
    return B.finish({
      cam:{ target:[0,.68,-.43],dist:12.62,pitch:.56,yaw:.14,sway:0 },
      detail:22, radius:49, dither:0, skyEnvironment, precipitation:{ occluder:cast, lightStrength:.35 },
      lights:[{ p:[-2.34,1.89,-1.36], radius:2.33, intensity:2.1, color:[1,.66,.33] }],
      weatherBinding:{ rainFull:.70, snowFull:.5, surface:{
        width:35, height:27, cell:.24, origin:[-4.2,-3.24], step:.125, maxRunoff:.07,
        capacity:.30, exchange:2.25, wetDiffusion:.007, heatDiffusion:.001,
        sunHeat:18, evaporation:.66, meltRate:.21, freezeRate:.20,
        initial:() => ({ temperature:6 }),
        standingWater:{ capacity:(x,z) => .44 * basinAt(x,z), drainage:.055, evaporation:.75 },
        forcing:localWeather
      } }
    });
  }
});
