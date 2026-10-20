// User journeys: tasks grouped in sections, each scored 1–5 (how it felt)
// with the people involved.
//
//   journey
//     title My working day
//     section Go to work
//       Make tea: 5: Me
//       Go upstairs: 3: Me, Cat
//
// Parsed into rows, each knowing its line; edits rewrite only that line
// (or add / remove one). Anything else in the diagram (accessibility
// lines…) makes it a text-edited diagram instead.

import { LineEditor, statements, indentNear, freeName } from './data-lines';
import { DEFAULT_INDENT, indentOf } from './source-text';

export const JOURNEY_STARTER = 'journey\n    title A day out\n    section Morning\n      Wake up: 3: Me\n      Breakfast: 5: Me\n    section Afternoon\n      Walk in the park: 4: Me, Friend\n';

export interface JourneyTask {
  line: number;
  name: string;
  score: number;
  people: string[];
}

export interface JourneySection {
  line: number | null; // null: tasks before any section
  name: string;
  tasks: JourneyTask[];
}

export interface JourneyModel {
  header: number;
  title: { line: number; value: string } | null;
  sections: JourneySection[];
}

const HEADER = /^journey\s*$/;

export function parseJourney(source: string): JourneyModel | null {
  const st = statements(source, HEADER);
  if (!st) return null;
  const model: JourneyModel = { header: st.header, title: null, sections: [] };
  let section: JourneySection | null = null;
  for (const [line, t] of st.items) {
    let m: RegExpExecArray | null;
    if ((m = /^title\s+(.*)$/.exec(t))) model.title = { line, value: m[1].trim() };
    else if ((m = /^section\s+(.*)$/.exec(t))) {
      section = { line, name: m[1].trim(), tasks: [] };
      model.sections.push(section);
    } else if ((m = /^([^:]+?)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?::\s*(.*))?$/.exec(t))) {
      if (!section) {
        section = { line: null, name: '', tasks: [] };
        model.sections.push(section);
      }
      const people = (m[3] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
      section.tasks.push({ line, name: m[1].trim(), score: Number(m[2]), people });
    } else return null;
  }
  return model;
}

// Text that can't hold a colon (it separates the parts of a task).
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/:/g, ' -').replace(/\s+/g, ' ').trim();
const clampScore = (n: number) => Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n : 3)));

export function taskLine(indent: string, t: { name: string; score: number; people: string[] }): string {
  const people = t.people.map(clean).filter((p) => p && !p.includes(',')).join(', ');
  return `${indent}${clean(t.name) || 'Task'}: ${clampScore(t.score)}${people ? `: ${people}` : ''}`;
}

const splitPeople = (s: string) => s.split(',').map((p) => clean(p)).filter(Boolean);

export type JourneyEdit =
  | { kind: 'setTitle'; title: string }
  | { kind: 'renameSection'; section: number; name: string }
  | { kind: 'setTask'; section: number; task: number; field: 'name' | 'score' | 'people'; value: string | number }
  | { kind: 'addTask'; section: number }
  | { kind: 'removeTask'; section: number; task: number }
  | { kind: 'moveTask'; section: number; from: number; to: number }
  | { kind: 'addSection' }
  | { kind: 'removeSection'; section: number };

export function applyJourneyEdit(source: string, edit: JourneyEdit): string | null {
  const model = parseJourney(source);
  if (!model) return null;
  const ed = new LineEditor(source);
  const lines = ed.lines;
  const sec = 'section' in edit ? model.sections[edit.section] : undefined;
  switch (edit.kind) {
    case 'setTitle': {
      const title = clean(edit.title);
      if (model.title) return title ? ed.set(model.title.line, `${indentOf(lines[model.title.line])}title ${title}`).toString() : ed.remove(model.title.line).toString();
      if (!title) return null;
      return ed.insert(model.header + 1, `${indentNear(lines, model.header + 1, model.header)}title ${title}`).toString();
    }
    case 'renameSection': {
      if (!sec || sec.line === null) return null;
      const name = clean(edit.name);
      if (!name) return null;
      return ed.set(sec.line, `${indentOf(lines[sec.line])}section ${name}`).toString();
    }
    case 'setTask': {
      const task = sec?.tasks[edit.task];
      if (!task) return null;
      const next = { ...task };
      if (edit.field === 'name') next.name = String(edit.value);
      if (edit.field === 'score') next.score = Number(edit.value);
      if (edit.field === 'people') next.people = splitPeople(String(edit.value));
      return ed.set(task.line, taskLine(indentOf(lines[task.line]), next)).toString();
    }
    case 'addTask': {
      if (!sec) return null;
      const last = sec.tasks[sec.tasks.length - 1];
      const at = last ? last.line : (sec.line ?? model.header);
      const indent = last ? indentOf(lines[last.line]) : `${sec.line !== null ? indentOf(lines[sec.line]) : ''}${DEFAULT_INDENT.slice(0, 2)}`;
      const name = freeName('Task', model.sections.flatMap((s) => s.tasks.map((t) => t.name)));
      return ed.insert(at + 1, taskLine(indent, { name, score: 3, people: last?.people ?? [] })).toString();
    }
    case 'removeTask': {
      const task = sec?.tasks[edit.task];
      return task ? ed.remove(task.line).toString() : null;
    }
    case 'moveTask': {
      const a = sec?.tasks[edit.from];
      const b = sec?.tasks[edit.to];
      return a && b ? ed.swap(a.line, b.line).toString() : null;
    }
    case 'addSection': {
      const lastLine = Math.max(model.header, ...model.sections.flatMap((s) => [s.line ?? -1, ...s.tasks.map((t) => t.line)]));
      const named = model.sections.find((s) => s.line !== null);
      const indent = named ? indentOf(lines[named.line!]) : DEFAULT_INDENT;
      const taskIndent = named?.tasks[0] ? indentOf(lines[named.tasks[0].line]) : `${indent}  `;
      const name = freeName('Section', model.sections.map((s) => s.name));
      return ed.insert(lastLine + 1, `${indent}section ${name}`, taskLine(taskIndent, { name: 'New task', score: 3, people: [] })).toString();
    }
    case 'removeSection': {
      if (!sec) return null;
      const own = [sec.line, ...sec.tasks.map((t) => t.line)].filter((l): l is number => l !== null).sort((a, b) => b - a);
      for (const l of own) ed.remove(l);
      return ed.toString();
    }
  }
}
