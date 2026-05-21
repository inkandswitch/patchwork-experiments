export type LivelymergeDoc = {
  '@patchwork': { type: 'livelymerge' };
  title: string;
  objectTable: Record<string, Referent>;
};

export type World = {};

export type Obj = {
  type: 'obj';
  _id: number;
  _protoId?: number;
} & Record<string, any>;

/** Heap reference to an object or array in objectTable. */
export type Ref = {
  type: 'ref';
  id: number;
};

/** @deprecated Legacy ref format; still accepted when deserializing. */
export type ObjRef = {
  type: 'obj ref';
  id: number;
};

export type Referent = Obj | unknown[];
