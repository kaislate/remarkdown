// Toolbar entry points for inserting a fresh diagram. Flowcharts and
// sequence diagrams start empty — the controller's empty-state
// placeholder ("+ Add first shape") takes over once the block is on the
// page; every other kind starts with a small example to change, since
// an empty one has nothing to click. These commands only put the block
// there.
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { editorSchema } from './schema';
import { PIE_STARTER } from './mermaid/pie-parser';
import { TIMELINE_STARTER } from './mermaid/timeline-parser';
import { GANTT_STARTER } from './mermaid/gantt-parser';
import { STATE_STARTER } from './mermaid/state-parser';
import { CLASS_STARTER } from './mermaid/class-parser';
import { ER_STARTER } from './mermaid/er-parser';
import { MINDMAP_STARTER } from './mermaid/mindmap-parser';
import { KANBAN_STARTER } from './mermaid/kanban-parser';
import { JOURNEY_STARTER } from './mermaid/journey-data';
import { QUADRANT_STARTER } from './mermaid/quadrant-data';
import { XYCHART_STARTER } from './mermaid/xychart-data';
import { SANKEY_STARTER } from './mermaid/sankey-data';
import { PACKET_STARTER } from './mermaid/packet-data';
import { RADAR_STARTER } from './mermaid/radar-data';

export const DIAGRAM_STARTERS = {
  flowchart: 'flowchart TD\n',
  sequence: 'sequenceDiagram\n',
  pie: PIE_STARTER,
  timeline: TIMELINE_STARTER,
  gantt: GANTT_STARTER,
  state: STATE_STARTER,
  class: CLASS_STARTER,
  er: ER_STARTER,
  mindmap: MINDMAP_STARTER,
  kanban: KANBAN_STARTER,
  journey: JOURNEY_STARTER,
  quadrant: QUADRANT_STARTER,
  xychart: XYCHART_STARTER,
  sankey: SANKEY_STARTER,
  packet: PACKET_STARTER,
  radar: RADAR_STARTER,
} as const;

export type StarterKind = keyof typeof DIAGRAM_STARTERS;

export function insertDiagram(kind: StarterKind): Command {
  return (
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
  ): boolean => {
    const codeBlockType = editorSchema.nodes.code_block;
    if (!codeBlockType) return false;

    const { $from } = state.selection;
    if ($from.parent.type.name === 'code_block') return false;
    const range = $from.blockRange();
    if (!range) return false;

    if (dispatch) {
      const block = codeBlockType.create(
        { language: 'mermaid' },
        state.schema.text(DIAGRAM_STARTERS[kind]),
      );
      const tr = state.tr.replaceRangeWith(range.start, range.end, block);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function insertMermaid(): Command {
  return insertDiagram('flowchart');
}

export function insertSequenceDiagram(): Command {
  return insertDiagram('sequence');
}
