// Shared helpers for the state diagram parser / edit / SVG tests.
//
//   - stateCorpus: every state diagram block of the main corpus and of
//     tests/fixtures/mermaid-corpus-state.md
//   - mermaidStateView: what mermaid's own db says is drawn (the oracle),
//     in the same shape as stateView(model)
import type { StateEndpoint, StateModel, StateScope } from '../../../src/lib/editor/mermaid/state-parser';
import { findPreamble } from '../../../src/lib/editor/mermaid/source-text';
import { corpusBlocks, mermaidDb, type CorpusBlock } from './mermaid-test-utils';

export function isStateSource(source: string): boolean {
  const lines = source.split(/\r?\n/);
  const { headerLine } = findPreamble(lines);
  return headerLine >= 0 && /^\s*stateDiagram/.test(lines[headerLine]);
}

export function stateCorpus(): CorpusBlock[] {
  return corpusBlocks((b) => isStateSource(b.source), ['mermaid-corpus.md', 'mermaid-corpus-state.md']);
}

export interface StateView {
  states: Array<{ id: string; label: string; descriptions: string[]; kind: string; parent: string | null; region: number; composite: { direction: string; regions: number } | null }>;
  terminals: Array<{ kind: string; scope: StateScope }>;
  transitions: Array<{ from: StateEndpoint; to: StateEndpoint; label: string }>;
  transitionIds: string[];
  notes: Array<{ state: string; position: string; text: string }>;
  noteIds: string[];
  direction: string;
}

export function stateView(m: StateModel): StateView {
  return {
    states: [...m.states.values()].map((s) => ({
      id: s.id,
      label: s.label,
      descriptions: s.descriptions,
      kind: s.kind,
      parent: s.parent,
      region: s.region,
      composite: s.composite,
    })),
    terminals: m.terminals,
    transitions: m.transitions,
    transitionIds: m.render.transitions,
    notes: m.notes,
    noteIds: m.render.notes,
    direction: m.direction,
  };
}

// Text as mermaid's db holds it (entity placeholders, HTML-escaped) →
// as it is displayed.
export function shown(text: string): string {
  const html = String(text ?? '').replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';');
  const d = new DOMParser().parseFromString(`<p>${html}</p>`, 'text/html');
  return (d.body.textContent ?? '').trim();
}

function noteText(text: string): string {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

export async function mermaidStateView(source: string): Promise<StateView> {
  const { db } = await mermaidDb(source);
  const data = db.getData();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = data.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const scopeOf = (parentId: string | undefined): StateScope => {
    if (!parentId) return { parent: null, region: 0 };
    const p = byId.get(parentId);
    if (p?.shape === 'divider') {
      const siblings = nodes.filter((n) => n.shape === 'divider' && n.parentId === p.parentId);
      return { parent: p.parentId, region: siblings.indexOf(p) };
    }
    return { parent: parentId, region: 0 };
  };
  const terminalScope = (id: string): StateScope => {
    const owner = id.replace(/_(start|end)$/, '');
    return owner === 'root' ? { parent: null, region: 0 } : scopeOf(owner);
  };
  const isTerminal = (n: { shape: string }) => n.shape === 'stateStart' || n.shape === 'stateEnd';
  const states = nodes.filter((n) => !isTerminal(n) && !['note', 'noteGroup', 'divider'].includes(n.shape));
  const end = (id: string): StateEndpoint => {
    const t = byId.get(id);
    if (t?.shape === 'stateStart') return { kind: 'start', scope: terminalScope(id) };
    if (t?.shape === 'stateEnd') return { kind: 'end', scope: terminalScope(id) };
    return { kind: 'state', id };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges = data.edges.filter((e: any) => !String(e.classes).includes('note-edge'));
  const notes = nodes.filter((n) => n.shape === 'note');
  return {
    states: states.map((n) => ({
      id: n.id,
      label: shown(n.label),
      descriptions: (n.description ?? []).map(shown),
      kind: ['fork', 'join', 'choice'].includes(n.shape) ? n.shape : 'normal',
      ...scopeOf(n.parentId),
      composite: n.isGroup
        ? { direction: n.dir ?? 'TB', regions: Math.max(1, nodes.filter((x) => x.shape === 'divider' && x.parentId === n.id).length) }
        : null,
    })),
    terminals: nodes.filter(isTerminal).map((n) => ({ kind: n.shape === 'stateStart' ? 'start' : 'end', scope: terminalScope(n.id) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transitions: edges.map((e: any) => ({ from: end(e.start), to: end(e.end), label: shown(e.label) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transitionIds: edges.map((e: any) => e.id),
    notes: notes.map((n) => ({
      state: n.id.replace(/----note-\d+$/, ''),
      position: n.position === 'left of' ? 'left' : 'right',
      text: noteText(shown(n.label)),
    })),
    noteIds: notes.map((n) => n.id),
    direction: data.direction,
  };
}
