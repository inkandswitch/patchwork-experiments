module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'bounce-court',
  name: 'Bounce court',
  seed: 44,
  build(seed) {
    const B = makeBuilder(seed, [
      0x293c51, 0x3e4850, 0x656f72, 0x959f9e, 0xc3c6bc, 0xebe7d7, 0xf4efe3,
      0x594b46, 0x99766a, 0xc89d87, 0xdabca8,
      0x31565c, 0x52787a, 0x86a69f, 0xbfd5c6, 0xffcc78, 0xffebad
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.captureAlbedo = true;
    S.pixel = true;
    const stone = { r:[1,2,3,4,5], albedo:'#d9d8ca' };
    const arch = { r:[2,3,4,5,6], albedo:'#ede8db', materialId:'arch' };
    const floor = { r:[2,3,4,5], albedo:'#b8b6a8' };
    const roof = { r:[7,8,9,10], albedo:'#c59076' };
    const metal = { r:[11,12,13,14], albedo:'#9dc2b4' };
    const lamp = { r:[15,16], em:true };

    S.box([0,-.58,.03],[3.55,.12,2.63],stone,{res:.19,rd:.13});
    S.box([0,-.36,.02],[3.35,.16,2.39],stone,{res:.18,rd:.11});
    S.box([0,-.14,0],[3.12,.09,2.13],floor,{res:.15,rd:.09});
    for (let i = 0; i < 4; i++) S.box([0,-.44+i*.105,2.05-i*.20],[1.42,.10,.36],stone,{res:.13,rd:.04});

    for (const side of [-1,1]) {
      const x = side*1.44;
      S.box([x,.18,0],[.45,.19,.64],stone,{res:.10,rd:.06});
      S.box([x,1.09,0],[.26,.83,.46],arch,{res:.09,rd:.045});
      S.box([x,1.88,0],[.34,.105,.54],arch,{res:.085,rd:.035});
      S.box([side*2.69,.25,-.33],[.27,.29,.28],stone,{res:.11,rd:.04});
      S.lathe([side*2.69,.50,-.33],.30,[.16,.13],lamp,{res:.065});
      S.lathe([side*2.69,.79,-.33],.20,[.21,.045],metal,{res:.066});
    }
    for (let i = 0; i <= 12; i++) {
      const a = i*Math.PI/12, x = 1.44*Math.cos(a), y = 1.93+1.44*Math.sin(a);
      S.box([x,y,0],[.265,.196,.47],arch,{res:.075,rd:.052,ax:B.frame(0,0,a)});
    }
    S.box([0,3.65,0],[2.07,.125,.71],stone,{res:.10,rd:.043});
    S.box([0,3.82,0],[2.18,.10,.78],roof,{res:.095,rd:.048});
    for (const x of [-1.52,0,1.52]) {
      S.lathe([x,3.9,0],.24,[.135,.073],metal,{res:.071});
    }
    S.bake();
    return B.finish({
      cam:{target:[0,1.48,0],dist:11.9,yaw:.32,pitch:.102,sway:0},
      detail:23,radius:7,dither:0,look:{pixel:true},
      liveSun:{direction:[-.56,.75,-.34],ambient:.21,intensity:.62,mapSize:512,
        skyBounce:{ color:'clear-sky', intensity:.48 }, groundBounce:{ color:'sand', intensity:.55 }}
    });
  }
});
