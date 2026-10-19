// Declarative popovers and toolbars for diagram editing.
//
// Most diagram types need the same handful of controls: a text field,
// a number, a date, a few toggles, a choice between options, a colour,
// a small table of rows (pie slices, entity attributes, class members).
// Rather than a hand-built Svelte popover per item kind, a controller
// describes the popover as data (FormPopoverState) and
// MermaidFormPopover.svelte draws it; MermaidActionsBar.svelte does the
// same for the floating per-diagram toolbar. Nothing here ever shows
// diagram syntax: every field holds a user-level value, and the
// controller's callbacks turn it into a source edit.

// Icons the form components know how to draw (phosphor names).
export type FormIcon =
  | 'plus' | 'trash' | 'up' | 'down' | 'left' | 'right' | 'link' | 'swap' | 'indent' | 'outdent'
  | 'group' | 'ungroup' | 'note' | 'user' | 'users' | 'chat' | 'palette' | 'text' | 'calendar'
  | 'clock' | 'flag' | 'check' | 'star' | 'key' | 'table' | 'list' | 'hash' | 'repeat' | 'stack'
  | 'circle' | 'square' | 'rect' | 'diamond' | 'hexagon' | 'cylinder' | 'pill' | 'parallelogram'
  | 'cloud' | 'lightning' | 'triangle' | 'octagon' | 'database' | 'cube' | 'package' | 'function'
  | 'x' | 'branch' | 'pie' | 'chart' | 'tree' | 'kanban' | 'flow' | 'dots';

export interface ChoiceOption {
  value: string;
  label: string;
  icon?: FormIcon;
}

interface FieldBase {
  id: string;
  label?: string;
}

export interface TextField extends FieldBase {
  kind: 'text';
  value: string;
  placeholder?: string;
  // Extra class on the input (e.g. for tests / existing selectors).
  className?: string;
  // Commit on blur / Enter; Escape reverts.
  onCommit: (value: string) => void;
}

// Bold / italic text (see rich-text.ts); `value` is the label's
// markdown, which the field never shows as such.
export interface RichField extends FieldBase {
  kind: 'rich';
  value: string;
  placeholder?: string;
  // Shift+Enter inserts a line break when allowed.
  multiline?: boolean;
  className?: string;
  onCommit: (markdown: string) => void;
}

export interface NumberField extends FieldBase {
  kind: 'number';
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  onCommit: (value: number) => void;
}

// A calendar date, always `YYYY-MM-DD` here whatever the diagram writes.
export interface DateField extends FieldBase {
  kind: 'date';
  value: string;
  className?: string;
  onCommit: (value: string) => void;
}

export interface ToggleField extends FieldBase {
  kind: 'toggle';
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export interface ChoiceField extends FieldBase {
  kind: 'choice';
  value: string;
  options: ChoiceOption[];
  // 'buttons': a segmented row (icons when given); 'select': a dropdown.
  display?: 'buttons' | 'select';
  onChange: (value: string) => void;
}

// A colour: one of the palette swatches, or none (the diagram default).
export interface SwatchField extends FieldBase {
  kind: 'swatches';
  value: string | null;
  palette?: string[];
  onChange: (value: string | null) => void;
}

export interface RowColumn {
  id: string;
  label: string;
  kind: 'text' | 'number' | 'toggle' | 'choice';
  options?: ChoiceOption[];
  placeholder?: string;
  // CSS width of the column's control (e.g. '5em').
  width?: string;
}

export type RowValue = string | number | boolean;

// A small table (pie slices, entity attributes, …): edit cells in
// place, add / remove / reorder rows.
export interface RowsField extends FieldBase {
  kind: 'rows';
  columns: RowColumn[];
  rows: Array<Record<string, RowValue>>;
  addLabel?: string;
  onCell: (row: number, column: string, value: RowValue) => void;
  onAdd?: () => void;
  onRemove?: (row: number) => void;
  onMove?: (row: number, to: number) => void;
}

// Plain explanatory text (never syntax).
export interface HintField {
  kind: 'hint';
  id: string;
  text: string;
}

export type FormField =
  | TextField
  | RichField
  | NumberField
  | DateField
  | ToggleField
  | ChoiceField
  | SwatchField
  | RowsField
  | HintField;

export interface FormAction {
  id: string;
  label: string;
  icon?: FormIcon;
  danger?: boolean;
  onClick: () => void;
}

export interface FormPopoverState {
  visible: boolean;
  x: number;
  y: number;
  // Identity of what is being edited ("slice:2"). Text drafts are
  // re-seeded when it changes, so a fresh open shows fresh values.
  key: string;
  title?: string;
  fields: FormField[];
  actions: FormAction[];
  onClose: () => void;
}

export const HIDDEN_FORM: FormPopoverState = {
  visible: false,
  x: 0,
  y: 0,
  key: '',
  fields: [],
  actions: [],
  onClose: () => {},
};

export interface BarItem {
  id: string;
  label: string;
  icon?: FormIcon;
  // A toggle shows its on/off state.
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface ActionsBarState {
  visible: boolean;
  ariaLabel: string;
  items: BarItem[];
  // Corner of the diagram it sits in (default: top right).
  align?: 'left' | 'right';
}

export const HIDDEN_BAR: ActionsBarState = { visible: false, ariaLabel: '', items: [] };

// Fill colours that read well in both themes, and stronger ones for
// lines and text.
export const FILL_PALETTE = ['#fde68a', '#fecaca', '#bbf7d0', '#bfdbfe', '#e9d5ff', '#fed7aa', '#e5e7eb', '#334155'];
export const LINE_PALETTE = ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#9333ea', '#6b7280', '#111827'];

// The group picker's "New group…" choice.
export const NEW_GROUP = '+new';
