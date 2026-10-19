// Pie chart editing through the real NodeView + real mermaid renders:
// click a wedge / legend entry / the title, edit through the popover,
// and check the exact source that comes out.
import { describe, it, expect } from 'vitest';
import { action, barButton, click, field, flush, form, makeView, typeBlur, typeEnter } from './mermaid-node-view-harness';
import { corpusBlocks } from './mermaid-test-utils';
import { EXTRA_CORPUS } from './mermaid-oracle-utils';
import { canEditDiagram } from '../../../src/lib/editor/mermaid/controller';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import '../../../src/lib/editor/mermaid/registry';

const PIE = [
  'pie',
  '    %% keep me',
  '    title Pets adopted',
  '    "Dogs" : 386',
  '    "Cats" : 85',
  '    "Rats" : 15',
].join('\n');

describe('MermaidNodeView pie', () => {
  it('is editable: no "coming soon" note, an actions bar', async () => {
    const { parent } = makeView(PIE);
    await flush();
    expect(parent.querySelector('.mermaid-block-editor')?.classList.contains('mermaid-fallback')).toBe(false);
    const note = Array.from(parent.querySelectorAll<HTMLElement>('*')).find((el) => /coming soon/i.test(el.textContent ?? '') && el.children.length === 0);
    expect(!note || note.hidden || !!note.closest('[hidden]')).toBe(true);
    expect(barButton(parent, 'add-slice')).toBeTruthy();
  });

  it('clicking a wedge opens its slice; renaming it changes only that line', async () => {
    const { parent, text } = makeView(PIE);
    await flush();
    click(parent.querySelectorAll('path.pieCircle')[1]);
    await flush(1);
    expect(parent.querySelectorAll('path.pieCircle')[1].classList.contains('mermaid-selected')).toBe(true);
    const label = field(parent, 'label');
    expect(label?.value).toBe('Cats');
    expect(field(parent, 'value')?.value).toBe('85');
    typeEnter(label, 'Kittens & co');
    await flush();
    expect(text()).toBe(PIE.replace('"Cats"', '"Kittens #amp; co"'));
    // Never any syntax in the popover.
    click(parent.querySelectorAll('path.pieCircle')[1]);
    await flush(1);
    expect(field(parent, 'label')?.value).toBe('Kittens & co');
  });

  it('a legend entry selects its slice; the value field writes the number', async () => {
    const { parent, text } = makeView(PIE);
    await flush();
    click(parent.querySelectorAll('g.legend')[2].querySelector('text'));
    await flush(1);
    typeBlur(field(parent, 'value'), '20.5');
    await flush();
    expect(text()).toBe(PIE.replace('"Rats" : 15', '"Rats" : 20.5'));
    // The popover stays open on the same slice, refreshed.
    expect(field(parent, 'value')?.value).toBe('20.5');
  });

  it('delete and move from the slice popover', async () => {
    const { parent, text } = makeView(PIE);
    await flush();
    click(parent.querySelectorAll('path.pieCircle')[0]);
    await flush(1);
    click(action(parent, 'move-down'));
    await flush();
    expect(text()).toBe(PIE.replace('    "Dogs" : 386\n    "Cats" : 85', '    "Cats" : 85\n    "Dogs" : 386'));
    // The popover follows the slice.
    expect(field(parent, 'label')?.value).toBe('Dogs');
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe(PIE.replace('    "Dogs" : 386\n', ''));
    expect(form(parent)).toBeNull();
  });

  it('the title opens a title field', async () => {
    const { parent, text } = makeView(PIE);
    await flush();
    click(parent.querySelector('text.pieTitleText'));
    await flush(1);
    typeEnter(field(parent, 'title'), 'Adoptions');
    await flush();
    expect(text()).toBe(PIE.replace('title Pets adopted', 'title Adoptions'));
  });

  it('"Slice" adds a slice and opens it; "Show values" toggles showData', async () => {
    const { parent, text } = makeView(PIE);
    await flush();
    click(barButton(parent, 'add-slice'));
    await flush();
    expect(text()).toBe(`${PIE}\n    "Slice 4" : 10`);
    expect(field(parent, 'label')?.value).toBe('Slice 4');
    click(barButton(parent, 'show-values'));
    await flush();
    expect(text().split('\n')[0]).toBe('pie showData');
    expect(barButton(parent, 'show-values')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('the Slices table edits, adds, removes and reorders', async () => {
    const { parent, text } = makeView(PIE);
    await flush();
    click(barButton(parent, 'slices'));
    await flush(1);
    const rows = () => form(parent)!.querySelectorAll('tbody tr');
    expect(rows().length).toBe(3);
    typeBlur(rows()[0].querySelector<HTMLInputElement>('input[aria-label="Value"]'), '400');
    await flush();
    expect(text()).toBe(PIE.replace('386', '400'));
    click(rows()[2].querySelector('button[aria-label="Move up"]'));
    await flush();
    expect(text()).toBe(PIE.replace('386', '400').replace('    "Cats" : 85\n    "Rats" : 15', '    "Rats" : 15\n    "Cats" : 85'));
    click(rows()[0].querySelector('button[aria-label="Remove"]'));
    await flush();
    expect(text()).toBe('pie\n    %% keep me\n    title Pets adopted\n    "Rats" : 15\n    "Cats" : 85');
    click(form(parent)!.querySelector('.mermaid-form-add'));
    await flush();
    expect(text()).toBe('pie\n    %% keep me\n    title Pets adopted\n    "Rats" : 15\n    "Cats" : 85\n    "Slice 3" : 10');
  });

  it('an empty pie offers its first slice', async () => {
    const { parent, text } = makeView('pie');
    await flush();
    const button = Array.from(parent.querySelectorAll('button')).find((b) => /first slice/i.test(b.textContent ?? ''));
    click(button);
    await flush();
    expect(text()).toBe('pie\n    "Slice 1" : 10');
  });
});

// The extra pie / gantt / timeline corpus (mermaid-corpus-pie-gantt-
// timeline.md): every block routes to its controller and is editable.
describe('pie / gantt / timeline corpus editability', () => {
  const blocks = corpusBlocks(undefined, [EXTRA_CORPUS]);
  it('every block is visually editable', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(20);
    for (const b of blocks) {
      const type = detectDiagramType(b.source);
      expect(['pie', 'gantt', 'timeline'], b.heading).toContain(type);
      expect(canEditDiagram(type, b.source), b.heading).toBe(true);
    }
  });
});