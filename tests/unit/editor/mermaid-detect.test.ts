import { describe, it, expect } from 'vitest';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';

describe('detectDiagramType', () => {
  it('returns "flowchart" for flowchart and the legacy graph keyword', () => {
    expect(detectDiagramType('flowchart TD\nA[a]\n')).toBe('flowchart');
    expect(detectDiagramType('flowchart LR\n')).toBe('flowchart');
    expect(detectDiagramType('flowchart BT\n')).toBe('flowchart');
    expect(detectDiagramType('flowchart RL\n')).toBe('flowchart');
    expect(detectDiagramType('flowchart TB\n')).toBe('flowchart');
    expect(detectDiagramType('graph TD\nA --> B\n')).toBe('flowchart');
    expect(detectDiagramType('graph TD;A-->B;\n')).toBe('flowchart');
    expect(detectDiagramType('graph\nA --> B\n')).toBe('flowchart');
    // A word that merely starts like one isn't.
    expect(detectDiagramType('graphical\n')).toBe('unsupported');
  });

  it('returns "sequence" for sequenceDiagram', () => {
    expect(detectDiagramType('sequenceDiagram\nA->>B: hi\n')).toBe('sequence');
    expect(detectDiagramType('sequenceDiagram\n')).toBe('sequence');
  });

  it('recognises every other diagram type by its header', () => {
    const cases: Array<[string, string]> = [
      ['classDiagram\nclass A\n', 'class'],
      ['classDiagram-v2\n', 'class'],
      ['stateDiagram-v2\n[*] --> A\n', 'state'],
      ['stateDiagram\n', 'state'],
      ['gantt\ntitle X\n', 'gantt'],
      ['erDiagram\n', 'er'],
      ['pie showData\n', 'pie'],
      ['mindmap\n', 'mindmap'],
      ['timeline\n', 'timeline'],
      ['kanban\n', 'kanban'],
      ['journey\n', 'journey'],
      ['quadrantChart\n', 'quadrant'],
      ['xychart-beta\n', 'xychart'],
      ['gitGraph\n', 'gitgraph'],
      ['sankey-beta\n', 'sankey'],
      ['block-beta\n', 'block'],
      ['C4Context\n', 'c4'],
      ['requirementDiagram\n', 'requirement'],
      ['architecture-beta\n', 'architecture'],
      ['packet-beta\n', 'packet'],
      ['radar-beta\n', 'radar'],
    ];
    for (const [src, type] of cases) expect(detectDiagramType(src), src).toBe(type);
    expect(detectDiagramType('notARealDiagram\n')).toBe('unsupported');
  });

  it('skips frontmatter, blank lines and %% comments before checking the header', () => {
    expect(detectDiagramType('\n%% a comment\nflowchart TD\n')).toBe('flowchart');
    expect(detectDiagramType('%% header\n\nsequenceDiagram\n')).toBe('sequence');
    expect(detectDiagramType('---\ntitle: Pets\n---\npie\n')).toBe('pie');
    expect(detectDiagramType('%%{init: {}}%%\ngantt\n')).toBe('gantt');
  });

  it('returns "unsupported" for empty source', () => {
    expect(detectDiagramType('')).toBe('unsupported');
    expect(detectDiagramType('\n\n%% just a comment\n')).toBe('unsupported');
  });

  it('handles leading whitespace on the directive line', () => {
    expect(detectDiagramType('  flowchart TD\n')).toBe('flowchart');
    expect(detectDiagramType('\t sequenceDiagram\n')).toBe('sequence');
  });
});
