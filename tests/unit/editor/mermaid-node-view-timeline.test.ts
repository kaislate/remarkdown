// Timeline editing through the real NodeView + real mermaid renders:
// click a period / event / section header / the title, edit through the
// popover, and check the exact source that comes out.
import { describe, it, expect } from 'vitest';
import { action, barButton, choose, click, field, flush, form, makeView, typeBlur, typeEnter } from './mermaid-node-view-harness';

const TL = [
  'timeline',
  '    title History',
  '    %% keep me',
  '    section Early',
  '        2002 : LinkedIn',
  '        2004 : Facebook : Google',
  '             : YouTube',
  '    section Late',
  '        2006 : Twitter',
].join('\n');

// Boxes in drawing order: section Early, 2002, LinkedIn, 2004, Facebook,
// Google, YouTube, section Late, 2006, Twitter.
const box = (parent: HTMLElement, n: number) => parent.querySelectorAll('g.timeline-node')[n];

describe('MermaidNodeView timeline', () => {
  it('is editable, with an actions bar', async () => {
    const { parent } = makeView(TL);
    await flush();
    expect(parent.querySelector('.mermaid-block-editor')?.classList.contains('mermaid-fallback')).toBe(false);
    expect(barButton(parent, 'add-period')).toBeTruthy();
    expect(barButton(parent, 'add-section')).toBeTruthy();
  });

  it('a period opens its label and its events as a table', async () => {
    const { parent, text } = makeView(TL);
    await flush();
    click(box(parent, 3).querySelector('path'));
    await flush(1);
    expect(box(parent, 3).classList.contains('mermaid-selected')).toBe(true);
    expect(field(parent, 'label')?.value).toBe('2004');
    const rows = () => form(parent)!.querySelectorAll('[data-field="events"] tbody tr');
    expect(Array.from(rows()).map((r) => r.querySelector('input')!.value)).toEqual(['Facebook', 'Google', 'YouTube']);
    typeBlur(rows()[1].querySelector('input'), 'Alphabet');
    await flush();
    expect(text()).toBe(TL.replace('Google', 'Alphabet'));
    click(rows()[2].querySelector('button[aria-label="Move up"]'));
    await flush();
    expect(text()).toBe(TL.replace(': Facebook : Google\n             : YouTube', ': Facebook : YouTube\n             : Alphabet'));
    click(rows()[0].querySelector('button[aria-label="Remove"]'));
    await flush();
    expect(text()).toBe(TL.replace('2004 : Facebook : Google\n             : YouTube', '2004 : YouTube\n             : Alphabet'));
    click(form(parent)!.querySelector('[data-field="events"] .mermaid-form-add'));
    await flush();
    expect(text()).toBe(TL.replace('2004 : Facebook : Google\n             : YouTube', '2004 : YouTube\n             : Alphabet\n             : New event'));
    typeEnter(field(parent, 'label'), 'Year 2004');
    await flush();
    expect(text().split('\n')[5]).toBe('        Year 2004 : YouTube');
  });

  it('an event opens its text; delete and move from its popover', async () => {
    const { parent, text } = makeView(TL);
    await flush();
    click(box(parent, 4).querySelector('tspan'));
    await flush(1);
    expect(field(parent, 'text')?.value).toBe('Facebook');
    typeEnter(field(parent, 'text'), 'Meta: the company');
    await flush();
    expect(text()).toBe(TL.replace('Facebook', 'Meta#58; the company'));
    click(box(parent, 4).querySelector('path'));
    await flush(1);
    expect(field(parent, 'text')?.value).toBe('Meta: the company');
    click(action(parent, 'move-down'));
    await flush();
    expect(text()).toBe(TL.replace('Facebook : Google', 'Google : Meta#58; the company'));
    // The popover follows the event.
    expect(field(parent, 'text')?.value).toBe('Meta: the company');
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe(TL.replace('Facebook : Google', 'Google'));
    expect(form(parent)).toBeNull();
  });

  it('moves and deletes periods; moves one to another section', async () => {
    const { parent, text } = makeView(TL);
    await flush();
    click(box(parent, 1).querySelector('path'));
    await flush(1);
    click(action(parent, 'move-down'));
    await flush();
    expect(text()).toBe(TL.replace('        2002 : LinkedIn\n', '').replace('             : YouTube\n', '             : YouTube\n        2002 : LinkedIn\n'));
    expect(field(parent, 'label')?.value).toBe('2002');
    choose(field<HTMLSelectElement>(parent, 'section', 'select'), '1');
    await flush();
    expect(text()).toBe(TL.replace('        2002 : LinkedIn\n', '') + '\n        2002 : LinkedIn');
    expect(field(parent, 'label')?.value).toBe('2002');
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe(TL.replace('        2002 : LinkedIn\n', ''));
  });

  it('section headers rename and delete (with their periods)', async () => {
    const { parent, text } = makeView(TL);
    await flush();
    click(box(parent, 7).querySelector('tspan'));
    await flush(1);
    typeEnter(field(parent, 'name'), 'Recent');
    await flush();
    expect(text()).toBe(TL.replace('section Late', 'section Recent'));
    click(box(parent, 7).querySelector('path'));
    await flush(1);
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe(TL.split('\n').slice(0, 7).join('\n'));
  });

  it('the title, "+ Period" and "+ Section" open their popovers', async () => {
    const { parent, text } = makeView(TL);
    await flush();
    const title = Array.from(parent.querySelector('.mermaid-rendered svg')!.children).find((c) => c.tagName.toLowerCase() === 'text');
    click(title);
    await flush(1);
    typeEnter(field(parent, 'title'), 'Social media');
    await flush();
    expect(text()).toBe(TL.replace('title History', 'title Social media'));
    click(barButton(parent, 'add-period'));
    await flush();
    expect(text()).toBe(`${TL.replace('title History', 'title Social media')}\n        New period`);
    expect(field(parent, 'label')?.value).toBe('New period');
    click(barButton(parent, 'add-section'));
    await flush();
    expect(text().endsWith('        New period\n    section New section')).toBe(true);
    expect(field(parent, 'name')?.value).toBe('New section');
  });

  it('the first section of a timeline goes above its periods', async () => {
    const src = 'timeline\n    2002 : LinkedIn\n    2004 : Facebook';
    const { parent, text } = makeView(src);
    await flush();
    click(barButton(parent, 'add-section'));
    await flush();
    expect(text()).toBe('timeline\n    section New section\n    2002 : LinkedIn\n    2004 : Facebook');
  });

  it('an empty timeline offers its first period', async () => {
    const { parent, text } = makeView('timeline');
    await flush();
    click(Array.from(parent.querySelectorAll('button')).find((b) => /first period/i.test(b.textContent ?? '')));
    await flush();
    expect(text()).toBe('timeline\n    New period');
  });
});
