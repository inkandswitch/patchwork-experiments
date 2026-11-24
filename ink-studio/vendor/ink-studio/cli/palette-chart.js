const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');

module.exports = function paletteChartCLI(files,{type,format='png',out},{KIT:K},outputFile) {
  if (files.length !== 1 || !['png','data'].includes(format) ||
      (out !== undefined && typeof out !== 'string') || (type !== undefined && typeof type !== 'string'))
    throw new TypeError('Use palette chart <chart.json> [--type swatches|brightness|saturation|closest-pairs|dither-pairs] [--format png|data] [--out file]');
  const input = JSON.parse(fs.readFileSync(path.resolve(files[0]),'utf8'));
  const chart = K.palette.chart(type === undefined ? input : {...input,type});
  const raster = chart.indexed();
  if (format === 'data') {
    const json = JSON.stringify({type:chart.type,cells:chart.cells,raster})+'\n';
    if (!out) return process.stdout.write(json);
    const file = outputFile(chart.type+'.json');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,json);
    return;
  }
  const file = outputFile(chart.type+'.png');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  PNG.writeIndexed(file,raster.width,raster.height,raster.slots,raster.palette.map(value=>[1,3,5].map(i=>parseInt(value.slice(i,i+2),16))));
  console.log('wrote',file,raster.width+'x'+raster.height);
};
