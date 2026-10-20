// The table editors for the data diagram types (see data-controller.ts):
// what each one's table and settings hold, in plain words, and which
// edit each change makes (*-data.ts).

import type { FormField } from './form';
import type { FormContent } from './form-controller';
import { DataController } from './data-controller';
import { applyJourneyEdit, parseJourney, type JourneyEdit, type JourneyModel } from './journey-data';
import { applyQuadrantEdit, parseQuadrant, type QuadrantEdit, type QuadrantModel } from './quadrant-data';
import { applyXyEdit, parseXyChart, xyRows, type XyEdit, type XyModel } from './xychart-data';
import { applySankeyEdit, parseSankey, type SankeyEdit, type SankeyModel } from './sankey-data';
import { applyPacketEdit, parsePacket, type PacketEdit, type PacketModel } from './packet-data';
import { applyRadarEdit, parseRadar, type RadarEdit, type RadarModel } from './radar-data';

const titleField = (value: string, onCommit: (v: string) => void, placeholder = 'Shown above the chart'): FormField => ({
  kind: 'text',
  id: 'title',
  label: 'Title',
  value,
  placeholder,
  className: 'mermaid-title-input',
  onCommit,
});

// ── journey ──────────────────────────────────────────────────────────

export class JourneyController extends DataController<JourneyModel> {
  protected readonly names = { bar: 'Journey actions', data: 'Steps', dataIcon: 'list' as const, settings: 'Title & sections' };

  protected parse(source: string) {
    return parseJourney(source);
  }

  private edit(e: JourneyEdit) {
    this.change((s) => applyJourneyEdit(s, e));
  }

  protected dataForm(model: JourneyModel): FormContent {
    const fields: FormField[] = [];
    model.sections.forEach((sec, i) => {
      fields.push({
        kind: 'rows',
        id: `tasks-${i}`,
        label: sec.line === null ? 'Steps' : sec.name,
        columns: [
          { id: 'name', label: 'Step', kind: 'text' },
          { id: 'score', label: 'Feeling (1–5)', kind: 'number', width: '4.5em' },
          { id: 'people', label: 'Who', kind: 'text', placeholder: 'Me, Friend' },
        ],
        rows: sec.tasks.map((t) => ({ name: t.name, score: t.score, people: t.people.join(', ') })),
        addLabel: 'Add step',
        onCell: (task, field, value) => this.edit({ kind: 'setTask', section: i, task, field: field as 'name' | 'score' | 'people', value: value as string | number }),
        onAdd: () => this.edit({ kind: 'addTask', section: i }),
        onRemove: (task) => this.edit({ kind: 'removeTask', section: i, task }),
        onMove: (from, to) => this.edit({ kind: 'moveTask', section: i, from, to }),
      });
    });
    fields.push({ kind: 'hint', id: 'hint', text: '5 is a great moment, 1 a bad one. Separate people with commas.' });
    return { key: 'journey-steps', title: 'Steps of the journey', fields, actions: [] };
  }

  protected settingsForm(model: JourneyModel): FormContent {
    const named = model.sections.map((s, i) => ({ s, i })).filter(({ s }) => s.line !== null);
    return {
      key: 'journey-settings',
      title: 'Journey',
      fields: [
        titleField(model.title?.value ?? '', (title) => this.edit({ kind: 'setTitle', title })),
        {
          kind: 'rows',
          id: 'sections',
          label: 'Sections',
          columns: [{ id: 'name', label: 'Section', kind: 'text' }],
          rows: named.map(({ s }) => ({ name: s.name })),
          addLabel: 'Add section',
          onCell: (row, _c, value) => this.edit({ kind: 'renameSection', section: named[row].i, name: String(value) }),
          onAdd: () => this.edit({ kind: 'addSection' }),
          onRemove: (row) => this.edit({ kind: 'removeSection', section: named[row].i }),
        },
      ],
      actions: [],
    };
  }
}

// ── quadrant ─────────────────────────────────────────────────────────

const QUADRANT_NAMES = ['Top right', 'Top left', 'Bottom left', 'Bottom right'];

export class QuadrantController extends DataController<QuadrantModel> {
  protected readonly names = { bar: 'Quadrant chart actions', data: 'Points', dataIcon: 'dots' as const, settings: 'Labels' };

