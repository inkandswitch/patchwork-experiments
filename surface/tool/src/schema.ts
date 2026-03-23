export type Schema<T> = {
  init(): T;
  parse(value: unknown): T;
};
