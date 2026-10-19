import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { tick } from 'svelte';
import MermaidFormPopover from '../../src/components/MermaidFormPopover.svelte';
import MermaidActionsBar from '../../src/components/MermaidActionsBar.svelte';
import { HIDDEN_FORM, type FormPopoverState, type ActionsBarState } from '../../src/lib/editor/mermaid/form';

function state(over: Partial<FormPopoverState>): FormPopoverState {
  return { ...HIDDEN_FORM, visible: true, x: 10, y: 20, key: 'item:1', onClose: () => {}, ...over };
}

describe('MermaidFormPopover', () => {
  it('is hidden when not visible', () => {
    const { container } = render(MermaidFormPopover, { props: { stateStore: writable({ ...HIDDEN_FORM }) } });
    expect(container.querySelector<HTMLElement>('.mermaid-form-popover')?.hidden).toBe(true);
  });

  it('text field: seeds, commits on Enter (then closes), reverts on Escape', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    const store = writable(state({
      title: 'Slice',
      onClose,
      fields: [{ kind: 'text', id: 'label', label: 'Label', value: 'Dogs', onCommit }],
    }));
    const { container } = render(MermaidFormPopover, { props: { stateStore: store } });
    await tick();
    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.value).toBe('Dogs');
    expect(container.textContent).toContain('Slice');
    await fireEvent.input(input, { target: { value: 'Cats' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Cats');
    expect(onClose).toHaveBeenCalled();
    await fireEvent.input(input, { target: { value: 'Rats' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    await tick();
    expect(input.value).toBe('Dogs');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('re-seeds drafts when the edited item changes', async () => {
    const store = writable(state({ fields: [{ kind: 'text', id: 'label', value: 'One', onCommit: () => {} }] }));
    const { container } = render(MermaidFormPopover, { props: { stateStore: store } });
    await tick();
    store.set(state({ key: 'item:2', fields: [{ kind: 'text', id: 'label', value: 'Two', onCommit: () => {} }] }));
    await tick();
    expect(container.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('Two');
  });

  it('number field commits numbers only', async () => {
    const onCommit = vi.fn();
    const store = writable(state({ fields: [{ kind: 'number', id: 'value', value: 5, onCommit }] }));
    const { container } = render(MermaidFormPopover, { props: { stateStore: store } });
    await tick();
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await fireEvent.input(input, { target: { value: '12.5' } });
    await fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(12.5);
  });

  it('toggle, choice and swatches call back immediately', async () => {
    const onToggle = vi.fn();
    const onChoice = vi.fn();
    const onColour = vi.fn();
    const store = writable(state({
      fields: [
        { kind: 'toggle', id: 'show', label: 'Show values', value: false, onChange: onToggle },
        { kind: 'choice', id: 'shape', value: 'a', options: [{ value: 'a', label: 'Round' }, { value: 'b', label: 'Square' }], onChange: onChoice },
        { kind: 'swatches', id: 'fill', value: null, palette: ['#ff0000'], onChange: onColour },
      ],
    }));
    const { container, getByLabelText } = render(MermaidFormPopover, { props: { stateStore: store } });
    await tick();
    await fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(onToggle).toHaveBeenCalledWith(true);
    await fireEvent.click(getByLabelText('Square'));
    expect(onChoice).toHaveBeenCalledWith('b');
    await fireEvent.click(getByLabelText('Colour #ff0000'));
    expect(onColour).toHaveBeenCalledWith('#ff0000');
    await fireEvent.click(getByLabelText('Default colour'));
    expect(onColour).toHaveBeenLastCalledWith(null);
  });

  it('rows: edit a cell, add, remove and reorder', async () => {
    const onCell = vi.fn();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const onMove = vi.fn();
    const store = writable(state({
      fields: [{
        kind: 'rows',
        id: 'slices',
        columns: [{ id: 'label', label: 'Name', kind: 'text' }, { id: 'value', label: 'Value', kind: 'number' }],
        rows: [{ label: 'Dogs', value: 3 }, { label: 'Cats', value: 2 }],
        addLabel: 'Add slice',
        onCell,
        onAdd,
        onRemove,
        onMove,
      }],
    }));
    const { container, getByText } = render(MermaidFormPopover, { props: { stateStore: store } });
    await tick();
    const cells = container.querySelectorAll<HTMLInputElement>('input.mermaid-form-cell');
    expect(Array.from(cells).map((c) => c.value)).toEqual(['Dogs', '3', 'Cats', '2']);
    await fireEvent.input(cells[2], { target: { value: 'Kittens' } });
    await fireEvent.blur(cells[2]);
    expect(onCell).toHaveBeenCalledWith(1, 'label', 'Kittens');
    await fireEvent.input(cells[3], { target: { value: '7' } });
    await fireEvent.keyDown(cells[3], { key: 'Enter' });
    expect(onCell).toHaveBeenCalledWith(1, 'value', 7);
    await fireEvent.click(getByText('Add slice'));
    expect(onAdd).toHaveBeenCalled();
    await fireEvent.click(container.querySelectorAll('tr[data-row="1"] button[aria-label="Remove"]')[0]);
    expect(onRemove).toHaveBeenCalledWith(1);
    await fireEvent.click(container.querySelectorAll('tr[data-row="1"] button[aria-label="Move up"]')[0]);
    expect(onMove).toHaveBeenCalledWith(1, 0);
  });

  it('actions', async () => {
    const onClick = vi.fn();
    const store = writable(state({ actions: [{ id: 'delete', label: 'Delete', icon: 'trash', danger: true, onClick }] }));
    const { getByLabelText } = render(MermaidFormPopover, { props: { stateStore: store } });
    await tick();
    await fireEvent.click(getByLabelText('Delete'));
    expect(onClick).toHaveBeenCalled();
  });

  it('never shows diagram syntax for a rich label: the field shows formatting, commits markdown', async () => {
    const onCommit = vi.fn();
    const store = writable(state({ fields: [{ kind: 'rich', id: 'label', value: '**Bold** label', onCommit }] }));
    const { container } = render(MermaidFormPopover, { props: { stateStore: store } });
    await tick();
    const field = container.querySelector<HTMLElement>('.mermaid-rich-field')!;
    expect(field.textContent).toBe('Bold label');
    expect(field.querySelector('b')?.textContent).toBe('Bold');
    expect(container.textContent).not.toMatch(/\*|`/);
    field.innerHTML = '<b>Bold</b> label <i>more</i>';
    await fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledWith('**Bold** label *more*');
  });
});

describe('MermaidActionsBar', () => {
  it('renders items, toggles and calls back', async () => {
    const onAdd = vi.fn();
    const store = writable<ActionsBarState>({
      visible: true,
      ariaLabel: 'Pie chart actions',
      items: [
        { id: 'add', label: 'Slice', icon: 'plus', onClick: onAdd },
        { id: 'values', label: 'Show values', active: true, onClick: () => {} },
      ],
    });
    const { getByLabelText, getByRole } = render(MermaidActionsBar, { props: { stateStore: store } });
    await tick();
    expect(getByRole('toolbar').getAttribute('aria-label')).toBe('Pie chart actions');
    expect(getByLabelText('Show values').getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(getByLabelText('Slice'));
    expect(onAdd).toHaveBeenCalled();
  });
});
