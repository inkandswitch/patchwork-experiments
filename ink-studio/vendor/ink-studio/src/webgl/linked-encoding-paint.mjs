const dash = {
  solid:[], diagonal:[7,3], dots:[1,4], crosshatch:[6,2,2,2], horizontal:[10,4],
  vertical:[3,3], checker:[3,2,3,5]
};

export function linkedSymbol(path,x,y,r,symbol) {
  if(symbol==='square')path.rect(x-r,y-r,2*r,2*r);
  else if(symbol==='diamond'||symbol==='triangle'||symbol==='hexagon') {
    const n={triangle:3,diamond:4,hexagon:6}[symbol];
    for(let i=0;i<n;i++){
      const a=-Math.PI/2+i*2*Math.PI/n, p=[x+Math.cos(a)*r,y+Math.sin(a)*r];
      if(i)path.lineTo(...p);
      else path.moveTo(...p);
    }
    path.closePath();
  }else{
    path.moveTo(x+r,y);
    path.arc(x,y,r,0,2*Math.PI);
    if(symbol==='ring'){
      path.moveTo(x+r*.52,y);
      path.arc(x,y,r*.52,0,2*Math.PI,true);
    }
  }
}

function hatch(ctx, name, ink) {
  if(name==='solid')return undefined;
  const tile=ctx.canvas.ownerDocument.createElement('canvas');
  tile.width=tile.height=6;
  const h=tile.getContext('2d');
  h.fillStyle=h.strokeStyle=ink;
  h.lineWidth=1.35;
  if(name==='dots'){
    h.beginPath();h.arc(2,2,1.15,0,Math.PI*2);h.fill();
  }else if(name==='checker'){
    h.fillRect(0,0,3,3);h.fillRect(3,3,3,3);
  }else{
    h.beginPath();
    if(name==='horizontal'){h.moveTo(0,2.5);h.lineTo(6,2.5);}
    if(name==='vertical'){h.moveTo(2.5,0);h.lineTo(2.5,6);}
    if(name==='diagonal'||name==='crosshatch'){
      for(const offset of [-6,0,6]){
        h.moveTo(offset,6);h.lineTo(offset+6,0);
        if(name==='crosshatch'){h.moveTo(offset,0);h.lineTo(offset+6,6);}
      }
    }
    h.stroke();
  }
  return ctx.createPattern(tile,'repeat');
}

export function linkedPaint(ctx,style,encoding,color) {
  const tiles=new Map();
  const fill=style['pattern-fill'], ink=style['pattern-ink'];
  return {
    tint(ref) { return encoding.monochrome ? fill : color?.(ref)??(encoding.mark(ref)?fill:style.point); },
    fill(path,tint,mark,{area=false}={}) {
      ctx.fillStyle=tint;
      ctx.globalAlpha=area ? (mark ? .66 : .24) : 1;
      ctx.fill(path,'evenodd');
      ctx.globalAlpha=1;
      if(!mark)return;
      if(!tiles.has(mark.pattern))tiles.set(mark.pattern,hatch(ctx,mark.pattern,ink));
      const pattern=tiles.get(mark.pattern);
      if(pattern){
        ctx.fillStyle=pattern;
        ctx.fill(path,'evenodd');
      }
    },
    dash(mark){ctx.setLineDash(dash[mark?.pattern]??[]);}
  };
}