  protected parse(source: string) {
    return parseQuadrant(source);
  }

  private edit(e: QuadrantEdit) {
    this.change((s) => applyQuadrantEdit(s, e));
  }

  protected dataForm(model: QuadrantModel): FormContent {
    return {
      key: 'quadrant-points',
      title: 'Points',
      fields: [
        {
          kind: 'rows',
          id: 'points',
          columns: [
            { id: 'name', label: 'Name', kind: 'text' },
            { id: 'x', label: 'Across', kind: 'number', width: '4.5em' },
            { id: 'y', label: 'Up', kind: 'number', width: '4.5em' },
          ],
          rows: model.points.map((p) => ({ name: p.name, x: p.x, y: p.y })),
          addLabel: 'Add point',
          onCell: (index, field, value) => this.edit({ kind: 'setPoint', index, field: field as 'name' | 'x' | 'y', value: value as string | number }),
          onAdd: () => this.edit({ kind: 'addPoint' }),
          onRemove: (index) => this.edit({ kind: 'removePoint', index }),
          onMove: (from, to) => this.edit({ kind: 'movePoint', from, to }),
        },
        { kind: 'hint', id: 'hint', text: 'Across and Up go from 0 (left, bottom) to 1 (right, top).' },
      ],
      actions: [],
    };
  }

  protected settingsForm(model: QuadrantModel): FormContent {
    const axis = (a: 'x' | 'y', end: 'low' | 'high', label: string): FormField => ({
      kind: 'text',
      id: `${a}-${end}`,
      label,
      value: (a === 'x' ? model.xAxis : model.yAxis)?.[end] ?? '',
      onCommit: (value) => this.edit({ kind: 'setAxis', axis: a, end, value }),
    });
    return {
      key: 'quadrant-settings',
      title: 'Labels',
      fields: [
        titleField(model.title?.value ?? '', (value) => this.edit({ kind: 'setTitle', value })),
        axis('x', 'low', 'Left end'),
        axis('x', 'high', 'Right end'),
        axis('y', 'low', 'Bottom end'),
        axis('y', 'high', 'Top end'),
        ...QUADRANT_NAMES.map((label, index): FormField => ({
          kind: 'text',
          id: `q${index + 1}`,
          label: `${label} quarter`,
          value: model.quadrants[index]?.value ?? '',
          onCommit: (value) => this.edit({ kind: 'setQuadrant', index, value }),
        })),
      ],
      actions: [],
    };
  }
}

// ── XY chart ─────────────────────────────────────────────────────────

const seriesName = (model: XyModel, i: number) => {
  const s = model.series[i];
  if (s.name) return s.name;
  const sameKind = model.series.filter((x) => x.kind === s.kind);
  const n = sameKind.indexOf(s) + 1;
  return `${s.kind === 'bar' ? 'Bars' : 'Line'}${sameKind.length > 1 ? ` ${n}` : ''}`;
};

export class XyChartController extends DataController<XyModel> {
  protected readonly names = { bar: 'Chart actions', data: 'Data', dataIcon: 'table' as const, settings: 'Chart' };

  protected parse(source: string) {
    return parseXyChart(source);
  }

  private edit(e: XyEdit) {
    this.change((s) => applyXyEdit(s, e));
  }

  protected dataForm(model: XyModel): FormContent {
    const rows = xyRows(model);
    return {
      key: `xy-data:${model.series.length}`,
      title: 'Data',
      fields: [
        {
          kind: 'rows',
          id: 'data',
          columns: [
            { id: 'label', label: 'Label', kind: 'text' },
            ...model.series.map((_, i) => ({ id: `s${i}`, label: seriesName(model, i), kind: 'number' as const, width: '5em' })),
          ],
          rows: Array.from({ length: rows }, (_, r) => ({
            label: model.xAxis?.categories[r] ?? '',
            ...Object.fromEntries(model.series.map((s, i) => [`s${i}`, s.values[r] ?? 0])),
          })),
          addLabel: 'Add row',
          onCell: (row, column, value) =>
            column === 'label'
              ? this.edit({ kind: 'setCategory', row, value: String(value) })
              : this.edit({ kind: 'setValue', row, series: Number(column.slice(1)), value: Number(value) }),
          onAdd: () => this.edit({ kind: 'addRow' }),
          onRemove: (row) => this.edit({ kind: 'removeRow', row }),
          onMove: (from, to) => this.edit({ kind: 'moveRow', from, to }),
        },
      ],
      actions: [],
    };
  }

