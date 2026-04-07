export type Schema<T> = {
  namespace?: string;
  init(): T;
  parse(value: unknown): T;
  toJSONSchema(): Record<string, unknown>;
};
