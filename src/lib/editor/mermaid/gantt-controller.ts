// Gantt chart editing (see controller.ts for the contract, form-
// controller.ts for the shared plumbing). Click a bar or its label for
// the task: name, when it starts (a date, after another task, or when
// the task above ends), when it ends (a duration or a date), its status,
// its section; click a section title to rename or remove it; click the
// title to rename it. The actions bar adds tasks and sections, picks how
// dates are written and edits the title.
//
// Everything is in plain words: dates come and go as calendar dates,
// whatever format the chart writes them in; durations are a number and
// a unit; dependencies are other tasks by name.
import { parseGantt, GANTT_FLAGS, type GanttDurationUnit, type GanttFlag, type GanttModel, type GanttTask } from './gantt-parser';
import { applyGanttEdit, type GanttEdit, type GanttEditResult } from './gantt-edit';
import { ganttElementFor, ganttTargetAt } from './gantt-svg';
import { GANTT_DATE_FORMATS, formatGanttDate, ganttDateFormatSupported, toGanttDate } from './gantt-dates';
import type { EmptyState } from './controller';
import type { ActionsBarState, ChoiceOption, FormAction, FormField } from './form';
import { FormController, type FormContent } from './form-controller';

type Selection =
  | { kind: 'title' }
  | { kind: 'section'; index: number }
  | { kind: 'task'; index: number }
  | { kind: 'dates' };

const FLAG_LABELS: Record<GanttFlag, string> = {
  done: 'Done',
  active: 'In progress',
  crit: 'Critical',
  milestone: 'Milestone',
  vert: 'Marker line',
};

const UNIT_LABELS: Record<GanttDurationUnit, string> = {
  ms: 'milliseconds',
  s: 'seconds',
  m: 'minutes',
  h: 'hours',
  d: 'days',
  w: 'weeks',
  M: 'months',
  y: 'years',
};
const COMMON_UNITS: GanttDurationUnit[] = ['m', 'h', 'd', 'w', 'M'];

// The "no section" choice value.
const NO_SECTION = '';
// The date the format examples are shown for.
const SAMPLE = new Date(2026, 0, 31, 14, 30);

function today(): string {
  return toGanttDate(new Date()).slice(0, 10);
}

export class GanttController extends FormController<GanttModel, Selection> {
  protected parse(source: string): GanttModel | null {
    const r = parseGantt(source);
    return r.ok ? r.model : null;
  }

  protected targetAt(el: Element, svg: SVGSVGElement, model: GanttModel): Selection | null {
    return ganttTargetAt(el, svg, model);
  }

  protected elementFor(sel: Selection, svg: SVGSVGElement, model: GanttModel): Element | null {
    return sel.kind === 'dates' ? null : ganttElementFor(svg, model, sel);
  }

  protected barAnchor(sel: Selection): string {
    return sel.kind === 'dates' ? 'dates' : sel.kind === 'title' ? 'title' : sel.kind === 'section' ? 'add-section' : 'add-task';
  }

  protected exists(sel: Selection, model: GanttModel): boolean {
    if (sel.kind === 'section') return sel.index < model.sections.length;
    if (sel.kind === 'task') return sel.index < model.tasks.length;
    return true;
  }

  protected isEmpty(model: GanttModel): EmptyState | null {
    if (model.tasks.length || model.sections.length) return null;
    return { label: '+ Add first task', onActivate: () => this.addTask() };
  }

  protected bar(model: GanttModel): ActionsBarState {
    return {
      visible: true,
      ariaLabel: 'Gantt chart actions',
      align: 'left',
      items: [
        { id: 'add-task', label: 'Task', icon: 'plus', onClick: () => this.addTask() },
        { id: 'add-section', label: 'Section', icon: 'stack', onClick: () => this.addSection() },
        { id: 'dates', label: 'Dates', icon: 'calendar', onClick: () => this.select({ kind: 'dates' }) },
        { id: 'title', label: model.title ? 'Title' : 'Add title', icon: 'text', onClick: () => this.select({ kind: 'title' }) },
      ],
    };
  }

  protected content(sel: Selection, model: GanttModel): FormContent | null {
    switch (sel.kind) {
      case 'title':
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
      case 'dates':
        return this.datesContent(model);
      case 'section':
        return this.sectionContent(sel.index, model);
      case 'task':
        return this.taskContent(sel.index, model);
    }
  }

