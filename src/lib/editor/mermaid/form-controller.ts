// Shared plumbing for diagram types whose every popover is a declarative
// form (pie, gantt, timeline — see controller.ts for the contract and
// flowchart-controller.ts for the reference): parse on load, map clicks
// on the rendered SVG to a selection, highlight it, open its form
// popover, and turn popover edits into source-preserving edits.
//
// A subclass supplies the type-specific parts: its parser, the SVG
// mapping (`*-svg.ts`), the popover for each selection and the actions
// bar. Selections that have no SVG element of their own (the title of an
// untitled chart, a table of all slices, a just-added empty section)
// anchor at the actions-bar button that opens them.
import MermaidFormPopover from '../../../components/MermaidFormPopover.svelte';
import MermaidActionsBar from '../../../components/MermaidActionsBar.svelte';
import type { DiagramController, DiagramHost, EmptyState } from './controller';
import { mountUi, type MountedUi } from './ui';
import { HIDDEN_BAR, HIDDEN_FORM, type ActionsBarState, type FormPopoverState } from './form';

export interface EditResult {
  source: string;
  index?: number;
}

// What a popover shows; position, visibility and closing are the base
// class's business.
export type FormContent = Pick<FormPopoverState, 'key' | 'title' | 'fields' | 'actions'>;

export abstract class FormController<M, S extends { kind: string }> implements DiagramController {
  protected readonly host: DiagramHost;
  // Latest successfully-parsed model; null in fallback mode (edit
  // handlers no-op then).
  protected model: M | null = null;
  protected selected: S | null = null;
  // Selection to apply once the in-flight render completes: add flows
  // know the new item's index before its SVG exists.
  protected pendingSelect: S | null = null;
  private form: MountedUi<FormPopoverState>;
  private actions: MountedUi<ActionsBarState>;

  constructor(host: DiagramHost) {
    this.host = host;
    this.form = mountUi(host, MermaidFormPopover, 'mermaid-popover-host mermaid-form-popover-host', HIDDEN_FORM);
    this.actions = mountUi(host, MermaidActionsBar, 'mermaid-popover-host mermaid-actions-host', HIDDEN_BAR);
  }

  // ── what a subclass provides ───────────────────────────────────────

  protected abstract parse(source: string): M | null;
  // The selection a click on `el` means, or null.
  protected abstract targetAt(el: Element, svg: SVGSVGElement, model: M): S | null;
  // The element that shows `sel` (highlighted, popover anchored at it).
  protected abstract elementFor(sel: S, svg: SVGSVGElement, model: M): Element | null;
  // The actions-bar button to anchor at when `sel` has no element.
  protected abstract barAnchor(sel: S): string;
  protected abstract exists(sel: S, model: M): boolean;
  protected abstract content(sel: S, model: M): FormContent | null;
  protected abstract bar(model: M): ActionsBarState;
  protected abstract isEmpty(model: M): EmptyState | null;
  // Where a popover opened from the actions bar goes: beside its button,
  // or under the bar (when it would cover the buttons beside it).
  protected barPlacement: 'right' | 'below' = 'right';

  // ── lifecycle ──────────────────────────────────────────────────────

  load(source: string): boolean {
    this.model = this.parse(source);
    return this.model !== null;
  }

  emptyState(): EmptyState | null {
    return this.model ? this.isEmpty(this.model) : null;
  }

  rendered(): void {
    // A pending select (from an add or a move) wins over restoring the
    // previous selection; a stale one falls through to the restore.
    const pending = this.pendingSelect;
    this.pendingSelect = null;
    if (this.model) this.actions.show(this.bar(this.model));
    if (pending && this.model && this.exists(pending, this.model)) {
      this.select(pending);
    } else if (this.selected) {
      // Fresh SVG elements: re-apply the highlight and re-anchor (and
      // refresh) the popover, or drop a selection that went.
      if (this.model && this.exists(this.selected, this.model)) this.select(this.selected);
      else this.clearSelection();
    }
  }

  cleared(): void {
    this.pendingSelect = null;
    this.clearSelection();
    this.actions.hide();
  }

  click(target: Element): boolean {
    const svg = this.svg();
    const hit = svg && this.model ? this.targetAt(target, svg, this.model) : null;
    if (hit) {
      this.select(hit);
      return true;
    }
    this.clearSelection();
    return false;
  }

  destroy(): void {
    this.form.destroy();
    this.actions.destroy();
  }

  // ── selection ──────────────────────────────────────────────────────

  protected svg(): SVGSVGElement | null {
    return this.host.renderedEl.querySelector('svg');
  }

  protected select(sel: S): void {
    const model = this.model;
    if (!model) return;
    this.selected = sel;
    this.host.dom.classList.add('mermaid-has-selection');
    this.unhighlight();
    const svg = this.svg();
    const el = svg ? this.elementFor(sel, svg, model) : null;
    el?.classList.add('mermaid-selected');
    const content = this.content(sel, model);
    if (!content) {
      this.form.hide();
      return;
    }
    const anchor = el ?? this.host.dom.querySelector(`.mermaid-actions-bar [data-action="${this.barAnchor(sel)}"]`);
    const { x, y } = this.host.anchor(anchor, el ? 'right' : this.barPlacement);
    this.form.show({
      visible: true,
      x,
      y,
      ...content,
      onClose: () => this.clearSelection(),
    });
  }

  protected clearSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.unhighlight();
    this.form.hide();
  }

  // Deletes make the selection stale — drop it BEFORE committing so the
  // re-render (synchronous on a cache hit) doesn't select whatever moves
  // into that place.
  protected dropSelection(): void {
    this.selected = null;
    this.host.dom.classList.remove('mermaid-has-selection');
    this.form.hide();
  }

  private unhighlight(): void {
    this.host.renderedEl.querySelectorAll('.mermaid-selected').forEach((el) => el.classList.remove('mermaid-selected'));
  }

  // ── edits ──────────────────────────────────────────────────────────

  // Run an edit on the current source and commit it. `then` runs with
  // the result before the commit (which may re-render synchronously),
  // so add / move flows can set pendingSelect first. Returns whether
  // anything was committed (a refused edit returns false).
  protected apply<R extends EditResult>(edit: (source: string) => R | null, then?: (result: R) => void): boolean {
    if (!this.model) return false;
    const source = this.host.source();
    if (source == null) return false;
    const result = edit(source);
    if (!result) return false;
    then?.(result);
    this.host.commit(result.source);
    return true;
  }

  // An edit that removes the selected item.
  protected applyRemoval<R extends EditResult>(edit: (source: string) => R | null): void {
    this.dropSelection();
    this.apply(edit);
  }
}
