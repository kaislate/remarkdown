import { describe, it, expect } from 'vitest';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';

describe('detectDiagramType', () => {
  it('returns "flowchart" for flowchart TD/LR/BT/RL', () => {
    expect(detectDiagramType('flowchart TD\nA[a]\n')).toBe('flowchart');
    expect(detectDiagramType('flowchart LR\n')).toBe('flowchart');
    expect(detectDiagramType('flowchart BT\n')).toBe('flowchart');
    expect(detectDiagramType('flowchart RL\n')).toBe('flowchart');
    expect(detectDiagramType('flowchart TB\n')).toBe('flowchart');
  });

  it('returns "sequence" for sequenceDiagram', () => {
    expect(detectDiagramType('sequenceDiagram\nA->>B: hi\n')).toBe('sequence');
    expect(detectDiagramType('sequenceDiagram\n')).toBe('sequence');
  });

  it('returns "unsupported" for other diagram types', () => {
    expect(detectDiagramType('classDiagram\nclass A\n')).toBe('unsupported');
    expect(detectDiagramType('stateDiagram-v2\n[*] --> A\n')).toBe('unsupported');
    expect(detectDiagramType('graph TD\nA --> B\n')).toBe('unsupported'); // legacy keyword
    expect(detectDiagramType('gantt\ntitle X\n')).toBe('unsupported');
    expect(detectDiagramType('erDiagram\n')).toBe('unsupported');
    expect(detectDiagramType('pie\n')).toBe('unsupported');
  });

  it('skips leading blank lines and %% comments before checking the directive', () => {
    expect(detectDiagramType('\n%% a comment\nflowchart TD\n')).toBe('flowchart');
    expect(detectDiagramType('%% header\n\nsequenceDiagram\n')).toBe('sequence');
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
