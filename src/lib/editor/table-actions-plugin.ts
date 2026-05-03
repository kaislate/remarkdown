// PM plugin that tracks the active table (the table containing the
// current selection, if any). Plugin state is consumed by the
// TableActionsMenu Svelte component to decide whether to show the
// floating menu and where to position it. Decoupling state-tracking
// (here) from rendering (Svelte) keeps the PM side framework-agnostic.
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';

export interface TableActionsState {
  active: { tablePos: number } | null;
}

export const tableActionsKey = new PluginKey<TableActionsState>(
  'tableActions',
);

function findActiveTable(state: EditorState): TableActionsState['active'] {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'table') {
      return { tablePos: $from.before(d) };
    }
  }
  return null;
}

export function createTableActionsPlugin() {
  return new Plugin<TableActionsState>({
    key: tableActionsKey,
    state: {
      init(_config, instance) {
        return { active: findActiveTable(instance) };
      },
      apply(tr, prev, _oldState, newState) {
        // Only recompute when selection or doc changed.
        if (!tr.docChanged && !tr.selectionSet) return prev;
        return { active: findActiveTable(newState) };
      },
    },
  });
}
