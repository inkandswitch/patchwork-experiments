export const schema = {
  init() {
    return {};
  },
  parse(value) {
    if (value && typeof value === 'object') return value;
    return {};
  },
};
