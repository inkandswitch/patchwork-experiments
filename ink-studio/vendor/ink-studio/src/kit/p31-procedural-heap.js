/* Internal binary min-heap shared by bounded procedural searches. */
class ProceduralHeap {
  constructor(before) {
    this.items = [];
    this.before = before;
  }

  get size() {
    return this.items.length;
  }

  peek() {
    return this.items[0];
  }

  push(value) {
    const { items, before } = this;
    let i = items.length;
    items.push(value);
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (!before(value, items[parent])) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = value;
  }

  pop() {
    const { items, before } = this;
    const first = items[0],
      last = items.pop();
    if (!items.length) return first;
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= items.length) break;
      if (child + 1 < items.length && before(items[child + 1], items[child])) child++;
      if (!before(items[child], last)) break;
      items[i] = items[child];
      i = child;
    }
    items[i] = last;
    return first;
  }
}
