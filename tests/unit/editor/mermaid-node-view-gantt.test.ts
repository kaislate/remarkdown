// Gantt chart editing through the real NodeView + real mermaid renders:
// click a bar / task label / section title / the title, edit through the
// popover, and check the exact source that comes out.
import { describe, it, expect } from 'vitest';
import { action, barButton, choose, click, field, flush, form, makeView, typeBlur, typeEnter } from './mermaid-node-view-harness';

const G = [
  'gantt',
  '    title Plan',
  '    dateFormat YYYY-MM-DD',
  '    %% keep me',
  '    section Design',
  '    Research      :a1, 2026-01-05, 10d',
  '    Wireframes    :after a1, 7d',
  '    section Build',
  '    Implementation :2026-01-20, 20d',
  '    Testing        :crit, 5d',
].join('\n');
const L = G.split('\n');
const lines = (changes: Record<number, string>) => L.map((l, i) => changes[i] ?? l).join('\n');

const bar = (parent: HTMLElement, id: string) => {
  const svg = parent.querySelector('.mermaid-rendered svg')!;
  return svg.querySelector(`[id="${svg.id}-${id}"]`);
};

describe('MermaidNodeView gantt', () => {
  it('is editable, with an actions bar', async () => {
    const { parent } = makeView(G);
    await flush();
    expect(parent.querySelector('.mermaid-block-editor')?.classList.contains('mermaid-fallback')).toBe(false);
    for (const id of ['add-task', 'add-section', 'dates', 'title']) expect(barButton(parent, id), id).toBeTruthy();
  });

  it('a bar opens its task; name, duration and status edit one line', async () => {
    const { parent, text } = makeView(G);
    await flush();
    click(bar(parent, 'a1'));
    await flush(1);
    expect(bar(parent, 'a1')?.classList.contains('mermaid-selected')).toBe(true);
    expect(field(parent, 'name')?.value).toBe('Research');
    expect(field<HTMLSelectElement>(parent, 'starts', 'select')?.value).toBe('date');
    expect(field(parent, 'start-date')?.value).toBe('2026-01-05');
    expect(field(parent, 'duration')?.value).toBe('10');
    expect(field<HTMLSelectElement>(parent, 'unit', 'select')?.selectedOptions[0].textContent).toBe('days');
    typeBlur(field(parent, 'duration'), '12');
    await flush();
    expect(text()).toBe(lines({ 5: '    Research      :a1, 2026-01-05, 12d' }));
    choose(field<HTMLSelectElement>(parent, 'unit', 'select'), 'w');
    await flush();
    expect(text()).toBe(lines({ 5: '    Research      :a1, 2026-01-05, 12w' }));
    click(field(parent, 'flag-done'));
    await flush();
    expect(text()).toBe(lines({ 5: '    Research      :done, a1, 2026-01-05, 12w' }));
    typeEnter(field(parent, 'name'), 'User research');
    await flush();
    expect(text()).toBe(lines({ 5: '    User research      :done, a1, 2026-01-05, 12w' }));
  });

  it('a task label opens the task; start date and end date use calendar dates', async () => {
    const { parent, text } = makeView(G);
    await flush();
    click(bar(parent, 'task2-text'));
    await flush(1);
    expect(field(parent, 'name')?.value).toBe('Implementation');
    const start = field(parent, 'start-date')!;
    start.value = '2026-01-22';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    start.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(text()).toBe(lines({ 8: '    Implementation :2026-01-22, 20d' }));
    choose(field<HTMLSelectElement>(parent, 'ends', 'select'), 'date');
    await flush();
    expect(text()).toBe(lines({ 8: '    Implementation :2026-01-22, 2026-01-22' }));
    expect(field(parent, 'end-date')?.value).toBe('2026-01-22');
  });

  it('"Starts after" picks another task by name', async () => {
    const { parent, text } = makeView(G);
    await flush();
    click(bar(parent, 'task3'));
    await flush(1);
    expect(field<HTMLSelectElement>(parent, 'starts', 'select')?.value).toBe('previous');
    choose(field<HTMLSelectElement>(parent, 'starts', 'select'), 'after');
    await flush();
    // The task above gets an id so it can be referred to.
    expect(text()).toBe(lines({ 8: '    Implementation :implementation, 2026-01-20, 20d', 9: '    Testing        :crit, after implementation, 5d' }));
    const after = field<HTMLSelectElement>(parent, 'after', 'select')!;
    expect(Array.from(after.options).map((o) => o.textContent)).toEqual(['Research', 'Wireframes', 'Implementation']);
    choose(after, '0');
    await flush();
    expect(text()).toBe(lines({ 8: '    Implementation :implementation, 2026-01-20, 20d', 9: '    Testing        :crit, after a1, 5d' }));
    expect(form(parent)?.textContent).not.toMatch(/\ba1\b|crit,/);
  });

  it('moves, re-sections and deletes tasks without moving others', async () => {
    const { parent, text } = makeView(G);
    await flush();
    click(bar(parent, 'task1'));
    await flush(1);
    choose(field<HTMLSelectElement>(parent, 'section', 'select'), '1');
    await flush();
    expect(text()).toBe([...L.slice(0, 6), ...L.slice(7), '    Wireframes    :after a1, 7d'].join('\n'));
    expect(field(parent, 'name')?.value).toBe('Wireframes');
    click(action(parent, 'move-up'));
    await flush();
    // Testing started when the task above ended: it stays pinned to it.
    expect(text()).toBe([...L.slice(0, 6), ...L.slice(7, 9), '    Wireframes    :after a1, 7d', '    Testing        :crit, after implementation, 5d'].join('\n').replace('Implementation :2026', 'Implementation :implementation, 2026'));
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe([...L.slice(0, 6), ...L.slice(7, 9), '    Testing        :crit, after implementation, 5d'].join('\n').replace('Implementation :2026', 'Implementation :implementation, 2026'));
    expect(form(parent)).toBeNull();
  });

  it('section titles rename and delete (with their tasks)', async () => {
    const { parent, text } = makeView(G);
    await flush();
    const title = Array.from(parent.querySelectorAll('text.sectionTitle')).find((t) => t.textContent === 'Build');
    click(title?.querySelector('tspan'));
    await flush(1);
    typeEnter(field(parent, 'name'), 'Delivery');
    await flush();
    expect(text()).toBe(G.replace('section Build', 'section Delivery'));
    click(Array.from(parent.querySelectorAll('text.sectionTitle')).find((t) => t.textContent === 'Delivery'));
    await flush(1);
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe(L.slice(0, 7).join('\n'));
  });

  it('the date format is chosen by example, and every date is rewritten', async () => {
    const { parent, text } = makeView(G);
    await flush();
    click(barButton(parent, 'dates'));
    await flush(1);
    const select = field<HTMLSelectElement>(parent, 'format', 'select')!;
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('Day/month/year (31/01/2026)');
    expect(form(parent)?.textContent).not.toMatch(/YYYY|DD|MM/);
    choose(select, 'DD/MM/YYYY');
    await flush();
    expect(text()).toBe(lines({ 2: '    dateFormat DD/MM/YYYY', 5: '    Research      :a1, 05/01/2026, 10d', 8: '    Implementation :20/01/2026, 20d' }));
  });

  it('"+ Task" and "+ Section" add and open; the title edits', async () => {
    const { parent, text } = makeView(G);
    await flush();
    click(barButton(parent, 'add-task'));
    await flush();
    expect(text()).toBe(`${G}\n    New task :1d`);
    expect(field(parent, 'name')?.value).toBe('New task');
    click(barButton(parent, 'add-section'));
    await flush();
    expect(text()).toBe(`${G}\n    New task :1d\n    section New section`);
    expect(field(parent, 'name')?.value).toBe('New section');
    click(parent.querySelector('text.titleText'));
    await flush(1);
    typeEnter(field(parent, 'title'), 'Roadmap');
    await flush();
    expect(text().split('\n')[1]).toBe('    title Roadmap');
  });

  it('an empty chart offers its first task', async () => {
    const { parent, text } = makeView('gantt\n    dateFormat YYYY-MM-DD');
    await flush();
    click(Array.from(parent.querySelectorAll('button')).find((b) => /first task/i.test(b.textContent ?? '')));
    await flush();
    expect(text()).toMatch(/^gantt\n {4}dateFormat YYYY-MM-DD\n {4}New task :\d{4}-\d\d-\d\d, 1d$/);
  });
});
