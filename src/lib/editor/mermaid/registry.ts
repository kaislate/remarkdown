// Which controller edits which diagram type. A type with no entry here
// renders read-only with the "coming soon" note.
import { registerController } from './controller';
import { FlowchartController } from './flowchart-controller';
import { SequenceController } from './sequence-controller';

registerController('flowchart', (host) => new FlowchartController(host));
registerController('sequence', (host) => new SequenceController(host));
