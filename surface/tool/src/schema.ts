export type Schema<T> = {
  init(): T;
  parse(value: unknown): T;
  toJSONSchema(): Record<string, unknown>;
};
