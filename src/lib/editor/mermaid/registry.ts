// Which controller edits which diagram type. A type with no entry here
// is changed through its text (mermaid/text-panel.ts). The second function is
// the same parse the controller's load() does, so "is this diagram
// editable?" has one answer everywhere (see canEditDiagram).
import { registerController } from './controller';
import { FlowchartController } from './flowchart-controller';
import { SequenceController } from './sequence-controller';
import { PieController } from './pie-controller';
import { GanttController } from './gantt-controller';
import { TimelineController } from './timeline-controller';
import { StateController } from './state-controller';
import { ClassController } from './class-controller';
import { ErController } from './er-controller';
import { MindmapController } from './mindmap-controller';
import { KanbanController } from './kanban-controller';
import { parseMermaid } from '../mermaid-parser';
import { parseSequence } from '../mermaid-sequence-parser';
import { parsePie } from './pie-parser';
import { parseGantt } from './gantt-parser';
import { parseTimeline } from './timeline-parser';
import { parseState } from './state-parser';
import { parseClass } from './class-parser';
import { parseEr } from './er-parser';
import { parseMindmap } from './mindmap-parser';
import { parseKanban } from './kanban-parser';
import { JourneyController, QuadrantController, XyChartController, SankeyController, PacketController, RadarController } from './data-controllers';
import { parseJourney } from './journey-data';
import { parseQuadrant } from './quadrant-data';
import { parseXyChart } from './xychart-data';
import { parseSankey } from './sankey-data';
import { parsePacket } from './packet-data';
import { parseRadar } from './radar-data';

registerController('flowchart', (host) => new FlowchartController(host), (src) => parseMermaid(src).ok);
registerController('sequence', (host) => new SequenceController(host), (src) => parseSequence(src).ok);
registerController('pie', (host) => new PieController(host), (src) => parsePie(src).ok);
registerController('gantt', (host) => new GanttController(host), (src) => parseGantt(src).ok);
registerController('timeline', (host) => new TimelineController(host), (src) => parseTimeline(src).ok);
registerController('state', (host) => new StateController(host), (src) => parseState(src).ok);
registerController('class', (host) => new ClassController(host), (src) => parseClass(src).ok);
registerController('er', (host) => new ErController(host), (src) => parseEr(src).ok);
registerController('mindmap', (host) => new MindmapController(host), (src) => parseMindmap(src).ok);
registerController('kanban', (host) => new KanbanController(host), (src) => parseKanban(src).ok);
// The data diagrams: edited as tables (data-controller.ts).
registerController('journey', (host) => new JourneyController(host), (src) => parseJourney(src) !== null);
registerController('quadrant', (host) => new QuadrantController(host), (src) => parseQuadrant(src) !== null);
registerController('xychart', (host) => new XyChartController(host), (src) => parseXyChart(src) !== null);
registerController('sankey', (host) => new SankeyController(host), (src) => parseSankey(src) !== null);
registerController('packet', (host) => new PacketController(host), (src) => parsePacket(src) !== null);
registerController('radar', (host) => new RadarController(host), (src) => parseRadar(src) !== null);
