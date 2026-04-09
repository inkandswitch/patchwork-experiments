export type Subscribable<T> = {
  value(): T;
  subscribe(fn: (value: T) => void): () => void;
};
