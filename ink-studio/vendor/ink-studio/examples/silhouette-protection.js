module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'silhouette-protection',
  name:'Courier at the mist beacon',
  seed:89,
  build(seed, {controls}={}) {
    const B=makeBuilder(seed,[
      0x24394a,0x2a3f4f,0x365260,0x496672,0x5e7880,0x7a9295,0xa7b2aa,
      0x364b42,0x486452,0x5e7962,0x7a9274,0x9da088,
      0x3b3040,0x603748,0x95485a,0xbf5460,0xdf785f,0xf4aa75,
      0x392e37,0x59414a,0x84585b,0xaf7264,0xcf936f,0xe6b582,
      0x8a5c44,0xbb8155,0xe7ab6a,0xffd995,0xfff0c2
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.captureAlbedo=true;
    S.sun=K.V.norm([-.61,.73,.41]); S.amb=.41; S.sky=.20; S.sunK=.54;
    const stone={r:[1,2,3,4,5]}, basalt={r:[0,1,2,3,4]}, moss={r:[7,8,9,10,11]};
    const copper={r:[18,19,20,21,22,23]}, brass={r:[24,25,26,27]}, light={r:[25,26,27,28],em:true};
    S.lathe([0,-.86,0],.66,[4.3,4.0],basalt,{res:.152});
    S.lathe([0,-.20,0],.29,[4,3.90],stone,{res:.126});
    for(let i=0;i<34;i++) {
      const a=Math.PI*2*i/34, angle=a+.14*Math.sin(i*2.11), x=Math.sin(angle)*3.71,z=Math.cos(angle)*3.71;
      if(i%7!==2) S.rock([x,-.21,z],[.57,.30+.09*Math.sin(i*3),.50],moss,{res:.115});
    }
    for(let z=-4;z<=4;z++) for(let x=-4;x<=4;x++) {
      if(x*x+z*z>27 || (x+2*z)%7===0) continue;
      S.box([x*.73+.041*Math.sin(z*2),.106,z*.69],[.339,.052,.318],(x-z)%3 ? stone : basalt,{res:.104,rd:.048});
    }
    for (const [x,y,z,w,h,d] of [
      [-7.8,-.5,-7.5,2.3,2.8,2.14],[5.4,-.55,-9.4,2.23,2.37,2.15],[9.8,-.58,-1.1,2.62,2.6,2.83],
      [5.6,-.56,6.0,2.56,1.96,3.17],[-2.8,-.52,8.8,2.76,2.71,3.03],[-8.7,-.5,3.8,2.76,2.4,2.2],
      [-10.6,-.5,-1.5,2.6,3.18,2.75]
    ]) S.rock([x,y,z],[w,h,d],stone,{res:.24});
    S.box([0,-.9,0],[19,.09,19],{r:[1,2,3,4]},{res:.55,ghost:true});
    for(const [x,z,h] of [[-2.53,1.8,1.07],[2.47,2.16,.93],[2.89,-1.28,1.2],[-2.42,-2.03,.61]]) {
      S.lathe([x,.16,z],.19,[.25,.23],basalt,{res:.071});
      S.lathe([x,.35,z],h-.28,[.126,.105],copper,{res:.066});
      S.rock([x,h+.08,z],[.19,.16,.15],copper,{res:.066});
    }

    const tower=[-1.13,0,-.98], tag={objectId:'mist-beacon',res:.070};
    const H=(y)=>[tower[0],y,tower[2]];
    S.lathe(H(.16),.22,[.71,.68],basalt,tag);
    S.lathe(H(.38),.18,[.69,.61],copper,tag);
    S.lathe(H(.56),1.64,[.43,.31],copper,tag);
    S.lathe(H(2.14),.14,[.49,.53],brass,tag);
    S.lathe(H(2.28),.10,[.51,.44],copper,tag);
    S.ball(H(2.53),[.269,.223,.27],light,{...tag,res:.047});
    for(let i=0;i<6;i++) {
      const a=Math.PI*i/3;
      S.lathe([tower[0]+.387*Math.sin(a),2.36,tower[2]+.387*Math.cos(a)],.42,[.037,.035],copper,{...tag,res:.033});
    }
    S.lathe(H(2.77),.13,[.5,.48],copper,{...tag,res:.059});
    S.lathe(H(2.90),.39,[.49,.061],brass,{...tag,res:.058});
    S.lathe(H(3.28),.25,[.047,.024],copper,{...tag,res:.035});
    S.box([tower[0]+.035,1.13,tower[2]+.389],[.089,.162,.048],light,{...tag,res:.036,rd:.028});

    const runner=[.96,.15,1.09], actor={objectId:'courier',res:.046};
    const at=(x,y,z)=>[runner[0]+x,runner[1]+y,runner[2]+z];
    const cloth={r:[12,13,14,15,16,17]}, gloves={r:[18,19,20,21]}, face={r:[21,22,23,26,27]};
    S.lathe(at(0,.37,0),.63,[.304,.242],cloth,actor);
    S.box(at(0,.54,-.211),[.215,.253,.115],copper,{...actor,rd:.045});
    S.box(at(0,.54,-.323),[.186,.192,.021],brass,{...actor,res:.033,rd:.015});
    for(const side of [-1,1]) {
      S.box(at(side*.127,.20,.012),[.082,.186,.09],gloves,{...actor,rd:.038});
      S.box(at(side*.139,.064,.071),[.085,.072,.149],gloves,{...actor,rd:.043});
      S.ball(at(side*.278,.704,.027),[.101,.212,.092],cloth,actor);
    }
    S.ball(at(0,1.19,.044),[.185,.181,.158],face,{...actor,surfaceId:'courier-face'});
    S.lathe(at(0,1.274,.042),.124,[.235,.221],cloth,{...actor,res:.035});
    S.ball(at(0,1.408,.039),[.158,.119,.161],cloth,{...actor,res:.044});
    S.box(at(0,1.184,.181),[.129,.036,.031],gloves,{...actor,res:.026,rd:.012});
    S.box(at(.04,1.011,.154),[.159,.060,.066],brass,{...actor,res:.037,rd:.023});
    S.box(at(.264,.94,-.073),[.073,.048,.185],brass,{...actor,res:.031,rd:.026});
    const lantern={...actor,res:.03,surfaceId:'courier-lantern'};
    S.lathe(at(.343,.379,.22),.20,[.047,.047],brass,lantern);
    S.ball(at(.343,.34,.219),[.073,.102,.077],light,{...lantern,target:{tags:['lantern-core']}});
    S.bake();

    const fog=K.atmosphere.sphere({id:'estuary-fog',at:[0,1.28,0],radius:8.6,density:.236,color:'#a2bec7'});
    const banks=K.atmosphere.box({id:'low-fog',min:[-15,-.75,-15],max:[15,.84,15],density:.069,color:'#a8c8ce'});
    return B.finish({
      cam:{target:[-.09,1.22,.09],dist:10.9,yaw:.30,pitch:.27,sway:0},radius:24,detail:28,dither:.15,
      skyEnvironment:{defaults:{zenith:'#3e6681',horizon:'#a5c6cb',ground:'#668a96',sunStrength:0}},
      atmosphere:[fog,banks],volumeQuality:{scale:3},
      look:{...(controls?.lanternAccent && {paletteConstraints:{targets:[
        {select:{tag:'lantern-core'},palette:['#fff0c2'],reserved:[{color:'#fff0c2',match:true}]}
      ]}}),silhouetteProtection:{targets:[
        {id:'courier',select:{object:'courier'},fogScale:.20,contrast:1.37,pivot:.50},
        {id:'mist-beacon',select:{object:'mist-beacon'},fogScale:.41,contrast:1.31,pivot:.50}
      ]}}
    });
  }
});
