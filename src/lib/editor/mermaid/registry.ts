// Which controller edits which diagram type. A type with no entry here
// renders read-only with the "coming soon" note.
import { registerController } from './controller';
import { FlowchartController } from './flowchart-controller';
import { SequenceController } from './sequence-controller';
import { parseMermaid } from '../mermaid-parser';
import { parseSequence } from '../mermaid-sequence-parser';
import { MindmapController } from './mindmap-controller';
import { parseMindmap } from './mindmap-parser';
import { KanbanController } from './kanban-controller';
import { parseKanban } from './kanban-parser';

registerController('flowchart', (host) => new FlowchartController(host), (src) => parseMermaid(src).ok);
registerController('sequence', (host) => new SequenceController(host), (src) => parseSequence(src).ok);
registerController('mindmap', (host) => new MindmapController(host), (src) => parseMindmap(src).ok);
registerController('kanban', (host) => new KanbanController(host), (src) => parseKanban(src).ok);