  protected settingsForm(model: XyModel): FormContent {
    return {
      key: `xy-settings:${model.series.length}`,
      title: 'Chart',
      fields: [
        titleField(model.title?.value ?? '', (value) => this.edit({ kind: 'setTitle', value })),
        {
          kind: 'choice',
          id: 'direction',
          label: 'Direction',
          value: model.horizontal ? 'horizontal' : 'vertical',
          options: [
            { value: 'vertical', label: 'Upright' },
            { value: 'horizontal', label: 'Sideways' },
          ],
          onChange: (v) => this.edit({ kind: 'setHorizontal', value: v === 'horizontal' }),
        },
        { kind: 'text', id: 'x-title', label: 'Along the bottom', value: model.xAxis?.title ?? '', onCommit: (value) => this.edit({ kind: 'setXTitle', value }) },
        { kind: 'text', id: 'y-title', label: 'Up the side', value: model.yAxis?.title ?? '', onCommit: (title) => this.edit({ kind: 'setY', title }) },
        { kind: 'number', id: 'y-min', label: 'Scale from', value: model.yAxis?.min ?? null, placeholder: 'Automatic', onCommit: (min) => this.edit({ kind: 'setY', min }) },
        { kind: 'number', id: 'y-max', label: 'Scale to', value: model.yAxis?.max ?? null, placeholder: 'Automatic', onCommit: (max) => this.edit({ kind: 'setY', max }) },
        {
          kind: 'rows',
          id: 'series',
          label: 'Bars and lines',
          columns: [
            {
              id: 'kind',
              label: 'Drawn as',
              kind: 'choice',
              options: [
                { value: 'bar', label: 'Bars' },
                { value: 'line', label: 'Line' },
              ],
            },
            { id: 'name', label: 'Name', kind: 'text', placeholder: 'No name' },
          ],
          rows: model.series.map((s) => ({ kind: s.kind, name: s.name })),
          addLabel: 'Add bars',
          onCell: (series, field, value) => this.edit({ kind: 'setSeries', series, field: field as 'kind' | 'name', value: String(value) }),
          onAdd: () => this.edit({ kind: 'addSeries', seriesKind: 'bar' }),
          onRemove: (series) => this.edit({ kind: 'removeSeries', series }),
        },
      ],
      actions: [],
    };
  }
}

// ── Sankey ───────────────────────────────────────────────────────────

export class SankeyController extends DataController<SankeyModel> {
  protected readonly names = { bar: 'Flow diagram actions', data: 'Flows', dataIcon: 'flow' as const, settings: null };

  protected parse(source: string) {
    return parseSankey(source);
  }

  private edit(e: SankeyEdit) {
    this.change((s) => applySankeyEdit(s, e));
  }

  protected dataForm(model: SankeyModel): FormContent {
    return {
      key: 'sankey-flows',
      title: 'Flows',
      fields: [
        {
          kind: 'rows',
          id: 'flows',
          columns: [
            { id: 'from', label: 'From', kind: 'text' },
            { id: 'to', label: 'To', kind: 'text' },
            { id: 'amount', label: 'Amount', kind: 'number', width: '5em' },
          ],
          rows: model.flows.map((f) => ({ from: f.from, to: f.to, amount: f.amount })),
          addLabel: 'Add flow',
          onCell: (index, field, value) => this.edit({ kind: 'setFlow', index, field: field as 'from' | 'to' | 'amount', value: value as string | number }),
          onAdd: () => this.edit({ kind: 'addFlow' }),
          onRemove: (index) => this.edit({ kind: 'removeFlow', index }),
          onMove: (from, to) => this.edit({ kind: 'moveFlow', from, to }),
        },
        { kind: 'hint', id: 'hint', text: 'Use the same name twice to join flows up.' },
      ],
      actions: [],
    };
  }

  protected settingsForm(): null {
    return null;
  }
}

// ── packet ───────────────────────────────────────────────────────────

export class PacketController extends DataController<PacketModel> {
  protected readonly names = { bar: 'Packet diagram actions', data: 'Fields', dataIcon: 'stack' as const, settings: 'Title' };

