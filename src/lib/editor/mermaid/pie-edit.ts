// Source-preserving visual edits for pie charts — the pie counterpart
// of mermaid-flowchart-edit.ts (see there for the why).
//
// Every slice is one line, so edits are line-local:
//   - label / value edits splice the quoted label or the number
//   - showData edits splice the header line
//   - remove drops the slice's line, move relocates it (comments and
//     blank lines stay where they are), add inserts one line
// A slice's shadowed duplicates (later lines with the same label, which
// mermaid ignores) travel with it: renamed with it, removed with it,
// moved with it — otherwise renaming or removing a slice would make the
// hidden duplicate appear.
//
// All text arrives as the user typed it; the engine writes it so mermaid
// shows exactly that (whitespace normalised the way the svg would).
import { parsePieSource, type PieModel, type PieSourceMap } from './pie-parser';
import { indentFor, joinLines, lastStatementLine, replaceSpan, type SourceLines } from './source-text';
import { ALWAYS_ENCODED, emitDecimal, encodeChars, normalizeUserText } from './display-text';
import { applyTitle } from './title-edit';

export type PieEdit =
  // '' removes the title.
  | { kind: 'setTitle'; title: string }
  | { kind: 'setShowData'; showData: boolean }
  // Refused (null) when another slice already shows that label.
  | { kind: 'setSliceLabel'; index: number; label: string }
  // Refused unless isValidPieValue(value).
  | { kind: 'setSliceValue'; index: number; value: number }
  // Appended after the last slice, or inserted right after slice
  // `afterIndex`. Same label / value rules as above.
  | { kind: 'addSlice'; label: string; value: number; afterIndex?: number }
  | { kind: 'removeSlice'; index: number }
  // Slice `from` ends up at index `to` (indices of the model's slices).
  | { kind: 'moveSlice'; from: number; to: number };

export interface PieEditResult {
  source: string;
  // Index of the slice an addSlice edit created.
  index?: number;
}

// A value a slice can be given: a positive, finite number. (mermaid also
// takes 0, but a zero slice draws nothing.)
export function isValidPieValue(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

// Does another slice already show `label`? mermaid keeps only the first
// slice of a label, so a second one would silently vanish.
export function pieLabelTaken(model: PieModel, label: string, exceptIndex = -1): boolean {
  const shown = normalizeUserText(label);
  return model.slices.some((s, i) => i !== exceptIndex && s.label === shown);
}

// A label as a pie STRING: `"…"` with `\` and `"` escaped, plus the
// characters every engine writes as entity codes.
export function emitPieLabel(label: string): string {
  const text = encodeChars(label, ALWAYS_ENCODED);
  return `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

// The grammar's number: digits with an optional fraction, never an
// exponent (`1e-7` would not parse).
export function emitPieValue(value: number): string {
  return emitDecimal(value);
}

// Title text: TITLE ends at `%%`, so `%` is encoded too.
function emitTitle(text: string): string {
  return encodeChars(text, `${ALWAYS_ENCODED}%`);
}

// The lines of slice i: its own and its shadowed duplicates.
function sliceLines(map: PieSourceMap, i: number): number[] {
  return [map.slices[i].line, ...map.slices[i].duplicates];
}

export function applyPieEdit(source: string, edit: PieEdit): PieEditResult | null {
  const parsed = parsePieSource(source);
  if (!parsed.ok) return null;
  const { model, map } = parsed;
  const src: SourceLines = { lines: map.lines, eol: map.eol };
  const lines = [...map.lines];
  const slice = (i: number) => (Number.isInteger(i) && i >= 0 && i < model.slices.length ? map.slices[i] : null);

  switch (edit.kind) {
    case 'setTitle':
      return { source: applyTitle(source, map.titles, edit.title, emitTitle) };

    case 'setShowData': {
      if (edit.showData === model.showData) return { source };
      const h = map.headerLine;
      lines[h] = map.showData
        ? replaceSpan(lines[h], map.showData, '')
        : replaceSpan(lines[h], { start: map.pieEnd, end: map.pieEnd }, ' showData');
      break;
    }

    case 'setSliceLabel': {
      const s = slice(edit.index);
      if (!s) return null;
      if (normalizeUserText(edit.label) === model.slices[edit.index].label) return { source };
      if (pieLabelTaken(model, edit.label, edit.index)) return null;
      const label = emitPieLabel(edit.label);
      lines[s.line] = replaceSpan(lines[s.line], s.label, label);
      // Duplicates keep shadowing it: same label, same quoting.
      for (const d of s.duplicates) {
        const m = /^([\t ]*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(lines[d])!;
        lines[d] = replaceSpan(lines[d], { start: m[1].length, end: m[0].length }, label);
      }
      break;
    }

    case 'setSliceValue': {
      const s = slice(edit.index);
      if (!s || !isValidPieValue(edit.value)) return null;
      lines[s.line] = replaceSpan(lines[s.line], s.value, emitPieValue(edit.value));
      break;
    }

    case 'addSlice': {
      if (!isValidPieValue(edit.value) || pieLabelTaken(model, edit.label)) return null;
      let after: number;
      let index: number;
      if (edit.afterIndex !== undefined) {
        const s = slice(edit.afterIndex);
        if (!s) return null;
        after = s.line;
        index = edit.afterIndex + 1;
      } else {
        after = model.slices.length ? map.slices[model.slices.length - 1].line : lastStatementLine(lines, map.headerLine);
        index = model.slices.length;
      }
      lines.splice(after + 1, 0, `${indentFor(lines, after, map.headerLine)}${emitPieLabel(edit.label)} : ${emitPieValue(edit.value)}`);
      return { source: joinLines(src, lines), index };
    }

    case 'removeSlice': {
      if (!slice(edit.index)) return null;
      const drop = new Set(sliceLines(map, edit.index));
      return { source: joinLines(src, lines.filter((_, i) => !drop.has(i))) };
    }

    case 'moveSlice': {
      const { from, to } = edit;
      if (!slice(from) || !slice(to)) return null;
      if (from === to) return { source };
      const own = sliceLines(map, from);
      const moved = own.map((l) => lines[l]);
      // Land right before the slice it will precede (moving up) or
      // right after the one it will follow (moving down).
      const anchor = map.slices[to].line;
      const out: string[] = [];
      lines.forEach((text, i) => {
        if (to < from && i === anchor) out.push(...moved);
        if (!own.includes(i)) out.push(text);
        if (to > from && i === anchor) out.push(...moved);
      });
      return { source: joinLines(src, out) };
    }
  }

  return { source: joinLines(src, lines) };
}
