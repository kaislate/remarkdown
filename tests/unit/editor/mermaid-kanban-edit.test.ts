// Source-preserving visual edits on kanban boards. The invariant:
// after a visual edit, every source line the edit did not semantically
// touch is byte-identical — comments, %%{init}%% directives,
// frontmatter, blank lines, other columns and cards, their metadata.
import { describe, it, expect, beforeAll } from 'vitest';
import mermaid from 'mermaid';
import { applyKanbanEdit, type KanbanEdit } from '../../../src/lib/editor/mermaid/kanban-edit';
import {
  parseKanban,
  parseKanbanSource,
  type KanbanModel,
  type KanbanSourceMap,
} from '../../../src/lib/editor/mermaid/kanban-parser';
import { moveItem } from '../../../src/lib/editor/mermaid/source-text';
import { corpusBlocks, mermaidAccepts, removedLines, FUZZ_INPUTS } from './mermaid-test-utils';

(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

function edit(src: string, e: KanbanEdit): string {
  const r = applyKanbanEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

function model(src: string): KanbanModel {
  const r = parseKanban(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

describe('kanban edits: targeted examples', () => {
  const SRC = [
    'kanban',
    '  %% board',
    '  todo[To do]',
    "    a[Draft]@{ assigned: 'Sam', ticket: T-1 }",
    '    b[Review]',
    '    ::icon(fa fa-eye)',
    '  Done',
    '    [Shipped]',
  ].join('\n');

  it('renames columns and cards in place', () => {
    expect(edit(SRC, { kind: 'renameColumn', column: 0, text: 'Backlog' })).toBe(SRC.replace('todo[To do]', 'todo[Backlog]'));
    expect(edit(SRC, { kind: 'renameCard', column: 0, card: 0, text: 'First (draft)' })).toBe(
      SRC.replace('a[Draft]', 'a["First (draft)"]'),
    );
    expect(edit(SRC, { kind: 'renameColumn', column: 1, text: 'Finished' })).toBe(SRC.replace('  Done', '  Finished'));
    // A metadata label is what mermaid shows, so that is what changes.
    expect(edit('kanban\n  T\n    a[x]@{ label: "Old" }\n', { kind: 'renameCard', column: 0, card: 0, text: 'New' })).toBe(
      'kanban\n  T\n    a[x]@{ label: New }\n',
    );
  });

  it('never gives two columns one id (they would share their cards)', () => {
    const out = edit(SRC, { kind: 'renameColumn', column: 1, text: 'todo' });
    expect(out).toBe(SRC.replace('  Done', '  col1[todo]'));
    expect(model(out).columns.map((c) => c.cards.length)).toEqual([2, 1]);
    const added = applyKanbanEdit(SRC, { kind: 'addColumn', text: 'Done' })!;
    expect(added.source).toBe(`${SRC}\n  col1[Done]`);
    expect(added.column).toBe(2);
  });

  it('adds columns and cards with the board’s indentation', () => {
    expect(edit(SRC, { kind: 'addColumn', text: 'Doing', after: 0 })).toBe(SRC.replace('  Done', '  Doing\n  Done'));
    const card = applyKanbanEdit(SRC, { kind: 'addCard', column: 0, text: 'Plan', position: 1 })!;
    expect(card).toEqual({ source: SRC.replace('    b[Review]', '    [Plan]\n    b[Review]'), column: 0, card: 1 });
    expect(edit(SRC, { kind: 'addCard', column: 0, text: 'Last' })).toBe(SRC.replace('    ::icon(fa fa-eye)', '    ::icon(fa fa-eye)\n    [Last]'));
    expect(edit('kanban\n\tT\n', { kind: 'addCard', column: 0, text: 'x' })).toBe('kanban\n\tT\n\t\t[x]\n');
    expect(edit('kanban\n', { kind: 'addColumn', text: 'Todo' })).toBe('kanban\n  Todo\n');
  });

  it('deletes cards and columns with their lines', () => {
    expect(edit(SRC, { kind: 'deleteCard', column: 0, card: 1 })).toBe(SRC.replace('    b[Review]\n    ::icon(fa fa-eye)\n', ''));
    expect(edit(SRC, { kind: 'deleteColumn', column: 0 })).toBe(
      'kanban\n  %% board\n  Done\n    [Shipped]',
    );
  });

  it('moves cards between columns, byte for byte', () => {
    const out = applyKanbanEdit(SRC, { kind: 'moveCard', column: 0, card: 0, toColumn: 1, toPosition: 1 })!;
    expect(out.source).toBe(
      ['kanban', '  %% board', '  todo[To do]', '    b[Review]', '    ::icon(fa fa-eye)', '  Done', '    [Shipped]', "    a[Draft]@{ assigned: 'Sam', ticket: T-1 }"].join('\n'),
    );
    expect(out).toMatchObject({ column: 1, card: 1 });
    expect(edit(SRC, { kind: 'moveCard', column: 0, card: 1, toColumn: 0, toPosition: 0 })).toBe(
      SRC.replace("    a[Draft]@{ assigned: 'Sam', ticket: T-1 }\n    b[Review]\n    ::icon(fa fa-eye)", "    b[Review]\n    ::icon(fa fa-eye)\n    a[Draft]@{ assigned: 'Sam', ticket: T-1 }"),
    );
  });

  it('reorders columns, comments stay put', () => {
    expect(edit(SRC, { kind: 'moveColumn', column: 1, to: 0 })).toBe(
      ['kanban', '  %% board', '  Done', '    [Shipped]', '  todo[To do]', "    a[Draft]@{ assigned: 'Sam', ticket: T-1 }", '    b[Review]', '    ::icon(fa fa-eye)'].join('\n'),
    );
  });

  it('sets, changes and removes assigned / ticket / priority', () => {
    expect(edit(SRC, { kind: 'setCardMeta', column: 0, card: 0, assigned: 'Kim', priority: 'Very High' })).toBe(
      SRC.replace("a[Draft]@{ assigned: 'Sam', ticket: T-1 }", 'a[Draft]@{ assigned: Kim, ticket: T-1, priority: Very High }'),
    );
    expect(edit(SRC, { kind: 'setCardMeta', column: 0, card: 0, assigned: '', ticket: '' })).toBe(SRC.replace("@{ assigned: 'Sam', ticket: T-1 }", ''));
    expect(edit(SRC, { kind: 'setCardMeta', column: 0, card: 1, ticket: '#42 & "x"' })).toBe(
      SRC.replace('b[Review]', 'b[Review]@{ ticket: "#42 #amp; #quot;x#quot;" }'),
    );
    const block = 'kanban\n  T\n    a[x]@{\n      assigned: "Maria"\n      ticket: 7\n    }\n';
    expect(edit(block, { kind: 'setCardMeta', column: 0, card: 0, ticket: '', priority: 'Low' })).toBe(
      'kanban\n  T\n    a[x]@{\n      assigned: "Maria"\n      priority: Low\n    }\n',
    );
  });

  it('keeps CRLF, frontmatter and init directives', () => {
    const src = '---\r\ntitle: B\r\n---\r\n%%{init: {"theme": "forest"}}%%\r\nkanban\r\n  T\r\n    [a]\r\n';
    expect(edit(src, { kind: 'addCard', column: 0, text: 'b' })).toBe(src.replace('    [a]\r\n', '    [a]\r\n    [b]\r\n'));
    expect(edit(src, { kind: 'setTitle', title: 'New' })).toBe(src.replace('title: B', 'title: New'));
  });

  it('refuses what it cannot do', () => {
    expect(applyKanbanEdit('pie\n  "a" : 1\n', { kind: 'addColumn', text: 'x' })).toBeNull();
    expect(applyKanbanEdit(SRC, { kind: 'renameCard', column: 0, card: 9, text: 'x' })).toBeNull();
    expect(applyKanbanEdit(SRC, { kind: 'moveCard', column: 0, card: 0, toColumn: 5, toPosition: 0 })).toBeNull();
  });
});

// ── Expected models ──────────────────────────────────────────────────

type Board = Array<{ text: string; markdown: boolean; icon: string | null; classes: string[]; cards: Array<Record<string, unknown>> }>;

function view(m: KanbanModel): Board {
  return m.columns.map((c) => ({
    text: c.text,
    markdown: c.markdown,
    icon: c.icon,
    classes: c.classes,
    cards: c.cards.map((k) => ({
      text: k.text,
      markdown: k.markdown,
      assigned: k.assigned,
      ticket: k.ticket,
      priority: k.priority,
      icon: k.icon,
      classes: k.classes,
    })),
  }));
}

const TRICKY = 'Renamed "q" (x) [y] {z} #59; `b` *s* _u_ a\\b %% c & <i> x:::y @{ a: 1 } kanban';
const NEW_CARD = (text: string) => ({ text, markdown: false, assigned: null, ticket: null, priority: null, icon: null, classes: [] });
const NEW_COLUMN = (text: string) => ({ text, markdown: false, icon: null, classes: [], cards: [] });

interface Op {
  name: string;
  edit: KanbanEdit;
  expected: (b: Board) => Board;
  touches: Array<[number, number]>;
}

function opsFor(m: KanbanModel, map: KanbanSourceMap): Op[] {
  const ops: Op[] = [];
  const cols = map.columns;
  const n = cols.length;
  ops.push({ name: 'add column', edit: { kind: 'addColumn', text: TRICKY }, expected: (b) => [...b, NEW_COLUMN(TRICKY)], touches: [] });
  if (n) {
    ops.push({
      name: 'add column after 0',
      edit: { kind: 'addColumn', text: 'Doing', after: 0 },
      expected: (b) => { b.splice(1, 0, NEW_COLUMN('Doing')); return b; },
      touches: [],
    });
  }
  m.columns.forEach((c, ci) => {
    const block: [number, number] = [cols[ci].line, cols[ci].lastLine];
    ops.push({
      name: `rename column ${ci}`,
      edit: { kind: 'renameColumn', column: ci, text: TRICKY },
      expected: (b) => { b[ci].text = TRICKY; return b; },
      touches: [[cols[ci].line, cols[ci].endLine]],
    });
    ops.push({
      name: `delete column ${ci}`,
      edit: { kind: 'deleteColumn', column: ci },
      expected: (b) => { b.splice(ci, 1); return b; },
      touches: [block],
    });
    for (const to of [0, n - 1]) {
      if (to === ci) continue;
      const lo = Math.min(ci, to);
      const hi = Math.max(ci, to);
      ops.push({
        name: `move column ${ci} to ${to}`,
        edit: { kind: 'moveColumn', column: ci, to },
        expected: (b) => moveItem(b, ci, to),
        touches: [[cols[lo].line, cols[hi].lastLine]],
      });
    }
    for (const position of [0, c.cards.length]) {
      ops.push({
        name: `add card ${ci}@${position}`,
        edit: { kind: 'addCard', column: ci, text: TRICKY, position },
        expected: (b) => { b[ci].cards.splice(position, 0, NEW_CARD(TRICKY)); return b; },
        touches: [],
      });
    }
    c.cards.forEach((_, ki) => {
      const s = cols[ci].cards[ki];
      const own: [number, number] = [s.line, s.endLine];
      ops.push({
        name: `rename card ${ci}/${ki}`,
        edit: { kind: 'renameCard', column: ci, card: ki, text: TRICKY },
        expected: (b) => { b[ci].cards[ki].text = TRICKY; return b; },
        touches: [own],
      });
      ops.push({
        name: `delete card ${ci}/${ki}`,
        edit: { kind: 'deleteCard', column: ci, card: ki },
        expected: (b) => { b[ci].cards.splice(ki, 1); return b; },
        touches: [[s.line, s.ownLast]],
      });
      ops.push({
        name: `meta card ${ci}/${ki}`,
        edit: { kind: 'setCardMeta', column: ci, card: ki, assigned: TRICKY, priority: 'Very High' },
        expected: (b) => { Object.assign(b[ci].cards[ki], { assigned: TRICKY, priority: 'Very High' }); return b; },
        touches: [own],
      });
      ops.push({
        name: `clear meta card ${ci}/${ki}`,
        edit: { kind: 'setCardMeta', column: ci, card: ki, assigned: '', ticket: '', priority: '' },
        expected: (b) => { Object.assign(b[ci].cards[ki], { assigned: null, ticket: null, priority: null }); return b; },
        touches: [own],
      });
      for (const toColumn of [ci, (ci + 1) % n]) {
        const toPosition = toColumn === ci ? 0 : m.columns[toColumn].cards.length;
        if (toColumn === ci && ki === 0) continue;
        const dest = toColumn === ci ? cols[ci].ownLast : cols[toColumn].lastLine;
        ops.push({
          name: `move card ${ci}/${ki} to ${toColumn}@${toPosition}`,
          edit: { kind: 'moveCard', column: ci, card: ki, toColumn, toPosition },
          expected: (b) => { const [card] = b[ci].cards.splice(ki, 1); b[toColumn].cards.splice(toPosition, 0, card); return b; },
          touches: [[Math.min(s.line, dest), Math.max(s.ownLast, dest)]],
        });
      }
    });
  });
  return ops;
}

function kanbanBlocks() {
  return corpusBlocks((b) => /^\s*kanban\s*$/m.test(b.source), ['mermaid-corpus.md', 'mermaid-corpus-kanban.md']);
}

describe('kanban edits: corpus property', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false });
  });
  const blocks = kanbanBlocks();
  it('finds the kanban corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(12);
  });
  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const parsed = parseKanbanSource(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      const lines = parsed.map.lines;
      const ops = opsFor(parsed.model, parsed.map);
      expect(ops.length).toBeGreaterThan(parsed.model.columns.length * 4);
      for (const op of ops) {
        const res = applyKanbanEdit(block.source, op.edit);
        expect(res, op.name).not.toBeNull();
        const out = res!.source;

        const back = parseKanban(out);
        expect(back.ok, `${op.name}: own output unparseable:\n${out}`).toBe(true);
        if (!back.ok) continue;
        expect(view(back.model), `${op.name}:\n${out}`).toEqual(op.expected(view(parsed.model)));

        const allowed = new Set<string>();
        for (const [a, b] of op.touches) for (let k = a; k <= b; k++) allowed.add(lines[k]);
        for (const line of removedLines(block.source, out)) {
          expect(allowed.has(line), `${op.name} changed an unrelated line ${JSON.stringify(line)}:\n${out}`).toBe(true);
        }

        expect(await mermaidAccepts(out), `${op.name}:\n${out}`).toBe(true);
      }
    }, 60_000);
  }
});

