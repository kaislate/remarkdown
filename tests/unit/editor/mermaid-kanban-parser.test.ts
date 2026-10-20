// Kanban parser: columns and cards must be exactly what mermaid draws
// (its own db is the oracle), metadata included.
import { describe, it, expect } from 'vitest';
import {
  parseKanbanSource,
  parseKanban,
  KANBAN_STARTER,
  type KanbanModel,
} from '../../../src/lib/editor/mermaid/kanban-parser';
import { decodeMermaidEntities } from '../../../src/lib/editor/mermaid-parser';
import { corpusBlocks, mermaidDb, mermaidAccepts } from './mermaid-test-utils';

function model(src: string): KanbanModel {
  const r = parseKanban(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

const board = (m: KanbanModel) => m.columns.map((c) => [c.text, c.cards.map((k) => k.text)]);

describe('kanban parser: targeted examples', () => {
  it('reads columns and their cards', () => {
    const m = model('kanban\n  Todo\n    [Write corpus]\n    [Run audit]\n  Doing\n    [Review findings]\n  Done\n');
    expect(board(m)).toEqual([
      ['Todo', ['Write corpus', 'Run audit']],
      ['Doing', ['Review findings']],
      ['Done', []],
    ]);
    expect(m.columns[1].cards[0]).toMatchObject({ index: 2, column: 1, position: 0, id: 'Review findings', explicitId: false });
  });

  it('reads ids and the assigned / ticket / priority metadata', () => {
    const m = model("kanban\n  todo[Todo]\n    id1[Card]@{ assigned: knsv, ticket: MC-2037, priority: 'Very High' }\n");
    expect(m.columns[0]).toMatchObject({ id: 'todo', explicitId: true, text: 'Todo' });
    expect(m.columns[0].cards[0]).toMatchObject({ id: 'id1', assigned: 'knsv', ticket: 'MC-2037', priority: 'Very High' });
  });

  it('reads block-style metadata, numbers, quotes and a label override', () => {
    const m = model(
      "kanban\n  T\n    a[x]@{\n      assigned: \"Maria\"\n      ticket: 42\n    }\n    b[Ignored]@{ label: 'Shown', assigned: 'O''Brien' }\n    c[z]@{ ticket: 0 }\n",
    );
    expect(m.columns[0].cards.map((c) => [c.text, c.assigned, c.ticket])).toEqual([
      ['x', 'Maria', '42'],
      ['Shown', "O'Brien", null],
      // mermaid ignores falsy values.
      ['z', null, null],
    ]);
  });

  it('every card deeper than the columns belongs to the last column', () => {
    const m = model('kanban\n  T\n    a[x]\n      b[deeper]\n   c[odd]\n  D\n');
    expect(board(m)).toEqual([['T', ['x', 'deeper', 'odd']], ['D', []]]);
  });

  it('maps cards to lines and metadata spans', () => {
    const src = 'kanban\n  T\n    %% c\n    a[x]@{ ticket: 1 }\n    ::icon(fa)\n';
    const r = parseKanbanSource(src);
    if (!r.ok) throw new Error(r.reason);
    const card = r.map.columns[0].cards[0];
    expect(card.line).toBe(3);
    expect(card.ownLast).toBe(4);
    expect(card.meta?.entries.map((e) => e.key)).toEqual(['ticket']);
    expect(r.map.columns[0].lastLine).toBe(4);
    expect(r.model.columns[0].cards[0].icon).toBe('fa');
  });

  it('bails on what mermaid rejects or we cannot map', () => {
    for (const bad of [
      'kanban\n  T\n    a[x]\n D\n',
      'kanban\n  T\n    a[x] @{ ticket: 1 }\n',
      'kanban\n  T\n    a@b\n',
      'kanban\n  T\n  T\n',
      'kanban\n  T\n    a[x]@{ shape: Rect }\n',
      'kanban\n  T\n    a[x]@{ ticket: [1, 2] }\n',
      'pie\n  "a" : 1\n',
    ]) {
      expect(parseKanbanSource(bad).ok, bad).toBe(false);
    }
  });

  it('accepts an empty board and a frontmatter title', () => {
    expect(model('kanban\n').columns).toEqual([]);
    expect(model('---\ntitle: Board\n---\nkanban\n  T\n').title).toBe('Board');
  });

  it('the starter is a small valid board', async () => {
    expect(await mermaidAccepts(KANBAN_STARTER)).toBe(true);
    expect(model(KANBAN_STARTER).columns.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Oracle: mermaid's own board ──────────────────────────────────────

function mermaidText(s: unknown): string | null {
  if (s === undefined || s === null) return null;
  return decodeMermaidEntities(String(s).replace(/ﬂ°°(\d+)¶ß/g, '#$1;').replace(/ﬂ°(\w+)¶ß/g, '#$1;'))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function kanbanBlocks() {
  return corpusBlocks((b) => /^\s*kanban\s*$/m.test(b.source), ['mermaid-corpus.md', 'mermaid-corpus-kanban.md']);
}

describe('kanban parser: mermaid oracle', () => {
  const blocks = kanbanBlocks();
  it('finds the kanban corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(12);
  });
  for (const block of blocks) {
    it(`${block.heading}: same board as mermaid`, async () => {
      const r = parseKanban(block.source);
      if (!r.ok) throw new Error(r.reason);
      const { db } = await mermaidDb(block.source);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const theirs = db.getData().nodes.map((n: any) =>
        n.isGroup
          ? { column: mermaidText(n.id), text: mermaidText(n.label) }
          : {
              card: mermaidText(n.id),
              in: mermaidText(n.parentId),
              text: mermaidText(n.label),
              assigned: mermaidText(n.assigned),
              ticket: mermaidText(n.ticket),
              priority: mermaidText(n.priority),
              icon: mermaidText(n.icon),
            },
      );
      const ours = r.model.columns.flatMap((c) => [
        { column: c.id, text: c.text },
        ...c.cards.map((k) => ({
          card: k.id,
          in: c.id,
          text: k.text,
          assigned: k.assigned,
          ticket: k.ticket,
          priority: k.priority,
          icon: k.icon,
        })),
      ]);
      expect(ours).toEqual(theirs);
    });
  }
});
