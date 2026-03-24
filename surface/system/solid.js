import { createStore, reconcile } from 'https://esm.sh/solid-js@1.9/store';
export { from, For, Show, createSignal } from 'https://esm.sh/solid-js@1.9';
export { render } from 'https://esm.sh/solid-js@1.9/web';
export { default as html } from 'https://esm.sh/solid-js@1.9/html';

export function useSubscribable(subscribable) {
  const [store, setStore] = createStore({});
  subscribable.subscribe((value) => {
    setStore(reconcile(value ?? {}));
  });
  return store;
}

export function useRef(ref) {
  return useSubscribable(ref);
}
