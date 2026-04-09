export type Schema<T> = {
  namespace?: string;
  methods?: string[];
  init(): T;
  parse(value: unknown): T;
  toJSONSchema(): Record<string, unknown>;
};
