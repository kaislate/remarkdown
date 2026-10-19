// Which controller edits which diagram type. A type with no entry here
// renders read-only with the "coming soon" note.
import { registerController } from './controller';
import { FlowchartController } from './flowchart-controller';
import { SequenceController } from './sequence-controller';
import { parseMermaid } from '../mermaid-parser';
import { parseSequence } from '../mermaid-sequence-parser';
import { PieController } from './pie-controller';
import { parsePie } from './pie-parser';
import { GanttController } from './gantt-controller';
import { parseGantt } from './gantt-parser';
import { TimelineController } from './timeline-controller';
import { parseTimeline } from './timeline-parser';

registerController('flowchart', (host) => new FlowchartController(host), (src) => parseMermaid(src).ok);
registerController('sequence', (host) => new SequenceController(host), (src) => parseSequence(src).ok);
registerController('pie', (host) => new PieController(host), (src) => parsePie(src).ok);
registerController('timeline', (host) => new TimelineController(host), (src) => parseTimeline(src).ok);
registerController('gantt', (host) => new GanttController(host), (src) => parseGantt(src).ok);
import { StateController } from './state-controller';
import { parseState } from './state-parser';

registerController('state', (host) => new StateController(host), (src) => parseState(src).ok);
