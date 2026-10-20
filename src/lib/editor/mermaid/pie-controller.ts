// Pie chart editing (see controller.ts for the contract, form-
// controller.ts for the shared plumbing). Click a wedge or a legend
// entry for that slice's label and value; click the title to rename it.
// The actions bar adds slices, opens a table of every slice (the only
// way to reach a slice too small to have a wedge besides its legend
// entry), toggles "Show values" and edits the title.
import { parsePie, type PieModel } from './pie-parser';
import { applyPieEdit, isValidPieValue, pieLabelTaken, type PieEdit, type PieEditResult } from './pie-edit';
import { pieElementFor, pieTargetAt } from './pie-svg';
import type { EmptyState } from './controller';
import type { ActionsBarState, FormAction } from './form';
import { FormController, type FormContent } from './form-controller';

type Selection = { kind: 'title' } | { kind: 'slice'; index: number } | { kind: 'slices' };

export class PieController extends FormController<PieModel, Selection> {
  protected parse(source: string): PieModel | null {
    const r = parsePie(source);
    return r.ok ? r.model : null;
  }

  protected targetAt(el: Element, svg: SVGSVGElement, model: PieModel): Selection | null {
    return pieTargetAt(el, svg, model);
  }

  protected elementFor(sel: Selection, svg: SVGSVGElement, model: PieModel): Element | null {
    return sel.kind === 'slices' ? null : pieElementFor(svg, model, sel);
  }

  protected barAnchor(sel: Selection): string {
    return sel.kind === 'slices' ? 'slices' : sel.kind === 'title' ? 'title' : 'add-slice';
  }

  protected exists(sel: Selection, model: PieModel): boolean {
    return sel.kind !== 'slice' || sel.index < model.slices.length;
  }

  protected isEmpty(model: PieModel): EmptyState | null {
    return model.slices.length ? null : { label: '+ Add first slice', onActivate: () => this.addSlice() };
  }

  protected bar(model: PieModel): ActionsBarState {
    return {
      visible: true,
      ariaLabel: 'Pie chart actions',
      align: 'left',
      items: [
        { id: 'add-slice', label: 'Slice', icon: 'plus', onClick: () => this.addSlice() },
        { id: 'slices', label: 'Slices', icon: 'table', onClick: () => this.select({ kind: 'slices' }) },
        {
          id: 'show-values',
          label: 'Show values',
          icon: 'hash',
          active: model.showData,
          onClick: () => this.edit({ kind: 'setShowData', showData: !model.showData }),
        },
        { id: 'title', label: model.title ? 'Title' : 'Add title', icon: 'text', onClick: () => this.select({ kind: 'title' }) },
      ],
    };
  }

  protected content(sel: Selection, model: PieModel): FormContent | null {
    if (sel.kind === 'title') {
      return {
        key: 'title',
        title: 'Chart title',
        fields: [
          {
            kind: 'text',
            id: 'title',
            value: model.title,
            placeholder: 'Title shown above the chart',
            className: 'mermaid-title-input',
            onCommit: (title) => this.edit({ kind: 'setTitle', title }),
          },
        ],
        actions: [],
      };
    }
    if (sel.kind === 'slices') {
      return {
        key: 'slices',
        title: 'Slices',
        fields: [
          {
            kind: 'rows',
            id: 'slices',
            columns: [
              { id: 'label', label: 'Label', kind: 'text' },
              { id: 'value', label: 'Value', kind: 'number', width: '5em' },
            ],
            rows: model.slices.map((s) => ({ label: s.label, value: s.value })),
            addLabel: 'Add slice',
            onCell: (index, column, value) =>
              column === 'label'
                ? this.edit({ kind: 'setSliceLabel', index, label: String(value) })
                : this.setValue(index, Number(value)),
            onAdd: () => this.edit({ kind: 'addSlice', label: this.freeLabel(), value: 10 }),
            onRemove: (index) => this.edit({ kind: 'removeSlice', index }),
            onMove: (from, to) => this.edit({ kind: 'moveSlice', from, to }),
          },
          { kind: 'hint', id: 'hint', text: 'Each slice shows its share of the total.' },
        ],
        actions: [],
      };
    }
    const index = sel.index;
    const slice = model.slices[index];
    if (!slice) return null;
    const actions: FormAction[] = [];
    if (index > 0) actions.push({ id: 'move-up', label: 'Move up', icon: 'up', onClick: () => this.move(index, index - 1) });
    if (index < model.slices.length - 1) actions.push({ id: 'move-down', label: 'Move down', icon: 'down', onClick: () => this.move(index, index + 1) });
    actions.push({ id: 'delete', label: 'Delete slice', icon: 'trash', danger: true, onClick: () => this.applyRemoval((s) => applyPieEdit(s, { kind: 'removeSlice', index })) });
    return {
      key: `slice:${index}`,
      title: 'Slice',
      fields: [
        {
          kind: 'text',
          id: 'label',
          label: 'Label',
          value: slice.label,
          className: 'mermaid-pie-label',
          onCommit: (label) => this.edit({ kind: 'setSliceLabel', index, label }),
        },
        {
          kind: 'number',
          id: 'value',
          label: 'Value',
          value: slice.value,
          min: 0,
          className: 'mermaid-pie-value',
          onCommit: (value) => this.setValue(index, value),
        },
        ...(pieLabelTaken(model, slice.label, index) ? [{ kind: 'hint' as const, id: 'dup', text: 'Another slice has the same label.' }] : []),
      ],
      actions,
    };
  }

  // ── edits ──────────────────────────────────────────────────────────

  private edit(edit: PieEdit, then?: (result: PieEditResult) => void): boolean {
    return this.apply((s) => applyPieEdit(s, edit), then);
  }

  private setValue(index: number, value: number): void {
    if (isValidPieValue(value)) this.edit({ kind: 'setSliceValue', index, value });
  }

  // The popover follows the slice to its new place.
  private move(from: number, to: number): void {
    this.edit({ kind: 'moveSlice', from, to }, () => {
      this.pendingSelect = { kind: 'slice', index: to };
    });
  }

  private freeLabel(): string {
    const taken = (label: string) => !!this.model && pieLabelTaken(this.model, label);
    for (let n = (this.model?.slices.length ?? 0) + 1; ; n++) if (!taken(`Slice ${n}`)) return `Slice ${n}`;
  }

  // A fresh slice, its popover open so it can be named right away.
  private addSlice(): void {
    this.edit({ kind: 'addSlice', label: this.freeLabel(), value: 10 }, (r) => {
      if (r.index !== undefined) this.pendingSelect = { kind: 'slice', index: r.index };
    });
  }
}
