const channelNames = ['red','green','blue','luminance','alpha'];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

export function prepareMaskRows(palettes, rules, maxTextureSize) {
  const rows = [], textures = [];
  let texels = 0;
  for (const { maskSource:mask } of palettes) {
    if (!mask) { rows.push(null); continue; }
    const [lo,hi] = mask.range ?? [0,1];
    const header = [mask.type==='axis'?1:2, +(mask.space !== 'world'),
      ['linear','smooth','step'].indexOf(mask.interpolation ?? 'smooth'), +Boolean(mask.invert)];
    if (mask.type==='axis') {
      const {direction,offset}=rules.axis(mask);
      rows.push([...header,...direction,offset,lo,1/(hi-lo)]);
      continue;
    }
    const {x,z,origin}=rules.plane(mask.projection);
    const [u,v]=mask.scale??[1,1], [ox,oy]=mask.offset??[0,0];
    const {width,height,frames,fps=1,channels=4,repeat=false,wrap=false}=mask.raster;
    rows.push([...header,...x.map(n=>n/u),(-dot(x,origin)-ox)/u,
      lo,1/(hi-lo),texels,+wrap,...z.map(n=>n/v),(-dot(z,origin)-oy)/v,width,height,frames.length,fps,+repeat]);
    texels += width*height*frames.length;
    textures.push({frames,channels,channel:channelNames.indexOf(mask.channel??'alpha')});
  }
  if (!texels) return { rows };
  const width = Math.min(maxTextureSize,1024), height=Math.ceil(texels/width);
  if (height>maxTextureSize || texels>2**22) throw new RangeError('WebGL look mask textures exceed their atlas budget');
  const values=new Float32Array(width*height);
  let i=0;
  for(const {frames,channels,channel} of textures)for(const frame of frames)for(let j=0;j<frame.length;j+=channels) {
    const alpha=channels===4?frame[j+3]/255:1;
    const source=channel===4?1:channel===3?(.30*frame[j]+.55*frame[j+1]+.15*frame[j+2])/255:frame[j+channel]/255;
    values[i++]=source*alpha;
  }
  return {rows,texture:{width,height,values}};
}
