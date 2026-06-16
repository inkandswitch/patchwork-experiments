export interface LivelymergeDoc {
  '@patchwork': { type: 'livelymerge' };
  title: string;
  objectTable: Record<string, Obj | Arr | Fun>;
}

export type Obj = {
  $type: 'obj';
  $id: string;
  $protoId?: string;
} & Record<string, any>;

export interface Arr {
  $type: 'arr';
  $id: string;
  $values: Val[];
}

export interface Fun {
  $type: 'fun';
  $id: string;
  $codeForShow: string;
  $code: string;
  $scopes: Ref[];
  $prototypeId?: string;
}

export interface Ref {
  $type: 'ref';
  $id: string;
}

export type Val = Ref | number | string | boolean | null | undefined;

export function isObj(value: any): value is Obj {
  return typeof value === 'object' && value?.$type === 'obj';
}

export function isArr(value: any): value is Arr {
  return typeof value === 'object' && value?.$type === 'arr';
}

export function isFun(value: any): value is Fun {
  return typeof value === 'object' && value?.$type === 'fun';
}

export function isRef(value: any): value is Ref {
  return typeof value === 'object' && value?.$type === 'ref';
}