// ── Typed text: mermaid accepts it and shows it as typed ─────────────

const EXTRA_INPUTS = ['**bold**', '_under_', 'a\\*b', '# heading', '- dash', 'kanban board', 'mail@example.com', '@{ x: 1 }', '}', '^caret', 'null', 'true', '42', '1.50', "it's ok"];

async function shown(src: string) {
  const { svg } = await mermaid.render(`kbfuzz${Math.random().toString(36).slice(2)}`, src);
  const d = new DOMParser().parseFromString(svg, 'text/html');
  const columns = Array.from(d.querySelectorAll('g.cluster')).map((g) => g.textContent ?? '');
  const cards = Array.from(d.querySelectorAll('g.items > g.node')).map((g) =>
    Array.from(g.children)
      .filter((l) => l.matches('g.label'))
      .map((l) => l.textContent ?? ''),
  );
  return { columns, cards };
}

describe('kanban edits: typed text', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false });
  });
  const START = "kanban\n  Todo\n    a[Card]\n    [Bare]@{ assigned: 'x' }\n";
  for (const text of [...FUZZ_INPUTS, ...EXTRA_INPUTS]) {
    it(`shows ${JSON.stringify(text)} as typed`, async () => {
      let src = edit(START, { kind: 'renameColumn', column: 0, text });
      src = edit(src, { kind: 'renameCard', column: 0, card: 0, text });
      src = edit(src, { kind: 'setCardMeta', column: 0, card: 0, assigned: text, ticket: text });
      src = edit(src, { kind: 'renameCard', column: 0, card: 1, text });
      src = edit(src, { kind: 'addCard', column: 0, text });
      src = edit(src, { kind: 'addColumn', text });
      expect(await mermaidAccepts(src), src).toBe(true);
      const want = text === '' ? ' ' : text;
      const m = model(src);
      expect(m.columns.map((c) => c.text), src).toEqual([want, want]);
      expect(m.columns[0].cards.map((c) => c.text), src).toEqual([want, want, want]);
      expect([m.columns[0].cards[0].assigned, m.columns[0].cards[0].ticket], src).toEqual(text === '' ? [null, null] : [text, text]);
      const { columns, cards } = await shown(src);
      const seen = text === '' ? '' : text;
      expect(columns, src).toEqual([seen, seen]);
      // Card labels: text, ticket, assigned.
      expect(cards[0], src).toEqual([seen, seen, seen]);
      expect(cards.map((c) => c[0]), src).toEqual([seen, seen, seen]);
    });
  }
});
