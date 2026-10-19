// Mount a store-driven Svelte component (popover, toolbar, banner) into
// a fresh UI host of the node view. The component is mounted ONCE and
// updated through its store, so an input inside keeps focus and caret
// across re-renders of the diagram.
import { mount, unmount, type Component } from 'svelte';
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
  let instance: ReturnType<typeof mount> | null = mount(component, { target, props: { stateStore: store } });
  return {
    store,
    show: (state) => store.set(state),
    hide: () => store.set({ ...hidden }),
    destroy: () => {
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
