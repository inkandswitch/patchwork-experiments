const manifest = require('./world-transfers.json');

module.exports = ({makeBuilder,makeSculpt,KIT:K}) => ({
  id:'conservative-transfer',
  name:'Filling a capped cistern',
  seed:11,
  build(seed) {
    const B = makeBuilder(seed, [
      0x253542,0x232b34,0x3a4851,0x52626b,0x6f7c7d,
      0x263940,0x3c5357,0x567471,0x829389,0xb5b0a0,
      0x493d3a,0x785b47,0xae8259,0xd9ab6d,0xf5cf86,
      0x214b62,0x246b86,0x3894a3,0x64b7b9,0xa9d5ca,
      0xead9ad,0xf9edc7,0xfff4d1
    ]);
    const S = K.sculpt(makeSculpt(B));
    const base = {r:[1,2,3,4]}, metal = {r:[5,6,7,8,9]}, brass = {r:[10,11,12,13,14]},
      water = {r:[15,16,17,18,19]}, ink = {r:[20,21,22]};
    const run = K.world.runtime.create(manifest);
    const value = (query,account) => query.probe('world/account',{}, {account}).value.balance;

    function letters(text,size,point) {
      S.strokes(K.poly2.text(text,size,{width:size*.12}),point,.014,ink,{res:.018});
    }
    function tank(x, balance, rim) {
      S.box([x,.39,-.04],[.82,.09,.66],rim,{rd:.055,res:.079});
      S.box([x,1.16,-.66],[.82,.78,.068],rim,{rd:.042,res:.08});
      for (const side of [-1,1])
        S.box([x+side*.75,1.16,-.12],[.07,.78,.62],rim,{rd:.04,res:.08});
      S.box([x,.52,.51],[.82,.19,.068],rim,{rd:.045,res:.073});

      const level = balance*.141;
      if (level > 0)
        S.box([x,.45+level/2,-.11],[.672,level/2,.535],water,{rd:.033,res:.065});
      for (const side of [-1,1]) for (let j=1;j<=10;j++) {
        const tick = j%5===0?.105:.055;
        S.box([x+side*.73,.455+j*.141,.56],[tick,.017,.022],brass,{res:.026});
      }
      S.box([x,.565,.618],[.27,.155,.041],base,{rd:.026,res:.058});
      letters(String(balance),.25,[x,.55,.679]);
    }
    function rig(x, query, title) {
      S.box([x,.118,.02],[2.55,.19,1.49],base,{rd:.115,res:.12});
      S.box([x,.313,-.04],[2.33,.043,1.27],metal,{rd:.041,res:.095});
      tank(x-1.17,value(query,'basin/outlet'),metal);
      tank(x+1.17,value(query,'cistern/water'),brass);
      const pipe = [[x-1.17,1.25,-.78],[x-1.17,1.7,-1.05],
        [x-1.0,1.86,-1.05],[x,1.86,-1.05],[x+1.0,1.86,-1.05],[x+1.17,1.7,-1.05],[x+1.17,1.36,-.76]];
      S.tube(pipe,.075,.075,brass,{res:.054});
      S.lathe([x,1.82,-1.05],.2,[.13,.17,.15],brass,{res:.048});
      S.box([x,.28,1.39],[1.12,.205,.065],base,{rd:.047,res:.069});
      letters(title,.27,[x,.278,1.48]);
    }
    rig(-2.82,run.query(),'BEFORE');
    run.advance(1);
    rig(2.82,run.query(),'AFTER');
    S.bake();
    return B.finish({cam:{target:[0,.86,0],dist:13.2,pitch:.47,yaw:.11},detail:25,dither:.13});
  }
});
