// Editing the "data" diagram types (journey, quadrant, XY chart, Sankey,
// packet, radar): what they show is a table of rows, so that's how they
// are edited — click anywhere on the drawing (or the actions bar's first
// button) for the table, and the second button for the chart's titles
// and settings. Built on form-controller.ts; each type supplies its
// parser, its two forms and its edits (*-data.ts).

import type { EmptyState } from './controller';
import type { ActionsBarState, FormIcon } from './form';
import { FormController, type FormContent } from './form-controller';

export type DataSelection = { kind: 'data' } | { kind: 'settings' };

export abstract class DataController<M> extends FormController<M, DataSelection> {
  // What the actions bar calls the two forms, and the bar itself.
  protected abstract readonly names: { bar: string; data: string; dataIcon: FormIcon; settings: string | null };
  protected abstract dataForm(model: M): FormContent;
  // null: the type has no settings (no button for them).
  protected abstract settingsForm(model: M): FormContent | null;

  // The forms open under the bar, leaving its buttons free.
  protected barPlacement = 'below' as const;

  protected targetAt(): DataSelection {
    return { kind: 'data' };
  }

  protected elementFor(): Element | null {
    return null;
  }

  protected barAnchor(sel: DataSelection): string {
    return sel.kind;
  }

  protected exists(): boolean {
    return true;
  }

  protected isEmpty(): EmptyState | null {
    return null;
  }

  protected bar(): ActionsBarState {
    return {
      visible: true,
      ariaLabel: this.names.bar,
      align: 'left',
      items: [
        { id: 'data', label: this.names.data, icon: this.names.dataIcon, onClick: () => this.select({ kind: 'data' }) },
        ...(this.names.settings
          ? [{ id: 'settings', label: this.names.settings, icon: 'text' as const, onClick: () => this.select({ kind: 'settings' }) }]
          : []),
      ],
    };
  }

  protected content(sel: DataSelection, model: M): FormContent | null {
    return sel.kind === 'data' ? this.dataForm(model) : this.settingsForm(model);
  }

  // Applies an edit (source → new source, or null to refuse); the open
  // form stays open on the re-rendered diagram.
  protected change(edit: (source: string) => string | null): boolean {
    return this.apply((source) => {
      const next = edit(source);
      return next === null || next === source ? null : { source: next };
    });
  }
}
