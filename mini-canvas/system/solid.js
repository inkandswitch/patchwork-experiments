import { createStore, reconcile } from 'https://esm.sh/solid-js@1.9/store';
export { from, For } from 'https://esm.sh/solid-js@1.9';
export { render } from 'https://esm.sh/solid-js@1.9/web';
export { default as html } from 'https://esm.sh/solid-js@1.9/html';

export function useRef(ref) {
  const [store, setStore] = createStore({});
  ref.subscribe((value) => {
    console.log('[useRef] reconcile incoming', JSON.parse(JSON.stringify(value ?? {})));
    // I'm sorry chee
    setStore(reconcile(value ?? {}));
  });
  return store;
}
