/* Fit a one-sided border to an ordered 2D profile, with optional fitted joints. */
(function (K) {
  const P=K.procedural||K.authoring;

  function profileBand({profile,width,side='right',closed=true,miterLimit,...fitting}={}) {
    if(!Array.isArray(profile)||!Array.from(profile).every(point=>
      Array.isArray(point)&&point.length===2&&Array.from(point).every(Number.isFinite))||
      !['left','right'].includes(side))
      throw new Error('Profile bands need a finite two-dimensional profile and an offset side');
    const path=profile.map(([x,y])=>[x,y,0]);
    const rails=P.offsetRails({path,halfWidth:width,up:[0,0,1],closed,miterLimit});
    if(rails.reversals.length)throw new Error('A profile band cannot reverse at a vertex');
    const outer=rails[side].map(([x,y])=>[x,y]);
    const fit=P.fittedRibbon({...fitting,inner:profile,outer,closed});
    return P.data.freeze({...fit,outer,contracted:rails.contracted});
  }

  P.profileBand=profileBand;
})(KIT);
