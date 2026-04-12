export const selectedColorSchema = {
  namespace: 'selectedColor',
  init() {
    return '#3b82f6';
  },
  parse(value) {
    return typeof value === 'string' ? value : '#3b82f6';
  },
};