  protected parse(source: string) {
    return parsePacket(source);
  }

  private edit(e: PacketEdit) {
    this.change((s) => applyPacketEdit(s, e));
  }

  protected dataForm(model: PacketModel): FormContent {
    return {
      key: 'packet-fields',
      title: 'Fields',
      fields: [
        {
          kind: 'rows',
          id: 'fields',
          columns: [
            { id: 'label', label: 'Field', kind: 'text' },
            { id: 'bits', label: 'Bits', kind: 'number', width: '4.5em' },
          ],
          rows: model.fields.map((f) => ({ label: f.label, bits: f.bits })),
          addLabel: 'Add field',
          onCell: (index, field, value) => this.edit({ kind: 'setField', index, field: field as 'label' | 'bits', value: value as string | number }),
          onAdd: () => this.edit({ kind: 'addField' }),
          onRemove: (index) => this.edit({ kind: 'removeField', index }),
          onMove: (from, to) => this.edit({ kind: 'moveField', from, to }),
        },
        { kind: 'hint', id: 'hint', text: 'Fields follow on from each other, in order.' },
      ],
      actions: [],
    };
  }

  protected settingsForm(model: PacketModel): FormContent {
    return {
      key: 'packet-settings',
      title: 'Title',
      fields: [titleField(model.title?.value ?? '', (value) => this.edit({ kind: 'setTitle', value }))],
      actions: [],
    };
  }
}

// ── radar ────────────────────────────────────────────────────────────

export class RadarController extends DataController<RadarModel> {
  protected readonly names = { bar: 'Radar chart actions', data: 'Scores', dataIcon: 'table' as const, settings: 'Chart' };

  protected parse(source: string) {
    return parseRadar(source);
  }

  private edit(e: RadarEdit) {
    this.change((s) => applyRadarEdit(s, e));
  }

  protected dataForm(model: RadarModel): FormContent {
    return {
      key: `radar-data:${model.curves.length}`,
      title: 'Scores',
      fields: [
        {
          kind: 'rows',
          id: 'scores',
          columns: [
            { id: 'label', label: 'Measure', kind: 'text' },
            ...model.curves.map((c, i) => ({ id: `c${i}`, label: c.label || c.id, kind: 'number' as const, width: '4.5em' })),
          ],
          rows: model.axes.map((a, r) => ({
            label: a.label || a.id,
            ...Object.fromEntries(model.curves.map((c, i) => [`c${i}`, c.values[r] ?? 0])),
          })),
          addLabel: 'Add measure',
          onCell: (row, column, value) =>
            column === 'label'
              ? this.edit({ kind: 'setAxisLabel', row, value: String(value) })
              : this.edit({ kind: 'setValue', row, curve: Number(column.slice(1)), value: Number(value) }),
          onAdd: () => this.edit({ kind: 'addAxis' }),
          onRemove: (row) => this.edit({ kind: 'removeAxis', row }),
          onMove: (from, to) => this.edit({ kind: 'moveAxis', from, to }),
        },
      ],
      actions: [],
    };
  }

  protected settingsForm(model: RadarModel): FormContent {
    return {
      key: `radar-settings:${model.curves.length}`,
      title: 'Chart',
      fields: [
        titleField(model.title?.value ?? '', (value) => this.edit({ kind: 'setTitle', value })),
        { kind: 'number', id: 'min', label: 'Scale from', value: model.min?.value ?? null, placeholder: 'Automatic', onCommit: (value) => this.edit({ kind: 'setRange', end: 'min', value }) },
        { kind: 'number', id: 'max', label: 'Scale to', value: model.max?.value ?? null, placeholder: 'Automatic', onCommit: (value) => this.edit({ kind: 'setRange', end: 'max', value }) },
        {
          kind: 'rows',
          id: 'curves',
          label: 'Who or what is scored',
          columns: [{ id: 'name', label: 'Name', kind: 'text' }],
          rows: model.curves.map((c) => ({ name: c.label || c.id })),
          addLabel: 'Add',
          onCell: (curve, _c, value) => this.edit({ kind: 'setCurveLabel', curve, value: String(value) }),
          onAdd: () => this.edit({ kind: 'addCurve' }),
          onRemove: (curve) => this.edit({ kind: 'removeCurve', curve }),
        },
      ],
      actions: [],
    };
  }
}
