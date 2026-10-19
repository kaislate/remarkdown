// Which controller edits which diagram type. A type with no entry here
// renders read-only with the "coming soon" note.
import { registerController } from './controller';
import { FlowchartController } from './flowchart-controller';
import { SequenceController } from './sequence-controller';
import { parseMermaid } from '../mermaid-parser';
import { parseSequence } from '../mermaid-sequence-parser';
import { PieController } from './pie-controller';
import { parsePie } from './pie-parser';

registerController('flowchart', (host) => new FlowchartController(host), (src) => parseMermaid(src).ok);
registerController('sequence', (host) => new SequenceController(host), (src) => parseSequence(src).ok);
registerController('pie', (host) => new PieController(host), (src) => parsePie(src).ok);
