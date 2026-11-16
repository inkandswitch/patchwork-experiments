// Just enough of three's shape to build the surface against (this package
// doesn't depend on three: the stage hands it one).
export function fakeThree() {
  class Vector2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      Object.assign(this, { x, y, z });
      return this;
    }
    normalize() {
      const l = Math.hypot(this.x, this.y, this.z) || 1;
      return this.set(this.x / l, this.y / l, this.z / l);
    }
  }
  class Vector4 {
    constructor(x = 0, y = 0, z = 0, w = 0) {
      Object.assign(this, { x, y, z, w });
    }
    set(x, y, z, w) {
      Object.assign(this, { x, y, z, w });
      return this;
    }
  }
  class Color {
    constructor(v) {
      this.v = v;
    }
    set(v) {
      this.v = v;
      return this;
    }
    setRGB(r, g, b) {
      this.v = [r, g, b];
      return this;
    }
  }
  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
    }
  }
  class BufferGeometry {
    attributes = {};
    setAttribute(name, a) {
      this.attributes[name] = a;
    }
    setIndex(i) {
      this.index = i;
    }
    dispose() {
      this.disposed = true;
    }
  }
  class ShaderMaterial {
    constructor(o) {
      Object.assign(this, o);
    }
    dispose() {
      this.disposed = true;
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = new Vector3();
      this.userData = {};
    }
  }
  class LineSegments extends Mesh {
    computeLineDistances() {
      this.distances = true;
      return this;
    }
  }
  class LineDashedMaterial {
    constructor(o) {
      Object.assign(this, o);
    }
    dispose() {
      this.disposed = true;
    }
  }
  class DataTexture {
    constructor(data, width, height, format, type) {
      this.image = { data, width, height };
      Object.assign(this, { format, type, version: 0 });
    }
    set needsUpdate(v) {
      if (v) this.version++;
    }
    dispose() {
      this.disposed = true;
    }
  }
  // a half float's bits, enough for a test: sign, exponent and the top 10 bits of the mantissa (no rounding, no subnormals)
  const toHalfFloat = (v) => {
    const f = new Float32Array([v]), u = new Uint32Array(f.buffer)[0];
    const sign = (u >>> 16) & 0x8000, e = ((u >>> 23) & 0xff) - 127 + 15, m = (u >>> 13) & 0x3ff;
    if (e <= 0) return sign;
    if (e >= 31) return sign | 0x7c00;
    return sign | (e << 10) | m;
  };
  const clone = (u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { value: v.value }]));
  return {
    Vector2,
    Vector3,
    Vector4,
    Color,
    BufferAttribute,
    BufferGeometry,
    ShaderMaterial,
    Mesh,
    LineSegments,
    LineDashedMaterial,
    DataTexture,
    DataUtils: { toHalfFloat },
    RGFormat: 1030,
    RGBAFormat: 1023,
    HalfFloatType: 1016,
    RepeatWrapping: 1000,
    ClampToEdgeWrapping: 1001,
    LinearFilter: 1006,
    DoubleSide: 2,
    UniformsLib: { fog: { fogDensity: { value: 0 }, fogNear: { value: 1 }, fogFar: { value: 2000 }, fogColor: { value: new Color("#fff") } } },
    UniformsUtils: { clone },
  };
}
