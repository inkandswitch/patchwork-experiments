import { ColorsDatatype } from './colors/datatype.ts';
import { InstrumentDatatype } from './instrument/datatype.ts';
import { MocapDatatype } from './mocap/datatype.ts';
import { PuppetDatatype } from './puppet/datatype.ts';
import { BattleDatatype } from './battle/datatype.ts';
import { ClapDatatype } from './clap/datatype.ts';

export const plugins = [
  // --- Datatypes ---
  {
    type: 'patchwork:datatype',
    id: 'spatial-colors',
    name: 'QR Colors',
    icon: 'Palette',
    async load() {
      return ColorsDatatype;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'spatial-instrument',
    name: 'QR Instrument',
    icon: 'Music',
    async load() {
      return InstrumentDatatype;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'spatial-mocap',
    name: 'Hole in the Wall',
    icon: 'PersonStanding',
    async load() {
      return MocapDatatype;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'spatial-puppet',
    name: 'VRM Puppet',
    icon: 'Bot',
    async load() {
      return PuppetDatatype;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'spatial-battle',
    name: 'QR Battle Table',
    icon: 'Swords',
    async load() {
      return BattleDatatype;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'spatial-clap',
    name: 'Clap Lights',
    icon: 'Lightbulb',
    async load() {
      return ClapDatatype;
    },
  },

  // --- Tools ---
  {
    type: 'patchwork:tool',
    id: 'spatial-colors',
    name: 'QR Colors',
    icon: 'Palette',
    supportedDatatypes: ['spatial-colors'],
    async load() {
      const { default: ColorsTool } = await import('./colors/tool.ts');
      return ColorsTool;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'spatial-instrument',
    name: 'QR Instrument',
    icon: 'Music',
    supportedDatatypes: ['spatial-instrument'],
    async load() {
      const { default: InstrumentTool } = await import('./instrument/tool.ts');
      return InstrumentTool;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'spatial-mocap',
    name: 'Hole in the Wall',
    icon: 'PersonStanding',
    supportedDatatypes: ['spatial-mocap'],
    async load() {
      const { default: MocapTool } = await import('./mocap/tool.ts');
      return MocapTool;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'spatial-puppet',
    name: 'VRM Puppet',
    icon: 'Bot',
    supportedDatatypes: ['spatial-puppet'],
    async load() {
      const { default: PuppetTool } = await import('./puppet/tool.ts');
      return PuppetTool;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'spatial-battle',
    name: 'QR Battle Table',
    icon: 'Swords',
    supportedDatatypes: ['spatial-battle'],
    async load() {
      const { default: BattleTool } = await import('./battle/tool.ts');
      return BattleTool;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'spatial-clap',
    name: 'Clap Lights',
    icon: 'Lightbulb',
    supportedDatatypes: ['spatial-clap'],
    async load() {
      const { default: ClapTool } = await import('./clap/tool.ts');
      return ClapTool;
    },
  },
];