  // ── popovers ───────────────────────────────────────────────────────

  private datesContent(model: GanttModel): FormContent {
    const current = model.dateFormat;
    if (current && !ganttDateFormatSupported(current)) {
      return {
        key: 'dates',
        title: 'Dates',
        fields: [{ kind: 'hint', id: 'hint', text: 'This chart writes its dates in a way the editor can’t change.' }],
        actions: [],
      };
    }
    const options: ChoiceOption[] = GANTT_DATE_FORMATS.map((f) => ({ value: f.format, label: `${f.label} (${f.example})` }));
    if (!current) options.unshift({ value: '', label: `Not chosen (${formatGanttDate(SAMPLE, 'YYYY-MM-DD')})` });
    else if (!options.some((o) => o.value === current)) options.unshift({ value: current, label: `As now (${formatGanttDate(SAMPLE, current)})` });
    return {
      key: 'dates',
      title: 'Dates',
      fields: [
        {
          kind: 'choice',
          id: 'format',
          label: 'Write dates as',
          display: 'select',
          value: current,
          options,
          onChange: (format) => {
            if (format) this.edit({ kind: 'setDateFormat', format });
          },
        },
        { kind: 'hint', id: 'hint', text: 'Every date in the chart is rewritten the new way.' },
      ],
      actions: [],
    };
  }

  private sectionContent(index: number, model: GanttModel): FormContent | null {
    const section = model.sections[index];
    if (!section) return null;
    const actions: FormAction[] = [{ id: 'add-task', label: 'Add task here', icon: 'plus', onClick: () => this.addTask(index) }];
    if (index > 0) actions.push({ id: 'move-up', label: 'Move up', icon: 'up', onClick: () => this.moveSection(index, index - 1) });
    if (index < model.sections.length - 1) actions.push({ id: 'move-down', label: 'Move down', icon: 'down', onClick: () => this.moveSection(index, index + 1) });
    actions.push({
      id: 'delete',
      label: 'Delete section and its tasks',
      icon: 'trash',
      danger: true,
      onClick: () => this.applyRemoval((s) => applyGanttEdit(s, { kind: 'removeSection', index })),
    });
    return {
      key: `section:${index}`,
      title: 'Section',
      fields: [
        {
          kind: 'text',
          id: 'name',
          label: 'Name',
          value: section.name.replace(/\n/g, ' '),
          className: 'mermaid-section-name',
          onCommit: (name) => this.edit({ kind: 'renameSection', index, name }),
        },
      ],
      actions,
    };
  }

  private taskName(model: GanttModel, i: number): string {
    return model.tasks[i].name || `Task ${i + 1}`;
  }

  // Other tasks, by name, as choices.
  private otherTasks(model: GanttModel, index: number): ChoiceOption[] {
    return model.tasks.flatMap((_, i) => (i === index ? [] : [{ value: String(i), label: this.taskName(model, i) }]));
  }

