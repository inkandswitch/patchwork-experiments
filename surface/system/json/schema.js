export const schema = {
  init() {
    return {};
  },
  parse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected an object');
    }
    return value;
  },
};
