// Mount a store-driven Svelte component (popover, toolbar, banner) into
// a fresh UI host of the node view. The component is mounted ONCE and
// updated through its store, so an input inside keeps focus and caret
// across re-renders of the diagram.
//
// It is mounted the first time it is shown, not up front: a diagram has
// two to six of these, most never opened, and a document with dozens of
// diagrams would otherwise build hundreds of hidden popovers (thousands
// of DOM nodes) before edit mode first paints. The host element itself
// is made up front, so the hosts keep the order the controller made them
// in.
import { flushSync, mount, unmount, type Component } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import type { DiagramHost } from './controller';

export interface MountedUi<S> {
  store: Writable<S>;
  show: (state: S) => void;
  hide: () => void;
  destroy: () => void;
}

export function mountUi<S>(
  host: DiagramHost,
  // Every popover takes its state as a `stateStore` prop (see
  // MermaidNodePopover for why it isn't called `state`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any>,
  className: string,
  hidden: S,
): MountedUi<S> {
  const target = host.createUiHost(className);
  const store = writable<S>({ ...hidden });
  let instance: ReturnType<typeof mount> | null = null;
  let destroyed = false;
  return {
    store,
    show: (state) => {
      if (!instance && !destroyed) {
        // Exactly as when it was mounted up front: drawn hidden first,
        // then opened, so it goes through the same hidden -> shown change.
        store.set({ ...hidden });
        instance = mount(component, { target, props: { stateStore: store } });
        flushSync();
      }
      store.set(state);
    },
    // Nothing to hide before it was ever shown.
    hide: () => store.set({ ...hidden }),
    destroy: () => {
      destroyed = true;
      store.set({ ...hidden });
      if (instance) {
        try {
          unmount(instance);
        } catch {
          // Best-effort — if Svelte already cleaned up, ignore.
        }
        instance = null;
      }
      target.remove();
    },
  };
}
