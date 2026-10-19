// Timeline editing (see controller.ts for the contract, form-
// controller.ts for the shared plumbing). Click a period for its label
// and a table of its events; click an event for its text; click a
// section header to rename or remove it; click the title to rename it.
// The actions bar adds periods and sections and edits the title.
import { parseTimeline, type TimelineModel } from './timeline-parser';
import { applyTimelineEdit, type TimelineEdit, type TimelineEditResult } from './timeline-edit';
import { timelineElementFor, timelineTargetAt, type TimelineTarget } from './timeline-svg';
import type { EmptyState } from './controller';
import type { ActionsBarState, FormAction, FormField } from './form';
import { FormController, type FormContent } from './form-controller';

type Selection = TimelineTarget;

// No section: the choice value for "above every section".
const NO_SECTION = '';

export class TimelineController extends FormController<TimelineModel, Selection> {
  protected parse(source: string): TimelineModel | null {
    const r = parseTimeline(source);
    return r.ok ? r.model : null;
  }

  protected targetAt(el: Element, svg: SVGSVGElement, model: TimelineModel): Selection | null {
    return timelineTargetAt(el, svg, model);
  }

  protected elementFor(sel: Selection, svg: SVGSVGElement, model: TimelineModel): Element | null {
    return timelineElementFor(svg, model, sel);
  }

  protected barAnchor(sel: Selection): string {
    return sel.kind === 'title' ? 'title' : sel.kind === 'section' ? 'add-section' : 'add-period';
  }

  protected exists(sel: Selection, model: TimelineModel): boolean {
    if (sel.kind === 'section') return sel.index < model.sections.length;
    if (sel.kind === 'period') return sel.index < model.periods.length;
    if (sel.kind === 'event') return sel.index < (model.periods[sel.period]?.events.length ?? 0);
    return true;
  }

  protected isEmpty(model: TimelineModel): EmptyState | null {
    if (model.periods.length || model.sections.length) return null;
    return { label: '+ Add first period', onActivate: () => this.addPeriod() };
  }

  protected bar(model: TimelineModel): ActionsBarState {
    return {
      visible: true,
      ariaLabel: 'Timeline actions',
      align: 'left',
      items: [
        { id: 'add-period', label: 'Period', icon: 'plus', onClick: () => this.addPeriod() },
        { id: 'add-section', label: 'Section', icon: 'stack', onClick: () => this.addSection() },
        { id: 'title', label: model.title ? 'Title' : 'Add title', icon: 'text', onClick: () => this.select({ kind: 'title' }) },
      ],
    };
  }

  protected content(sel: Selection, model: TimelineModel): FormContent | null {
    switch (sel.kind) {
      case 'title':
        return {
          key: 'title',
          title: 'Timeline title',
          fields: [
            {
              kind: 'text',
              id: 'title',
              value: model.title,
              placeholder: 'Title shown above the timeline',
              className: 'mermaid-title-input',
              onCommit: (title) => this.edit({ kind: 'setTitle', title }),
            },
          ],
          actions: [],
        };
      case 'section':
        return this.sectionContent(sel.index, model);
      case 'period':
        return this.periodContent(sel.index, model);
      case 'event':
        return this.eventContent(sel.period, sel.index, model);
    }
  }

  private sectionContent(index: number, model: TimelineModel): FormContent | null {
    const section = model.sections[index];
    if (!section) return null;
    const actions: FormAction[] = [
      { id: 'add-period', label: 'Add period here', icon: 'plus', onClick: () => this.addPeriod(index) },
    ];
    if (index > 0) actions.push({ id: 'move-up', label: 'Move left', icon: 'left', onClick: () => this.moveSection(index, index - 1) });
    if (index < model.sections.length - 1) actions.push({ id: 'move-down', label: 'Move right', icon: 'right', onClick: () => this.moveSection(index, index + 1) });
    actions.push({
      id: 'delete',
      label: 'Delete section and its periods',
      icon: 'trash',
      danger: true,
      onClick: () => this.applyRemoval((s) => applyTimelineEdit(s, { kind: 'removeSection', index })),
    });
    return {
      key: `section:${index}`,
      title: 'Section',
      fields: [
        {
          kind: 'text',
          id: 'name',
          label: 'Name',
          value: section.name,
          className: 'mermaid-section-name',
          onCommit: (name) => this.edit({ kind: 'renameSection', index, name }),
        },
      ],
      actions,
    };
  }