  private taskContent(index: number, model: GanttModel): FormContent | null {
    const task = model.tasks[index];
    if (!task) return null;
    const fields: FormField[] = [
      {
        kind: 'text',
        id: 'name',
        label: 'Name',
        value: task.name,
        className: 'mermaid-task-name',
        onCommit: (name) => this.edit({ kind: 'setTaskName', index, name }),
      },
      ...this.startFields(index, task, model),
      ...this.endFields(index, task, model),
      ...GANTT_FLAGS.filter((f) => f !== 'vert' || task.flags.vert).map(
        (flag): FormField => ({
          kind: 'toggle',
          id: `flag-${flag}`,
          label: FLAG_LABELS[flag],
          value: task.flags[flag],
          onChange: (on) => this.edit({ kind: 'setTaskFlag', index, flag, on }),
        }),
      ),
    ];
    if (model.sections.length) {
      const noSection = task.section === null || model.tasks.some((t) => t.section === null);
      fields.push({
        kind: 'choice',
        id: 'section',
        label: 'Section',
        display: 'select',
        value: task.section === null ? NO_SECTION : String(task.section),
        options: [
          ...(noSection ? [{ value: NO_SECTION, label: 'No section' }] : []),
          ...model.sections.map((s, i) => ({ value: String(i), label: s.name.replace(/\n/g, ' ') || `Section ${i + 1}` })),
        ],
        onChange: (value) => {
          const section = value === NO_SECTION ? null : Number(value);
          this.edit({ kind: 'moveTaskToSection', index, section }, (r) => {
            // It lands last in its new section; the popover follows.
            const back = parseGantt(r.source);
            if (!back.ok) return;
            let at = -1;
            back.model.tasks.forEach((t, i) => t.section === section && (at = i));
            if (at >= 0) this.pendingSelect = { kind: 'task', index: at };
          });
        },
      });
    }
    const actions: FormAction[] = [];
    if (index > 0) actions.push({ id: 'move-up', label: 'Move up', icon: 'up', onClick: () => this.moveTask(index, index - 1) });
    if (index < model.tasks.length - 1) actions.push({ id: 'move-down', label: 'Move down', icon: 'down', onClick: () => this.moveTask(index, index + 1) });
    actions.push({ id: 'delete', label: 'Delete task', icon: 'trash', danger: true, onClick: () => this.applyRemoval((s) => applyGanttEdit(s, { kind: 'removeTask', index })) });
    return { key: `task:${index}`, title: 'Task', fields, actions };
  }

  private startFields(index: number, task: GanttTask, model: GanttModel): FormField[] {
    const mode = task.start.kind === 'raw' ? 'date' : task.start.kind;
    const others = this.otherTasks(model, index);
    const options: ChoiceOption[] = [{ value: 'date', label: 'On a date' }];
    if (others.length) options.push({ value: 'after', label: 'After another task' });
    if (index > 0) options.push({ value: 'previous', label: 'When the task above ends' });
    const fields: FormField[] = [
      {
        kind: 'choice',
        id: 'starts',
        label: 'Starts',
        display: 'select',
        value: mode,
        options,
        onChange: (value) => {
          if (value === 'date') this.edit({ kind: 'setTaskStart', index, start: { kind: 'date', date: today() } });
          else if (value === 'previous') this.edit({ kind: 'setTaskStart', index, start: { kind: 'previous' } });
          else if (value === 'after') {
            // The task above when it can be, else the first that can.
            const order = index > 0 ? [index - 1, ...model.tasks.map((_, i) => i)] : model.tasks.map((_, i) => i);
            for (const k of order) {
              if (k !== index && this.edit({ kind: 'setTaskStart', index, start: { kind: 'after', tasks: [k] } })) break;
            }
          }
        },
      },
    ];
    if (task.start.kind === 'date' || task.start.kind === 'raw') {
      const time = task.start.kind === 'date' ? task.start.date.slice(10) : '';
      fields.push({
        kind: 'date',
        id: 'start-date',
        label: 'Start date',
        value: task.start.kind === 'date' ? task.start.date.slice(0, 10) : '',
        onCommit: (date) => this.edit({ kind: 'setTaskStart', index, start: { kind: 'date', date: date + time } }),
      });
    } else if (task.start.kind === 'after') {
      const first = task.start.tasks[0];
      fields.push({
        kind: 'choice',
        id: 'after',
        label: 'Starts after',
        display: 'select',
        value: first === undefined ? '' : String(first),
        options: first === undefined ? [{ value: '', label: 'Choose a task' }, ...others] : others,
        onChange: (value) => {
          if (value !== '') this.edit({ kind: 'setTaskStart', index, start: { kind: 'after', tasks: [Number(value)] } });
        },
      });
      const more = task.start.tasks.slice(1).map((k) => this.taskName(model, k));
      if (more.length) fields.push({ kind: 'hint', id: 'after-more', text: `Also waits for ${more.join(', ')}.` });
    }
    return fields;
  }

