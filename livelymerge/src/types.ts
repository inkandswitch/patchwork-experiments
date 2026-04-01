export type LivelymergeDoc = {
  '@patchwork': { type: 'livelymerge' };
  title: string;
  objectTable: Record<string, Obj>;
};

export type World = {};

export type Obj = {
  type: "obj";
  _id: number;
  _protoId?: number;
} & Record<string, any>;

export type ObjRef = {
  type: 'obj ref';
  id: number; // obj._id
};
