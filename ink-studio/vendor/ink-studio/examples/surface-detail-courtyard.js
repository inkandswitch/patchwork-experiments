/* A courtyard built from simple forms and six reusable surface layers. */
module.exports = ({ KIT:K,makeBuilder,makeSculpt }) => ({
  id:'surface-detail-courtyard',
  name:'The dyer’s courtyard',
  seed:31,
  build(seed) {
    const B = makeBuilder(seed,[
      0x263640,0x3e5158,0x587074,0x768985,0x9aaa90,0xc1c0a0,0xe3d9b6,0xf8e6bc,
      0x40393c,0x644e4d,0x855d51,0xa56d55,0xc68161,0xdca57a,0xf0bd8d,
      0x503746,0x75454e,0x934e53,0xaf6053,0xca7661,0xe18e6c,0xf4a582,
      0x243c40,0x32524f,0x3e6c65,0x4f8e80,0x69a591,0x95bb9f,
      0x39453b,0x4d5f40,0x62764c,0x7b9055,0x98a968,0xbab879,
      0x645857,0x887569,0xa58b72,0xcaac89,0xe0bf9a,0xf3d7a9,
      0x503d43,0x76504b,0x9b6b55,0xbc936c,0xe0b384,0xffe6b8
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{pixel:true,sun:K.V.norm([-.57,.64,.57]),amb:.53,sky:.15,sunK:.52,wob:.018});
    const add=(recipe,settings={},strength=1)=>({type:'detailKit',strength,pattern:{recipe,...settings}});
    const finish=(r,layers)=>K.surface.material({r},{layers});
    const stoneRamp=[1,2,3,4,5,6];
    const plainStone={r:stoneRamp}, trim={r:[34,35,36,37,38,39]};
    const timber={r:[40,41,42,43,44]}, darkWood={r:[8,9,10,11,12]};
    const masonry=finish(stoneRamp,{
      courses:add('stone-joints',{size:[.72,.34],width:.076,colors:['#475452','#82958b','#d3ceaa']}),
      moss:add('crevice-moss',{width:.17,coverage:.78,exposure:{channel:'rain',range:[.24,.91],invert:true}})
    });
    const brick=add('exposed-brick',{size:[.48,.229],width:.051,seed:9,colors:['#ba9c7d','#bf7357','#edab78']});
    const plaster=finish([34,35,36,37,38,39],{
      undercoat:brick,
      render:add('chipped-plaster',{size:[1.16,.84],width:.075,coverage:.54,seed:6,
        colors:['#9b785d','#e3c098','#fae5b6']})
    });
    const exposed=finish([15,16,17,18,19,20],{brick});
    const paving=finish([1,2,3,4,5,6],{
      slabs:add('stone-joints',{axes:['x','z'],size:[.72,.65],width:.079,stagger:.35,
        colors:['#4c5954','#879085','#d1c7a2']}),
      moss:add('crevice-moss',{crevices:'joints',width:.12,coverage:.69,
        exposure:{channel:'rain',range:[.28,.91],invert:true}})
    });
    const z=-.68, cloth=finish([22,23,24,25,26],{
      hem:add('cloth-stitching',{origin:[0,1.19,0],size:[.19,.32],width:.073,seed:32}),
      top:add('cloth-stitching',{origin:[0,2.30,0],size:[.19,.32],width:.067}),
      side:add('cloth-stitching',{origin:[1.19,0,0],axes:['y','x'],size:[.19,.24],width:.062})
    });
    const box=(at,half,mat,res=.091,opt={})=>S.box(at,half,mat,{res,rd:res*.46,...opt});
    box([0,-.235,.2],[5.38,.22,3.49],paving,.148);
    box([0,-.44,.2],[5.49,.12,3.58],plainStone,.166);
    box([-1.95,1.60,-1.94],[2.62,1.66,.75],plaster,.12);
    box([2.99,1.27,-1.28],[1.69,1.38,1.30],exposed,.13);
    box([-1.95,.355,-1.87],[2.71,.38,.87],masonry,.102);
    box([3.00,.195,-1.21],[1.75,.24,1.40],masonry,.105);
    box([-1.96,3.30,-1.60],[2.72,.11,1.24],trim,.111);
    box([-1.92,3.50,-2.02],[2.55,.10,.81],masonry,.12);

    // The roof courses use the local incline as their second projection axis.
    const angle=.48, cu=Math.cos(angle), si=Math.sin(angle);
    for (const sign of [-1,1]) {
      const slope=[0,-sign*si,cu], up=[0,cu,sign*si];
      const tiles=finish([15,16,17,18,19,20,21],{courses:add('roof-seams',{
        axes:['x',slope],normal:{axis:up,range:[.30,.73]},size:[.54,.35],width:.105,seed:13,
        colors:['#674451','#b86a5a','#efae79']})});
      box([3.01,3.11,-1.26+sign*.72],[1.91,.108,.83],tiles,.091,{ax:[[1,0,0],up,slope]});
    }
    S.tube([[1.08,3.53,-1.26],[4.94,3.53,-1.26]],.091,.086,trim,{res:.062});

    box([-3.48,1.27,-1.105],[.54,.88,.057],darkWood,.081);
    box([-3.48,1.31,-1.021],[.47,.84,.038],timber,.067);
    for(const x of [-3.85,-3.62,-3.38,-3.15])
      box([x,1.32,-.969],[.018,.74,.022],darkWood,.046);
    for(const y of [.78,1.85]) box([-3.47,y,-.936],[.52,.045,.05],trim,.049);
    S.ball([-3.19,1.23,-.84],.060,{r:[10,12,14,45]},{res:.041});
    box([-3.48,.25,-.763],[.64,.098,.39],masonry,.079);
    box([-3.48,.11,-.53],[.75,.084,.38],masonry,.088);

    for (const x of [-1.83,3.1]) {
      box([x,2.02,x<0?-1.106:.045],[.41,.51,.058],trim,.066);
      box([x,2.04,x<0?-.996:.15],[.32,.42,.049],darkWood,.060);
      box([x,1.51,x<0?-.942:.22],[.51,.067,.12],masonry,.057);
      for(const dx of [-.18,.18])
        box([x+dx,2.04,x<0?-.928:.222],[.028,.37,.035],timber,.048);
      box([x,2.06,x<0?-.91:.244],[.31,.028,.042],timber,.042);
    }
    S.tube([[-.67,2.45,z],[1.34,2.45,z]],.051,.043,timber,{res:.055});
    // The same material crosses the board's slight shape changes.
    box([.34,1.74,z],[.94,.68,.037],cloth,.057,{rd:.036});
    for(const x of [-.51,.11,.70,1.18])
      S.tube([[x,2.33,z],[x,2.50,z]],.031,.026,timber,{res:.035});
    for(const x of [-.53,-.34,-.15,.04,.23,.42,.61,.80,.99,1.17])
      S.tube([[x,1.14,z],[x+.025,1.05,z+.018]],.017,.013,trim,{res:.033});
    for(const [x,y,r] of [[-.12,1.70,.175],[.40,1.78,.247],[.84,1.69,.16]]) {
      S.torus([x,y,z+.051],r,.025,trim,{res:.034,ax:[[1,0,0],[0,0,1],[0,-1,0]]});
    }

    for (const [x,z,r] of [[-2.13,.35,.26],[1.60,.59,.31],[4.31,.60,.28]]) {
      S.lathe([x,.014,z],r*1.75,[r*.57,r],{r:[10,11,12,13,14]},{res:.059});
      S.torus([x,r*1.71,z],r*.94,.040,trim,{res:.040});
      for(const [dx,dz] of [[-.07,.05],[.06,.10],[.08,-.05],[-.05,-.07]]) {
        const tip=[x+dx*1.5,r*2.65,z+dz*1.37];
        S.tube([[x,r*1.56,z],tip],.020,.012,{r:[28,29,30,31]},{res:.038});
        S.ball(tip,[.070,.11,.07],{r:[29,30,31,32,33]},{res:.049});
      }
    }
    S.bake();
    return B.finish({
      cam:{target:[0,1.74,-.11],dist:11.25,yaw:.12,pitch:.23,sway:0},
      radius:14,detail:25,dither:.07,
      skyEnvironment:{defaults:{zenith:'#577c7f',horizon:'#aab99a',ground:'#7f8f7a',sunStrength:0}},
      sceneExposure:K.weather.exposure({zones:[
        {id:'sheltered-foundation',min:[-4.6,-.24,-1.29],max:[-.42,.67,.99],fade:.45,rain:.17},
        {id:'downspout-recess',min:[1.86,-.18,-.36],max:[3.07,.51,1.52],fade:.40,rain:.37}
      ]}),
      look:{pixel:true,splatCoverage:'continuous'}
    });
  }
});