  private endFields(index: number, task: GanttTask, model: GanttModel): FormField[] {
    const end = task.end;
    const mode = end.kind === 'raw' ? 'duration' : end.kind;
    const options: ChoiceOption[] = [{ value: 'duration', label: 'After a duration' }];
    // mermaid reads end dates only once the chart says how dates are written.
    if (model.dateFormat) options.push({ value: 'date', label: 'On a date' });
    if (end.kind === 'until') options.push({ value: 'until', label: 'When another task starts' });
    const startDate = task.start.kind === 'date' ? task.start.date.slice(0, 10) : today();
    const fields: FormField[] = [
      {
        kind: 'choice',
        id: 'ends',
        label: 'Ends',
        display: 'select',
        value: mode,
        options,
        onChange: (value) => {
          if (value === 'duration') this.edit({ kind: 'setTaskEnd', index, end: { kind: 'duration', value: 1, unit: 'd' } });
          else if (value === 'date') this.edit({ kind: 'setTaskEnd', index, end: { kind: 'date', date: startDate } });
        },
      },
    ];
    if (end.kind === 'duration' || end.kind === 'raw') {
      const unit = end.kind === 'duration' ? end.unit : 'd';
      const units = COMMON_UNITS.includes(unit) ? COMMON_UNITS : [...COMMON_UNITS, unit];
      fields.push(
        {
          kind: 'number',
          id: 'duration',
          label: 'Duration',
          value: end.kind === 'duration' ? end.value : null,
          min: 0,
          className: 'mermaid-task-duration',
          onCommit: (value) => this.edit({ kind: 'setTaskEnd', index, end: { kind: 'duration', value, unit } }),
        },
        {
          kind: 'choice',
          id: 'unit',
          label: 'Unit',
          display: 'select',
          value: unit,
          options: units.map((u) => ({ value: u, label: UNIT_LABELS[u] })),
          onChange: (u) =>
            this.edit({ kind: 'setTaskEnd', index, end: { kind: 'duration', value: end.kind === 'duration' ? end.value : 1, unit: u as GanttDurationUnit } }),
        },
      );
    } else if (end.kind === 'date') {
      const time = end.date.slice(10);
      fields.push({
        kind: 'date',
        id: 'end-date',
        label: 'End date',
        value: end.date.slice(0, 10),
        onCommit: (date) => this.edit({ kind: 'setTaskEnd', index, end: { kind: 'date', date: date + time } }),
      });
    } else if (end.kind === 'until') {
      const first = end.tasks[0];
      const others = this.otherTasks(model, index);
      fields.push({
        kind: 'choice',
        id: 'until',
        label: 'Ends when this starts',
        display: 'select',
        value: first === undefined ? '' : String(first),
        options: first === undefined ? [{ value: '', label: 'Choose a task' }, ...others] : others,
        onChange: (value) => {
          if (value !== '') this.edit({ kind: 'setTaskEnd', index, end: { kind: 'until', tasks: [Number(value)] } });
        },
      });
    }
    return fields;
  }

  // ── edits ──────────────────────────────────────────────────────────

  private edit(edit: GanttEdit, then?: (result: GanttEditResult) => void): boolean {
    return this.apply((s) => applyGanttEdit(s, edit), then);
  }

  private moveTask(from: number, to: number): void {
    this.edit({ kind: 'moveTask', from, to }, () => {
      this.pendingSelect = { kind: 'task', index: to };
    });
  }

  private moveSection(from: number, to: number): void {
    this.edit({ kind: 'moveSection', from, to }, () => {
      this.pendingSelect = { kind: 'section', index: to };
    });
  }

  // A fresh one-day task at the end of `section` (default: the last),
  // starting when the task above it ends — or today, for the first task.
  // Its popover opens so it can be named right away.
  private addTask(section?: number): void {
    const model = this.model;
    if (!model) return;
    const base = { kind: 'addTask' as const, name: 'New task', end: { kind: 'duration' as const, value: 1, unit: 'd' as const } };
    const tries: GanttEdit[] = [
      { ...base, start: { kind: 'previous' }, ...(section === undefined ? {} : { section }) },
      { ...base, start: { kind: 'date', date: today() }, ...(section === undefined ? {} : { section }) },
    ];
    for (const edit of tries) {
      const ok = this.edit(edit, (r) => {
        if (r.index !== undefined) this.pendingSelect = { kind: 'task', index: r.index };
      });
      if (ok) return;
    }
  }

  private addSection(): void {
    this.edit({ kind: 'addSection', name: 'New section' }, (r) => {
      if (r.index !== undefined) this.pendingSelect = { kind: 'section', index: r.index };
    });
  }
}
