module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'effect-palettes-night-watch',
  name:'Night watch at Saltgate',
  seed:734,
  build(seed) {
    const B=makeBuilder(seed,[
      0x17212b,0x253543,0x31444e,0x42606a,0x5a7373,0x778983,0x9da594,
      0x273c3b,0x38564c,0x547369,0x6f8b77,
      0x3f3b41,0x61545a,0x7c6564,0x9d8676,0xb49f88,
      0x263b50,0x46677c,0x608595,0x88a4a9,
      0x694c37,0x95694a,0xc09266,0xe4b781,0xffe3ac,
      0x4e3345,0x84505e,0xad6672,0xd78283,0xf0a28a,
      0x386867,0x93d6bb,0xe1f4cd
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.54,.73,.46]); S.amb=.39; S.sky=.22; S.sunK=.49;
    const rock={r:[1,2,3,4,5,6]}, distant={r:[0,1,2,3,4]}, turf={r:[7,8,9,10]};
    const stone={r:[11,12,13,14,15]}, water={r:[16,17,18,19]};
    const bronze={r:[20,21,22,23]}, glow={r:[22,23,24],em:true};
    for (const [x,y,z,w,h,d] of [
      [-19,-1.0,-26,7.6,5.6,6.1],[-11,-.8,-29,7.1,4.1,5.0],[-2.2,-.65,-38,9.1,4.7,4.7],
      [9.4,-.42,-36,8.8,5.8,7.1],[19.2,-.62,-25,8.5,7.5,5.7],
      [-11.2,-.8,-7.6,5.6,1.9,4.6],[-8.1,-.8,-8.7,3.8,2.1,3.2],
      [8.6,-.8,-4.4,4.5,2.48,3.34],[11.2,-.52,-7.4,4.1,3.7,3.9]
    ]) S.rock([x,y,z],[w,h,d],z < -18 ? distant : rock,{res:.26});
    for (const [x,y,z,w,h,d] of [[-6.5,-.57,-3.9,4.4,1.08,2.95],[-3.9,-.7,-7.2,2.1,.93,4.28],
      [7.35,-.62,-2.62,2.9,1.06,2.38],[-6.6,-.42,2.9,2.8,1.25,2.5],[4.5,-.66,2.7,2.6,.95,2.3]]) {
      S.rock([x,y,z],[w,h,d],rock,{res:.19});
      S.rock([x-.10,y+h*.55,z],[w*.89,h*.41,d*.83],turf,{res:.18});
    }
    S.box([0,-.77,-16],[22,.08,28],water,{res:.64,ghost:true});
    S.box([.11,-.13,-3.2],[2.14,.33,9.1],rock,{res:.19,rd:.135});
    for (let j=0;j<18;j++) for (let x=-2;x<=2;x++) {
      const z=4-j*.56, offset=.18*Math.sin(j*.33);
      S.box([offset+x*.62,.222,z],[.294,.053,.263],j%4 ? stone : rock,{res:.095,rd:.037});
    }
    const marker={r:[30,31,32],em:true,materialId:'waypoint'};
    for (const [x,z,h] of [[-1.78,2.8,.83],[1.93,.4,.65],[-1.75,-2.35,.73],[1.77,-5.8,.63]]) {
      S.box([x,.29,z],[.206,.10,.21],rock,{res:.077,rd:.042});
      S.lathe([x,.35,z],h,[.069,.051],bronze,{res:.043});
      S.ball([x,.46+h,z],[.091,.125,.089],marker,{res:.034});
      S.lathe([x,.58+h,z],.12,[.133,.016],bronze,{res:.042});
    }
    const tx=-4.63,tz=-2.30,base=.17;
    const tower=(y,h,r0,r1,mat,res=.077)=>S.lathe([tx,base+y,tz],h,[r0,r1],mat,{res});
    tower(0,.27,.80,.72,stone);
    tower(.27,2.62,.63,.45,rock);
    tower(2.88,.15,.51,.68,stone);
    tower(3.04,.12,.63,.55,bronze);
    S.ball([tx,base+3.38,tz],[.407,.245,.397],glow,{res:.055,ghost:true});
    for (let i=0;i<6;i++) {
      const a=i*Math.PI/3;
      S.lathe([tx+.44*Math.cos(a),base+3.16,tz+.44*Math.sin(a)],.51,[.034,.031],bronze,{res:.041});
    }
    tower(3.67,.12,.56,.62,bronze);
    tower(3.79,.50,.60,.076,stone);
    tower(4.26,.33,.038,.019,bronze);
    for(const y of [1.1,2.02]) S.box([tx+.05,base+y,tz+.49],[.077,.15,.059],glow,{res:.044,rd:.025});
    K.build.arch(S,[.10,.24,-5.40],{span:2.83,height:2.9,depth:.57,thick:.39,block:.38,res:.10,mats:{stone}});
    for (const side of [-1,1]) for(let i=0;i<6;i++)
      S.box([side*(2.05+.42*i),.5,-5.49],[.213,.32,.27],rock,{res:.094,rd:.045});
    for (const [x,z,h] of [[-8.1,-2.7,2.42],[-6.7,-5.7,1.93],[7.2,-3.19,2.86],[8.49,-2.1,2.43],[-6.95,2.2,2.28]]) {
      S.lathe([x,.35,z],h*.94,[.103,.038],stone,{res:.073});
      for(let i=0;i<5;i++) S.lathe([x+.042*i,.35+h*(.23+.135*i),z],h*.27,[h*(.24-i*.025),.018],turf,{res:.076});
    }
    const hero={r:[26,27,28,29],materialId:'coat'}, gear={r:[1,2,3,4]}, face={r:[20,21,22,23,24]};
    const xy=[.54,1.91], tag={objectId:'courier',res:.043};
    const at=(x,y,z)=>[xy[0]+x,.32+y,xy[1]+z];
    S.lathe(at(0,.34,0),.62,[.26,.23],hero,tag);
    S.box(at(0,.51,-.17),[.225,.242,.104],bronze,{...tag,rd:.053});
    for (const side of [-1,1]) {
      S.box(at(side*.11,.18,0),[.083,.18,.086],gear,{...tag,rd:.035});
      S.box(at(side*.115,.058,.056),[.083,.067,.132],gear,{...tag,rd:.035});
      S.ball(at(side*.249,.66,.018),[.095,.217,.104],hero,tag);
    }
    S.ball(at(0,1.026,.045),[.172,.185,.154],face,tag);
    S.lathe(at(0,1.15,.033),.079,[.214,.205],hero,tag);
    S.ball(at(0,1.21,.03),[.152,.09,.16],hero,tag);
    S.box(at(.016,1.036,.182),[.124,.047,.03],gear,{...tag,res:.026,rd:.021});
    for (const x of [-.048,.069]) S.ball(at(x,1.038,.216),[.019,.025,.014],marker,{...tag,res:.016});
    S.bake();
    const cloudField=K.clouds.compile({
      bounds:{min:[-45,-77],max:[45,-7]},resolution:[90,82],height:6.0,thickness:1.8,steps:21,
      color:'#4e5574',opacity:.94,velocity:[1.55,.17],
      lighting:{color:'#bdb2bd',ambient:.43,strength:.56,rim:.31},
      coverage(x,z){
        const ribbon=Math.sin(x*.185+z*.35)+.56*Math.cos(z*.56-x*.16)+.31*Math.sin(x*.81+.24*z);
        const edge=K.clamp((z+77)*.23,0,1)*K.clamp((-z-7)*.54,0,1);
        return edge*K.clamp(.28+.48*ribbon,0,1);
      }
    });
    const clouds=['#221e41','#382b57','#563d68','#7b547d','#a57594','#c5a5b0'];
    const fog=['#254858','#306173','#3d7b87','#58979a','#78adb0','#a4c9c0'];
    const night=['#0b1231','#131d43','#1c2b59','#2c3e70','#414a83','#a8b9ed'];
    const emission=['#9a402f','#cf5934','#ee8645','#ffc376','#fff1c2'];
    const effectPalettes={
      protect:{objects:['courier'],materials:['waypoint']},
      fog:{colors:fog,geometry:true,threshold:.54,range:[.29,.69],dither:.25},
      clouds:{colors:clouds,threshold:.25,range:[.24,.69],dither:.29},
      sky:{colors:night,threshold:.40,range:[.08,.73],dither:.18,when:{channel:'daylight',max:.38}},
      emission:{colors:emission,threshold:.29,range:[.29,.90]}
    };
    const star=(id,x,y,radius)=>({id,kind:'star',radius,keys:[{at:0,azimuth:Math.PI-x,elevation:y}],color:'#b3c4fb'});
    const celestialTracks={bodies:[
      {id:'moon',kind:'moon',radius:.046,phase:.45,roll:.48,glow:.08,
        keys:[{at:0,azimuth:Math.PI+.33,elevation:.254}],color:'#dbe4ff'},
      ...Array.from({length:39},(_,i)=>star('star-'+i,(K.hash(seed,i,1)-.5)*1.41,.09+K.hash(seed,i,2)*.42,
        .0016+K.hash(seed,i,3)**4*.0033))
    ]};
    const nightSky={defaults:{ zenith:'#19244d',horizon:'#676988',ground:'#3b5264',sunStrength:0,daylight:.18 }};
    const mist=K.atmosphere.fog({id:'tidal-mist',density:.135,color:'#7fabac',bottom:-1.42,top:1.50,near:8.9,far:31});
    const haze=K.atmosphere.sphere({id:'harbor-mist',at:[-1.1,-.1,-8.8],radius:3.4,density:.31,color:'#688f9e'});
    return B.finish({
      cam:{target:[-.37,1.87,-2.72],dist:16.2,yaw:.059,pitch:-.015,sway:0},radius:56,detail:26,dither:.24,
      outline:{c:0,edge:.175},skyEnvironment:nightSky,celestialTracks,cloudField,atmosphere:[mist,haze],
      look:{effectPalettes}
    });
  }
});
