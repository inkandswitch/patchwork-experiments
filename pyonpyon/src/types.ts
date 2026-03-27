export type PyonpyonDoc = {
  '@patchwork': { type: 'pyonpyon' };
  title: string;
  objProtoId: number;
  wId: number;
  objectTable: ObjectTable;
};

export type Obj = Record<string, any>;

export type SVal = number | boolean | string | Ref | null;

export type SObj = {
  type: 'obj';
  id: number;
  protoId?: number;
  props: Record<string, SVal>;
};

export type SFun = {
  type: 'fun';
  id: number;
  code: string;
};

export type SArr = {
  type: 'arr';
  id: number;
  elements: SVal[];
};

export type SSet = {
  type: 'set';
  id: number;
  elements: SVal[];
};

export type SMap = {
  type: 'map';
  id: number;
  keys: SVal[];
  values: SVal[];
};

export type Ref = {
  type: 'ref';
  id: number;
};

export type ObjectTable = Record<number, SObj | SFun | SArr | SSet | SMap>;
