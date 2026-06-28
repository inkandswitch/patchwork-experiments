// The op vocabulary — there are exactly TWO things:
//
//   snapshot  { type:"snapshot", value }     the whole value (sent on connect,
//                                             or to replace the root wholesale)
//   op        { path, range, value }          one universal mutation
//
// One op covers every case because `range` is overloaded:
//   • range = [from, to]  → splice the collection at `path`
//        text:  {path:[], range:[2,5], value:"xyz"}        (string splice)
//        bytes: {path:[], range:[2,5], value:Uint8Array}   (grows/shrinks!)
//        list:  {path:["items"], range:[0,1], value:[a,b]} (array splice)
//   • range = key (string|number) → assign/delete at `path`
//        json:  {path:["user"], range:"name", value:"bob"} (set)
//               {path:["user"], range:"name"}              (delete, value omitted)
//
// `path` is relative to the *opstream's own value*: a text stream's value IS the
// string, so its ops use `path:[]`. A bridge that binds the stream to a field of
// a larger document prepends that field's path on the way down.
//
// (TextOp/BytesOp/JSONOp from littlebook's ops.ts were specializations of this
// single op — collapsed here. The old BytesOp `{pos, value}` couldn't resize.)

export const snapshot = (value) => ({ type: "snapshot", value });

export const op = (path, range, value) => ({ path, range, value });

// sugar over the one op
export const splice = (path, from, to, value) => ({ path, range: [from, to], value });
export const set = (path, key, value) => ({ path, range: key, value });

export const isSnapshot = (x) => !!x && x.type === "snapshot";
export const isOp = (x) => !!x && !isSnapshot(x) && "range" in x;