  private periodContent(index: number, model: TimelineModel): FormContent | null {
    const period = model.periods[index];
    if (!period) return null;
    const fields: FormField[] = [
      {
        kind: 'text',
        id: 'label',
        label: 'Period',
        value: period.label,
        placeholder: 'e.g. 2024, Q1, Week 3',
        className: 'mermaid-period-label',
        onCommit: (label) => this.edit({ kind: 'setPeriodLabel', index, label }),
      },
      {
        kind: 'rows',
        id: 'events',
        label: 'Events',
        columns: [{ id: 'text', label: 'Event', kind: 'text' }],
        rows: period.events.map((text) => ({ text })),
        addLabel: 'Add event',
        onCell: (row, _column, value) => this.edit({ kind: 'setEventText', period: index, index: row, text: String(value) }),
        onAdd: () => this.edit({ kind: 'addEvent', period: index, text: 'New event' }),
        onRemove: (row) => this.edit({ kind: 'removeEvent', period: index, index: row }),
        onMove: (from, to) => this.edit({ kind: 'moveEvent', period: index, from, to }),
      },
    ];
    if (model.sections.length) {
      fields.push({
        kind: 'choice',
        id: 'section',
        label: 'Section',
        display: 'select',
        value: period.section === null ? NO_SECTION : String(period.section),
        options: [
          ...(period.section === null ? [{ value: NO_SECTION, label: 'No section (not shown)' }] : []),
          ...model.sections.map((s, i) => ({ value: String(i), label: s.name || `Section ${i + 1}` })),
        ],
        onChange: (value) => {
          const section = value === NO_SECTION ? null : Number(value);
          this.edit({ kind: 'movePeriodToSection', index, section }, (r) => {
            // It lands last in its new section; the popover follows.
            const back = parseTimeline(r.source);
            if (!back.ok) return;
            let at = -1;
            back.model.periods.forEach((p, i) => p.section === section && (at = i));
            if (at >= 0) this.pendingSelect = { kind: 'period', index: at };
          });
        },
      });
    }
    const actions: FormAction[] = [];
    if (index > 0) actions.push({ id: 'move-up', label: 'Move earlier', icon: 'left', onClick: () => this.movePeriod(index, index - 1) });
    if (index < model.periods.length - 1) actions.push({ id: 'move-down', label: 'Move later', icon: 'right', onClick: () => this.movePeriod(index, index + 1) });
    actions.push({ id: 'delete', label: 'Delete period', icon: 'trash', danger: true, onClick: () => this.applyRemoval((s) => applyTimelineEdit(s, { kind: 'removePeriod', index })) });
    return { key: `period:${index}`, title: 'Period', fields, actions };
  }

  private eventContent(period: number, index: number, model: TimelineModel): FormContent | null {
    const events = model.periods[period]?.events;
    if (!events || index >= events.length) return null;
    const actions: FormAction[] = [];
    if (index > 0) actions.push({ id: 'move-up', label: 'Move up', icon: 'up', onClick: () => this.moveEvent(period, index, index - 1) });
    if (index < events.length - 1) actions.push({ id: 'move-down', label: 'Move down', icon: 'down', onClick: () => this.moveEvent(period, index, index + 1) });
    actions.push({
      id: 'delete',
      label: 'Delete event',
      icon: 'trash',
      danger: true,
      onClick: () => this.applyRemoval((s) => applyTimelineEdit(s, { kind: 'removeEvent', period, index })),
    });
    return {
      key: `event:${period}:${index}`,
      title: 'Event',
      fields: [
        {
          kind: 'text',
          id: 'text',
          label: 'Event',
          value: events[index],
          className: 'mermaid-event-text',
          onCommit: (text) => this.edit({ kind: 'setEventText', period, index, text }),
        },
      ],
      actions,
    };
  }

  // ── edits ──────────────────────────────────────────────────────────

  private edit(edit: TimelineEdit, then?: (result: TimelineEditResult) => void): boolean {
    return this.apply((s) => applyTimelineEdit(s, edit), then);
  }

  private movePeriod(from: number, to: number): void {
    this.edit({ kind: 'movePeriod', from, to }, () => {
      this.pendingSelect = { kind: 'period', index: to };
    });
  }

  private moveEvent(period: number, from: number, to: number): void {
    this.edit({ kind: 'moveEvent', period, from, to }, () => {
      this.pendingSelect = { kind: 'event', period, index: to };
    });
  }

  private moveSection(from: number, to: number): void {
    this.edit({ kind: 'moveSection', from, to }, () => {
      this.pendingSelect = { kind: 'section', index: to };
    });
  }

  // A fresh period (at the end, or at the end of `section`), its popover
  // open so it can be named right away.
  private addPeriod(section?: number): void {
    const edit: TimelineEdit = section === undefined ? { kind: 'addPeriod', label: 'New period' } : { kind: 'addPeriod', label: 'New period', section };
    this.edit(edit, (r) => {
      if (r.index !== undefined) this.pendingSelect = { kind: 'period', index: r.index };
    });
  }

  // The first section of a timeline that has periods goes above them
  // (mermaid would stop drawing periods outside any section); later ones
  // go at the end.
  private addSection(): void {
    const model = this.model;
    if (!model) return;
    const top = model.sections.length === 0 && model.periods.length > 0;
    this.edit({ kind: 'addSection', name: 'New section', ...(top ? { afterIndex: -1 } : {}) }, (r) => {
      if (r.index !== undefined) this.pendingSelect = { kind: 'section', index: r.index };
    });
  }
}
