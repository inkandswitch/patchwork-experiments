const manifest = require('./world-spatial-fields.json');

module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'spatial-field-wind',
  name: 'Wind at the harbor station',
  seed: 17,
  build(seed, { controls = {} } = {}) {
    const run = K.world.runtime.create(manifest);
    run.advance(controls.tick ?? 0);
    const query = run.query();
    const wind = query.sampler('weather/wind', {type:'vec3',units:'world/s',fallback:[0,0,0]});

    const B = makeBuilder(seed, [
      0x243844, 0x212c30, 0x414846, 0x646a60, 0x949587, 0xc6c1a3,
      0x51403a, 0x78554a, 0xa2765d, 0xcba579, 0xe8c49c,
      0x603850, 0xae4d57, 0xe7735c, 0xffaa6b, 0xffdf9b,
      0x243e55, 0x385f70, 0x547d84, 0x80a7a4, 0xb6c9b7,
      0x485160, 0x737e87, 0x9da6a6, 0xcad1c5,
      0x414e48, 0x5e6952, 0x8b8c66
    ]);
    const S = K.sculpt(makeSculpt(B));
    const stone = {r:[1,2,3,4,5]}, wood = {r:[6,7,8,9,10]};
    S.box([0,-0.38,0],[4.45,0.26,2.72],stone,{rd:.14,res:.14});
    S.box([0,-0.13,0.65],[4.25,.11,1.86],{r:[16,17,18,19,20]},{rd:.13,res:.09});
    S.box([0,.01,-.85],[3.57,.26,.79],stone,{rd:.1,res:.095});
    S.box([0,.27,-.64],[2.9,.048,.46],wood,{rd:.04,res:.074});
    for (let x=-2.7; x<=2.7; x+=.32) {
      S.box([x,.32,-.64],[.15,.022,.44],wood,{rd:.02,res:.08});
    }
    for (const x of [-2.65,-1.45,1.45,2.65]) {
      S.box([x,.48,-1.14],[.065,.23,.065],wood,{rd:.022,res:.065});
    }
    S.box([-1.25,1.25,-.81],[.043,1.01,.043],wood,{rd:.018,res:.043});
    S.ball([-1.25,2.29,-.81],.084,{r:[8,9,10,15]},{res:.042});
    S.box([.4,.4,.35],[.18,.23,.18],stone,{rd:.06,res:.055});
    S.lathe([.4,.6,.35],.16,[.17,.25],{r:[6,7,8,9]},{res:.06});
    S.ball([.4,.75,.35],.1,{r:[12,13,14,15],em:true},{res:.051});
    for (const x of [-3.25,3.25]) {
      S.box([x,.38,-1.1],[.2,.11,.23],stone,{rd:.05,res:.07});
      for (let i=0;i<5;i++)
        S.ball([x+(B.R()-.5)*.35,.50+B.R()*.14,-1.1+(B.R()-.5)*.35],
          .085,{r:[25,26,27]},{res:.06});
    }

    const [x,y,z] = query.probe('world/position',{entity:'raft'}).value;
    S.box([x,y+.05,z],[.42,.13,.24],wood,{rd:.105,res:.065});
    S.box([x,y+.37,z],[.028,.34,.028],wood,{res:.044});
    S.bake();
    const cloth = K.cloth(B,{
      at:[-1.25,2.19,-.81],u:[0,0,-.99],v:[0,-.63,0],
      nu:12,nv:8,dabs:3,wind,mass:.005,air:2.5,
      pattern:(u,v) => v<.15||v>.85 ? [8,9,10,15] : u>.72 ? [11,12,13,14] : [12,13,14,15]
    });
    const sail = K.cloth(B,{
      at:[x,y+.65,z],u:[0,0,.4],v:[0,-.38,0],nu:8,nv:7,dabs:2,wind,mass:.012,
      pattern:(u,v) => u<v*.75 ? null : [4,5,10,15]
    });
    const pool = K.pool(B,240);
    const scene = B.finish({cam:{target:[0,.77,0],dist:12.8,pitch:.53,yaw:.19},detail:18,dither:.14});
    const stage = K.stage(scene);
    stage.add(cloth);
    stage.add(sail);
    const flow = (x,y,z,t,out) => {
      const [vx,vy,vz] = wind(x,y,z);
      out[0]=vx*.7;
      out[1]=vy+.35;
      out[2]=vz*.7;
    };
    const smoke = stage.add(K.particles(stage,pool,{flow,ground:()=>.3}));
    let next = 0;
    stage.add({update(dt,t) {
      if (t < next) return;
      smoke.emit({p:[.4+(B.R()-.5)*.14,.84,.35+(B.R()-.5)*.14],v:[0,.43,0],
        ride:.9,drag:.8,life:1.95,size:.115,fade:1,cols:[24,23,22,21]});
      next=t+.043;
    }});
    return scene;
  }
});
