/* Three palette fields in the windows of a hillside print workshop. */
const field = require('./hue-brightness-field.json');

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'hue-brightness', name: 'The prism workshop', seed: 41,
  build(seed) {
    const B = makeBuilder(seed, field.palette.map(hex => parseInt(hex.slice(1), 16)));
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{ sun:K.V.norm([-.5,.77,.55]), amb:.45, sky:.22, sunK:.53 });
    const stone = { r:[1,2,3,4,5] }, plaster = { r:[2,3,4,5,6] }, brass = { r:[15,16,17,13] };
    const roof = { r:[8,9,10,11] }, timber = { r:[0,1,2,3] }, green = { r:[20,21,22,23] };
    const box = (at, half, material, res=.12) => S.box(at,half,material,{ res, rd: res*.51 });
    box([0,-.45,.2],[5.6,.28,3.5],stone);
    box([0,1.67,-1.03],[4.51,1.82,.53],plaster);
    box([0,.36,-.18],[4.78,.145,1.08],stone);
    box([0,.17,.57],[4.89,.11,1.24],stone);
    box([0,3.47,-.94],[4.82,.24,.77],roof);
    box([0,3.22,-.39],[4.69,.079,.19],brass,.10);
    for (let i=0;i<18;i++) {
      box([(i-8.5)*.52,3.64,-.99],[.238,.081,.72],roof,.109);
      box([(i-8.5)*.52,.298,.77],[.247,.042,.69],i%3?stone:plaster,.11);
    }
    for (const x of [-4.53,-1.47,1.47,4.53]) {
      box([x,1.73,-.22],[.158,1.43,.22],timber,.098);
      box([x,.45,-.19],[.235,.14,.29],plaster,.087);
      box([x,3.00,-.2],[.222,.10,.28],brass,.087);
    }
    for (const [i,x] of [-2.95,0,2.95].entries()) {
      const saturation = [.90,.32,.68][i], brightness = i === 2 ? [.05,.56] : [0,1];
      const frame = K.surface.material({ r:[1,2,3] },{ layers:{ spectrum:{
        type:'projected', pattern:'hue-brightness',
        projection:{origin:[x-1.12,.76,.02],along:[1,0,0],across:[0,1,0]},
        hueBrightness:{...field,saturation,brightness,size:[2.24,1.98]}
      } } });
      box([x,1.75,.01],[1.13,.99,.04],frame,.074);
      for (const dx of [-1.16,1.16]) box([x+dx,1.75,.075],[.057,1.06,.06],brass,.068);
      for (const y of [.72,2.78]) box([x,y,.077],[1.21,.048,.066],brass,.067);
      box([x,.65,.10],[1.28,.049,.18],stone,.087);
      for (const dx of [-.68,.68]) box([x+dx,1.75,.067],[.021,.99,.021],timber,.056);
      box([x,2.44,.071],[1.12,.021,.023],timber,.056);
    }
    for (const [x,z,sz] of [[-4.9,1.11,.46],[-3.83,1.82,.31],[4.92,.87,.49],[4.08,1.84,.37]]) {
      S.rock([x,.08,z],[sz,sz*.74,sz*.86],green,{res:.081});
      for (const dx of [-.18,.05,.17]) S.rock([x+dx,.25,z],[sz*.45,sz*.76,sz*.45],green,{res:.071});
    }
    for (const [x,z,r] of [[-8,-5,4],[6,-6,4.8],[-2,-10,4],[2,-9,3]])
      S.rock([x,-1,z],[r,r*.6,r],stone,{res:.24});
    S.bake();
    return B.finish({
      cam:{target:[0,1.68,-.09],dist:14,yaw:.073,pitch:.125,sway:0},
      radius:20, detail:25, dither:0,
      skyEnvironment:{defaults:{zenith:'#2d3e53',horizon:'#a1bab5',ground:'#3f5768',sunStrength:0}},
      look:{splatCoverage:'continuous'}
    });
  }
});
