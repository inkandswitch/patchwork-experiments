module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'dual-surface-studies',
  name: 'Cell fits on carved stone',
  seed: 0,
  build(seed) {
    const B=makeBuilder(20,[
      0x19272d,0x34444b,0x536063,0x707975,0x969681,
      0x545044,0x766952,0x9a8260,0xc7a676,0xe4c28c,
      0x344749,0x536e69,0x77918a,0x98af9b,0xc3c5a3,
      0x503e3d,0x795448,0xa96f55,0xcd9070,0xe2ad85
    ]),S=K.sculpt(makeSculpt(B)),G=K.procedural.geometry;
    for(const [i,method] of ['surfaceNets','dualContour'].entries()){
      const x=i ? 1.45 : -1.45,
        sd=(a,b,c)=>{
          const u=a-x,v=b-0.99,
            outer=Math.max(Math.abs(u)-0.85,Math.abs(v)-0.83,Math.abs(c)-0.46),
            cut=Math.max(Math.abs(u+0.22)-0.26,Math.abs(v+0.18)-0.37),
            chip=(u+v-1.31)*Math.SQRT1_2;
          return Math.max(outer,-cut,chip);
        },
        bounds={min:[x-1.03,0,-0.75],max:[x+1.03,1.94,0.75]},
        fit=G[method](sd,bounds,{cell:seed%2 ? 0.19 : 0.155});
      S.box([x,-0.06,0],[1.24,0.15,0.86],{r:[1,2,3,4]},{rd:0.075,res:0.069});
      S.add({
        bc:[x,0.98,0],br:1.36,sd,
        sample(emit){
          for(const p of fit.points) emit(...p);
        }
      },{r:i?[10,11,12,13,14]:[5,6,7,8,9]},{
        res:0.14,
        reach:0.025
      });
      if(seed%2) for(const [j,p] of fit.points.entries()){
        if(j%4 || p[2]<0.445) continue;
        S.ball(K.V.mad(p,fit.normals[j],0.016),[0.021,0.021,0.021],{r:[15,16,17,18,19]},{res:0.032});
      }
    }
    S.bake();
    return B.finish({ cam:{target:[0,0.8,0],dist:7.6,pitch:0.34,yaw:0.31},detail:22,dither:0.16,radius:3.37 });
  }
});
