/* A rainy landing with one gust and five presentation clocks. The shot loops in four seconds. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'motion-cadence',
  name: 'Rain at the lantern landing',
  seed: 41,
  build(seed) {
    const B = makeBuilder(seed, [
      0x202e3e,0x304556,0x3c5562,0x567079,0x7792a0,0x9eb2b5,
      0x2a3840,0x435858,0x5a7564,0x74906f,0x9eba83,
      0x3a2b38,0x623a42,0x8b494c,0xb15c55,0xdd7e64,0xe9a779,
      0x624539,0x9b6b4a,0xc39463,0xffd482,0xffedb5,
      0x233f54,0x2e536a,0x3e687e,0x6696a2,0x9ac0bf
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{ sun: K.V.norm([-.4,.7,.6]), amb: .43, sky: .26, sunK:.55 });
    const stone = { r:[1,2,3,4,5] }, wood = { r:[11,17,18,19] };
    const box = (at,half,material,res=.13) => S.box(at,half,material,{ res, rd:res*.51 });
    const cycle = Math.PI/2;
    const pool = K.surface.preset('rippling-water',{ r:[22,23,24,25] },{
      normal:{ sample:([x,,z],time) => [
        .22*Math.sin(x*2.65+z*1.75 + time*cycle*2), 0,
        .19*Math.sin(z*2.25-x*.85 - time*cycle*3)
      ] }
    });
    box([0,-.46,-.1],[4.74,.27,2.46],stone);
    S.box([.03,-.166,1.29],[4.64,.05,1.06],pool,{ res:.085, ghost:true });
    box([0,-.125,-.61],[4.64,.21,.90],stone);
    for (let i=0;i<14;i++) box([(i-6.5)*.64,.074,-.57],[.313,.049,.86],i%4 ? stone : { r:[2,3,4] },.10);
    for (const [x,h,z,r] of [[-5.4,1.8,-5.1,2.6],[-2.5,1.3,-5.7,2.4],[.54,2.25,-6.85,2.9],[4.1,1.93,-5.9,2.8],[6.8,2.8,-7.6,2.8]])
      S.rock([x,-.75,z],[r,h,r*.58],{r:[0,1,2,3,4]},{res:.26});
    for (const x of [-2.1,2.45]) {
      box([x,.83,-.58],[.092,.83,.095],wood,.076);
      box([x,.18,-.58],[.17,.17,.15],stone,.09);
    }
    box([.15,2.42,-.57],[2.63,.095,.142],wood,.10);
    box([-.9,2.30,-.42],[1.25,.038,.040],wood,.073);
    box([2.45,1.75,-.58],[.054,.25,.052],wood,.064);
    S.lathe([2.45,1.81,-.58],.14,[.14,.05],wood,{res:.061});
    S.lathe([2.45,1.48,-.58],.065,[.12,.084],wood,{res:.055});
    for (const x of [2.32,2.58]) box([x,1.68,-.48],[.023,.169,.034],wood,.046);
    S.bake();

    const fabric = K.procedural.airflow.pinned({ channel:'cloth', reach:1.12, frequency:.025, phaseTravel:2.3 });
    for(let j=0;j<=12;j++) for(let i=0;i<=30;i++) {
      const u=i/30, v=j/12, bar=i<2 || i>28 || j<1 || j>11;
      const crest = Math.abs(u-.52) + Math.abs(v-.51)*.54 < .16;
      B.disc(-2.05+u*2.28,2.29-v*(1.22+.13*Math.sin(u*Math.PI)),-.46+.05*Math.sin(u*23),
        [0,0,1],.052,.021,B.P[bar?19:crest?16:13+(i%4<2?1:0)],3,fabric(v,v));
    }
    for(let i=0;i<49;i++) {
      const x = -4.38 + B.R()*2.4, z = -.02 - B.R()*.64, height = .28+B.R()*.53;
      const flex = K.procedural.airflow.pinned({ reach: .46+B.R()*.50, frequency:.02, phase:B.R()*6 });
      for(let j=0;j<=6;j++) {
        const u=j/6;
        B.disc(x-.09*u*u,.112+height*u,z,[0,0,1],.037-u*.006,.020,B.P[j>=5?10:7+i%3],3,flex(u));
      }
    }
    B.disc(2.45,1.68,-.422,[0,0,1],.134,.041,B.P[20],3,{k:1,em:true,nd:true,sp:cycle*2,ph:.13});
    B.disc(2.45,1.68,-.400,[0,0,1],.076,.031,B.P[21],2,{k:1,em:true,nd:true,sp:cycle*2,ph:.31});
    B.iso(2.45,1.68,-.38,.263,B.P[16],.32,{k:1,em:true,nd:true,sp:cycle*2,ph:.18});

    const first = B.count();
    for (let i=0;i<290;i++) {
      const x=-5.04+10.08*B.R(), z=-2.3+5.16*B.R();
      B.stick(x,4.3,z,[.13,-.989,.06],.12,.014,B.P[i%4===0?5:26],.76,
        {k:2,ph:B.R(),sp:i%2 ? 9 : 4.5,rg:4.5,nd:true});
    }
    B.describePrecipitation(first,B.count());
    return B.finish({
      cam:{ target:[.05,1.14,.02], dist:11.5, yaw:.06, pitch:.18, sway:0 },
      radius:16, dither:0, detail:21,
      skyEnvironment:{ defaults:{zenith:'#263b56',horizon:'#728da4',ground:'#415d6d',sunStrength:0} },
      windField:{ velocity:[1.66,.41],gust:{amplitude:.56,period:4,phase:-Math.PI/2} },
      lights:[{p:[2.44,1.58,-.30],r:2.25,s:1.2,color:'#ffd482'}],
      look:{ splatCoverage:'continuous', artDirection:{
        cadence:{foliage:8,cloth:4,rain:12,water:6,emissive:3},
        windResponse:{water:.34,emissive:.17}
      } }
    });
  }
});
