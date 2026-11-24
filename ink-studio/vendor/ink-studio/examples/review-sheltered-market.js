const reviewCamera = require('./environment-review-camera.js');

module.exports = ({KIT:K,makeBuilder,makeSculpt}) => {
  const camera = reviewCamera([
    {time:0,target:[-.22,1.27,-.30],dist:10.8,yaw:.32,pitch:.29},
    {time:2.3,target:[-.39,1.16,-.46],dist:9.7,yaw:.095,pitch:.28},
    {time:4.6,target:[-.74,1.19,-.56],dist:9.5,yaw:-.23,pitch:.22}
  ]);
  return {
    id:'review-sheltered-market',name:'Rain at the sheltered market',seed:36,
    review:{duration:4.6,checkpoints:[0,2.3,4.5]},
    animate:camera.animate,
    build(seed) {
      const B = makeBuilder(seed,[
        0x243447,0x394a5b,0x54606b,0x697179,0x9b9386,0xb6aaa0,
        0x372c36,0x573b3d,0x845942,0xb28057,0xceac76,
        0x693550,0x984c63,0xc46e78,0xe39685,0xe3cc9d,0xffe5b4,
        0x264952,0x356872,0x4c8b89,0x72a89d,
        0x72783b,0xb49d48,0xdcad54,0xf1d469,0xea8651,0xb65049,
        0x25405a,0x375b76,0x6492ad,0x9ab8c6,0xffb669,0xffefba
      ]);
      const S = K.sculpt(makeSculpt(B));
      S.amb=.40;
      S.sky=.20;
      S.sun=K.V.norm([-.41,.71,.58]);
      const stone={r:[1,2,3,4,5]}, timber={r:[6,7,8,9,10]}, glow={r:[31,32],em:true};
      const fabric=[[11,12,13,14],[8,10,15,16],[17,18,19,20]];
      const pool={id:'market-puddle',kind:'water',y:.066,min:[.20,-1.47],max:[3.81,2.40]};
      const mirror=K.reflection.plane({id:pool.id,at:[0,pool.y,0]});
      const water=K.reflection.material(K.surface.material({r:[27,28,29],a:.86},{
        rainRipple:pool.id,layers:{
          sky:{type:'reflection',source:'scene',strength:.62,f0:.69},
          glints:{type:'specular',color:'#cceaf4',roughness:[.12,.18],strength:.48}
        }
      }),pool.id,{f0:.88,strength:.99,distortion:9,blur:.56,color:'#c0d9e8'});
      S.box([-.1,-.235,.08],[5.04,.22,3.43],stone,{res:.18,rd:.1});
      for (let i=0;i<17;i++) for (let j=0;j<12;j++) {
        const x=-4.8+i*.585+(j%2)*.093, z=-3.05+j*.567;
        if (x>pool.min[0]-.2 && x<pool.max[0]+.2 && z>pool.min[1]-.2 && z<pool.max[1]+.2) continue;
        const paving=(i+3*j)%5===0 ? {r:[0,1,2,3,4]} : stone;
        S.box([x,.003,z],[.287,.056,.282],paving,{res:.124,rd:.042,objectId:'aisle-paving'});
      }
      for (const x of [pool.min[0]-.05,pool.max[0]+.05])
        S.box([x,.038,.465],[.094,.073,1.98],stone,{res:.094,rd:.027});
      for (const z of [pool.min[1]-.05,pool.max[1]+.05])
        S.box([2,.038,z],[1.81,.073,.092],stone,{res:.094,rd:.027});
      S.box([2,pool.y-.009,.465],[1.80,.009,1.93],water,{res:.091,ghost:true});

      const lights=[];
      for (const [x,z,stripe] of [[-2.76,-.87,0],[2.53,-2.50,2]]) {
        for (const dx of [-1.37,1.37]) for (const dz of [-.68,.64]) {
          S.box([x+dx,1.33,z+dz],[.078,1.33,.086],timber,{res:.093,rd:.028});
          S.box([x+dx,.13,z+dz],[.14,.13,.15],stone,{res:.080,rd:.041});
        }
        S.box([x,2.64,z+.68],[1.53,.085,.086],timber,{res:.088,rd:.030});
        for (let i=0;i<12;i++) {
          const xx=x+(i-5.5)*.263, cloth={r:fabric[i%2 ? 1 : stripe]};
          for (let j=0;j<6;j++) {
            const zz=z+(j-2.5)*.316, height=2.89-.19*((j-2.5)/2.5)**2;
            S.box([xx,height,zz],[.134,.052,.171],cloth,{res:.082,rd:.035});
          }
          S.box([xx,2.58,z+.92],[.124,.134,.057],cloth,{res:.066,rd:.051});
        }
        S.box([x,.70,z],[1.16,.065,.445],timber,{res:.080,rd:.032});
        for (const dx of [-.95,.95]) S.box([x+dx,.37,z],[.089,.35,.33],timber,{res:.087,rd:.021});
        for (let i=0;i<4;i++) {
          const xx=x-.81+i*.54;
          S.box([xx,.836,z],[.22,.082,.30],timber,{res:.069,rd:.032});
          const produce={r:[[22,23,24],[25,23,24],[21,22,23],[26,25,24]][i]};
          for (const dx of [-.105,.10]) for (const dz of [-.15,.02,.17])
            S.ball([xx+dx,.96,z+dz],[.081,.079,.082],produce,{res:.066,...(stripe===0 && {objectId:'west-produce'})});
        }
        for (const dx of [-.91,.91]) {
          const p=[x+dx,2.21,z+.77];
          S.box(p,[.122,.149,.11],glow,{res:.059,rd:.034,...(stripe===0 && {objectId:'west-lanterns'})});
          S.lathe([p[0],p[1]+.14,p[2]],.16,[.15,.044],timber,{res:.052});
          lights.push({p,radius:2.48,intensity:2.55,color:[1,.68,.36]});
        }
      }
      for (const [x,z] of [[-.40,2.79],[3.96,-.86],[.8,-2.63]]) {
        S.lathe([x,.04,z],1.51,[.072,.045],timber,{res:.073});
        const p=[x,1.68,z];
        S.box(p,[.102,.151,.098],glow,{res:.053,rd:.032});
        S.lathe([x,1.80,z],.18,[.143,.04],timber,{res:.056});
        lights.push({p,radius:2.35,intensity:2.35,color:[1,.67,.31]});
      }
      for (const [x,h,z,w] of [[-5.2,3.45,-4.54,2.4],[-1.7,3.14,-4.72,1.51],[1.5,2.88,-4.90,1.79],[5.4,3.85,-5.67,2.15]]) {
        S.box([x,h*.5-.48,z],[w,h*.5,.57],stone,{res:.19,rd:.17});
        S.box([x,h-.42,z],[w+.09,.13,.73],timber,{res:.155,rd:.093});
        for (const dx of [-.58,.57])
          S.box([x+dx,h*.69,z+.58],[.16,.25,.030],{r:[9,10,31]},{res:.082,rd:.026});
      }
      S.bake();
      K.weather.fall(B,{kind:'rain',worldSpace:true,profile:true,n:920,seed,top:4.8,
        ground:()=>0,box:[-5.1,5,-3.5,4.5],cols:[29,30,30],len:.139,size:.009,speed:7.8});
      const skyEnvironment={
        defaults:{zenith:'#344969',horizon:'#aabac9',ground:'#5c7384',sunStrength:.1,
          rain:.42,fogDensity:.86,windX:.40,windZ:.20,overcast:.67},
        profiles:{squall:{rain:.91,fogDensity:1.6,windX:1.1,windZ:.45}}
      };
      const front={id:'aisle-squall',profile:'squall',radius:[2.65,2.8],feather:.45,route:[
        {at:0,xz:[3.95,2.45]},{at:2.3,xz:[1.91,.88]},{at:4.6,xz:[2.36,-.31]}
      ]};
      return B.finish({
        cam:{...camera.at(0),sway:0},radius:20,detail:26,dither:0,lights,
        skyEnvironment,reflections:[mirror],weatherBinding:{rainFull:.66,fronts:[front],fogVolumes:['market air']},
        sceneExposure:K.weather.exposure({zones:[
          {id:'west awning',min:[-4.39,-.4,-1.84],max:[-1.14,2.72,.22],fade:.38,rain:0,fog:.10,light:.48,wind:.09},
          {id:'back awning',min:[.91,-.4,-3.48],max:[4.17,2.72,-1.43],fade:.38,rain:0,fog:.23,light:.60,wind:.18}
        ]}),
        atmosphere:[K.atmosphere.box({id:'market air',min:[-5.5,.07,-4.18],max:[5.5,3.55,3.9],
          color:'#94b5cc',density:.046})],
        precipitation:{lightStrength:.55},
        rainImpacts:{maxSources:64,receivers:[pool],ripple:{amplitude:.38,scale:.37,speed:1.5,width:.17,lifetime:.80}}
      });
    }
  };
};
