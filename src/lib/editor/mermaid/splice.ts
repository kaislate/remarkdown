// Offset-based text splicing for the class / ER edit engines. Edits are
// queued as replacements on the source text (lines joined by '\n') and
// applied in one go, so every edit is computed against the ORIGINAL
// offsets of the parser's source map.
import { indentOf } from './source-text';

export interface Span {
  start: number;
  end: number;
}

interface Rep {
  start: number;
  end: number;
  text: string;
}

export class Splicer {
  private reps: Rep[] = [];
  constructor(readonly text: string) {}

  replace(span: Span, text: string): void {
    this.reps.push({ start: span.start, end: span.end, text });
  }
  insert(at: number, text: string): void {
    this.reps.push({ start: at, end: at, text });
  }
  get changed(): boolean {
    return this.reps.length > 0;
  }
  lineOf(off: number): number {
    return this.text.slice(0, off).split('\n').length - 1;
  }
  lineStart(off: number): number {
    return this.text.lastIndexOf('\n', off - 1) + 1;
  }
  lineEnd(off: number): number {
    const e = this.text.indexOf('\n', off);
    return e < 0 ? this.text.length : e;
  }
  // Indentation of the line holding `off`.
  indentAt(off: number): string {
    return indentOf(this.text.slice(this.lineStart(off), this.lineEnd(off)));
  }
  // Remove `span`; when nothing else is on its lines, the lines go.
  remove(span: Span): void {
    const ls = this.lineStart(span.start);
    const le = this.lineEnd(span.end);
    const before = this.text.slice(ls, span.start);
    const after = this.text.slice(span.end, le);
    if (!before.trim() && !after.trim()) {
      if (le < this.text.length) this.replace({ start: ls, end: le + 1 }, '');
      else this.replace({ start: Math.max(0, ls - 1), end: le }, '');
    } else {
      // Take the whitespace before it along (`a +x }` → `a }`).
      const ws = /\s*$/.exec(before)![0].length;
      this.replace({ start: span.start - (before.trim() ? ws : 0), end: span.end }, '');
    }
  }
  // Insert a new line `text` after the line holding offset `at`.
  lineAfter(at: number, indent: string, text: string): void {
    this.insert(this.lineEnd(at), `\n${indent}${text}`);
  }
  // Insert a new line `text` before the line holding offset `at`.
  lineBefore(at: number, indent: string, text: string): void {
    this.insert(this.lineStart(at), `${indent}${text}\n`);
  }
  apply(): string {
    // Drop edits inside a larger replaced range (insertions only when
    // strictly inside), then apply from the end. At one offset the
    // replaced range goes first, so text inserted there lands before
    // it; insertions there keep their queue order.
    const reps = this.reps.map((r, i) => ({ ...r, i }));
    const ranges = reps.filter((r) => r.end > r.start);
    const inside = (r: (typeof reps)[number], o: (typeof reps)[number]) =>
      r.end > r.start
        ? o.start <= r.start && r.end <= o.end && (o.end - o.start > r.end - r.start || o.i < r.i)
        : o.start < r.start && r.start < o.end;
    const kept = reps.filter((r) => !ranges.some((o) => o !== r && inside(r, o)));
    const isRange = (r: Rep) => (r.end > r.start ? 1 : 0);
    kept.sort((a, b) => b.start - a.start || isRange(b) - isRange(a) || b.i - a.i);
    let t = this.text;
    for (const r of kept) t = t.slice(0, r.start) + r.text + t.slice(r.end);
    return t;
  }
}
