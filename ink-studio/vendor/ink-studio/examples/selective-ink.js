/* A courier passing through a stone aqueduct, with named ink targets. */
module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'selective-ink',
  name:'The aqueduct courier',
  seed:87,
  build(seed) {
    const B = makeBuilder(seed,[
      0x24383e,0x39565a,0x557071,0x748c83,0x9ca993,0xc1c5a5,0xebe1b3,
      0x1a3c41,0x27524f,0x3d6d59,0x618862,0x89a66d,0xbab97a,
      0x38263c,0x5a3043,0x8a4049,0xbb5750,0xdf7959,0xf49b66,0xf5bd82,0xfee4a7,
      0x212335,0x35354d,0x545165,0x777182,0xad99a0,0xe0b8a1,0xfee8b4
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{pixel:true,sun:K.V.norm([-.52,.72,.48]),amb:.47,sky:.22,sunK:.55,wob:.014});
    const stone={r:[1,2,3,4,5,6],materialId:'limestone'};
    const trim={r:[2,3,4,5,6],materialId:'trim'};
    const grass={r:[7,8,9,10,11,12]};
    const earth={r:[1,2,3,4,5]};
    const masonry=id=>({objectId:id,target:{tags:['masonry']}});
    const box=(at,half,mat,res,opt={})=>S.box(at,half,mat,{res,rd:res*.55,...opt});
    const arch=(x,y,z,scale,id) => {
      const opt=masonry(id), span=1.15*scale, rise=1.45*scale, width=.23*scale, depth=.30*scale;
      for(const side of [-1,1]) {
        box([x+side*span,y+rise*.47,z],[width,rise*.61,depth],stone,.12*scale,opt);
        box([x+side*span,y+.04,z],[width*1.22,.13*scale,depth*1.2],trim,.10*scale,opt);
      }
      for(let i=0;i<=8;i++) {
        const a=Math.PI*i/8, rx=Math.cos(a), ry=Math.sin(a);
        const axes=[[rx,ry,0],[-ry,rx,0],[0,0,1]];
        box([x+rx*span,y+rise+ry*span,z],[width,width*.98,depth],i===4?trim:stone,
          .105*scale,{...opt,ax:axes});
      }
    };
    box([0,-.35,.0],[6.6,.26,3.4],earth,.17);
    box([3,-.48,-6.65],[13,.24,5],grass,.32);
    for(const [x,y,z,r] of [[-8,-.28,-12,[5,1.6,2.2]],[-4,-.39,-8,[2.8,1.2,1.8]],
      [6,-.31,-16,[3.8,1.7,2.3]],[10,.07,-15,[4.2,1.9,2.7]]])
      S.rock([x,y,z],r,grass,{res:.26});
    for(let j=0;j<5;j++) for(let i=0;i<12;i++) {
      const x=(i-5.3)*.82+.34*(j%2), z=2.57-j*.88;
      box([x,-.08+.018*Math.cos(j*2.54+i),z],[.39,.047,.415],stone,.142,masonry('road'));
    }
    arch(-3.10,.12,-3.85,1.24,'near-gate');
    arch(.75,.02,-8.1,1.32,'middle-gate');
    arch(5.13,-.03,-14.1,1.58,'far-gate');
    arch(9.04,-.08,-14.4,1.58,'east-gate');
    for(const [x,y,z,r] of [[-5.23,.10,1.75,.38],[-3.8,.10,-.43,.32],[.7,.10,2.51,.27],
      [2.2,.16,.62,.29],[3.76,.11,1.56,.45],[2.8,.15,-4.5,.41],[-1.66,.09,-2,.24]]) {
      S.rock([x,y,z],[r,r*.63,r*.91],grass,{res:.087});
      S.tube([[x,y,z],[x-.09,y+r*1.63,z+.05]],.025,.021,grass,{res:.055});
      S.tube([[x,y,z],[x+.10,y+r*1.41,z]],.023,.019,grass,{res:.055});
    }
    const x=-2.05, z=.61;
    const own={objectId:'courier'};
    const boot={r:[21,22,23,24],materialId:'boots'};
    const cloak={r:[13,14,15,16,17,18],materialId:'cloth'};
    const hood={r:[15,16,17,18,19],materialId:'cloth'};
    const scarf={r:[23,24,25,26,27],materialId:'scarf'};
    const glove={r:[14,15,16,17],materialId:'glove'};
    const ball=(at,r,material,res=.061)=>S.ball(at,r,material,{...own,res});
    const limb=(from,to,r,material)=>S.tube([from,to],r,r*.86,material,{...own,res:.056});
    limb([x-.19,.76,z],[x-.30,.23,z+.053],.133,boot);
    limb([x+.12,.78,z-.023],[x+.27,.27,z-.07],.145,boot);
    ball([x-.33,.15,z+.144],[.184,.109,.235],boot);
    ball([x+.26,.15,z+.006],[.184,.109,.235],boot);
    ball([x-.05,.97,z-.02],[.42,.462,.265],cloak);
    ball([x-.35,1.11,z-.13],[.194,.306,.252],glove);
    limb([x+.235,1.12,z],[x+.36,.79,z+.12],.116,cloak);
    ball([x+.371,.77,z+.14],[.105,.141,.105],glove,.048);
    ball([x+.04,1.52,z],[.352,.391,.265],hood,.048);
    ball([x+.135,1.49,z+.209],[.239,.238,.097],boot,.045);
    ball([x+.165,1.395,z+.258],[.223,.088,.065],scarf,.047);
    limb([x+.085,1.547,z+.300],[x+.243,1.548,z+.298],.021,scarf);
    limb([x-.185,1.27,z+.19],[x+.235,1.255,z+.207],.074,scarf);
    limb([x-.175,1.25,z+.11],[x-.49,1.14,z-.005],.067,scarf);
    S.bake();
    return B.finish({
      cam:{target:[.0,1.00,-1.62],dist:9.5,yaw:.068,pitch:.115,sway:0},
      detail:23,radius:14,dither:.04,
      skyEnvironment:{defaults:{zenith:'#6d9392',horizon:'#ddd7a6',ground:'#819f8b',sunStrength:0}},
      aerialPerspective:{start:12,density:.037,contrast:.20},
      look:{
        pixel:true,splatCoverage:'continuous',
        ink:{
          occlusionSilhouettes:true,depthGap:.23,creaseCosine:.43,
          silhouette:{shadow:'#355257',highlight:'#879387'},
          crease:{shadow:'#42656a',highlight:'#78948a'},
          boundary:{color:'#597478'},
          targets:[
            {select:{tag:'masonry'},distance:{near:12,far:19},crease:{distance:{near:10,far:14}}},
            {select:{object:'courier'},silhouette:{shadow:'#301d37',highlight:'#711f45'},crease:false},
            {select:{object:'courier',material:'cloth'},boundary:{color:'#743944'}}
          ]
        }
      }
    });
  }
});
