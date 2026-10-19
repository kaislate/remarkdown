// Bold / italic text for diagram labels, without ever showing the
// asterisks.
//
// mermaid's "markdown strings" (a label written as "`**Bold** text`")
// support bold, italic and line breaks. The popovers edit such labels
// in a small rich-text field (MermaidRichText.svelte) with B / I
// buttons and Ctrl+B / Ctrl+I; this module converts between the
// markdown mermaid reads, a list of formatted runs, and the HTML the
// editable field shows.
//
// Markdown read: `**b**` / `__b__` bold, `*i*` / `_i_` italic,
// `***x***` both, backslash escapes. A marker only opens before a
// non-space and only closes after one (so "2 * 3" stays text), and
// pairs must match in kind and length — a pragmatic subset of
// CommonMark's flanking rules, enough for what people write in labels.
// Markdown written: `**`, `*`, `***`, with literal markers escaped.

export interface RichRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

type Token = { kind: 'text'; text: string } | { kind: 'delim'; ch: string; len: number; open: boolean; close: boolean; pair: number };

function tokenize(md: string): Token[] {
  const tokens: Token[] = [];
  let text = '';
  const flush = () => {
    if (text) tokens.push({ kind: 'text', text });
    text = '';
  };
  for (let i = 0; i < md.length; ) {
    const c = md[i];
    if (c === '\\' && i + 1 < md.length && /[*_\\`]/.test(md[i + 1])) {
      text += md[i + 1];
      i += 2;
      continue;
    }
    if (c === '*' || c === '_') {
      let n = 1;
      while (md[i + n] === c) n++;
      const prev = i > 0 ? md[i - 1] : ' ';
      const next = i + n < md.length ? md[i + n] : ' ';
      if (n <= 3) {
        flush();
        tokens.push({ kind: 'delim', ch: c, len: n, open: !/\s/.test(next), close: !/\s/.test(prev), pair: -1 });
      } else {
        text += c.repeat(n);
      }
      i += n;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return tokens;
}

export function parseRich(md: string): RichRun[] {
  const tokens = tokenize(md);
  // Pair delimiters: a closer matches the nearest open opener of the
  // same character and length.
  const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (t.kind !== 'delim') return;
    if (t.close) {
      for (let s = stack.length - 1; s >= 0; s--) {
        const o = tokens[stack[s]] as Extract<Token, { kind: 'delim' }>;
        if (o.ch === t.ch && o.len === t.len) {
          o.pair = i;
          t.pair = stack[s];
          stack.splice(s);
          return;
        }
      }
    }
    if (t.open) stack.push(i);
  });
  const runs: RichRun[] = [];
  let bold = 0;
  let italic = 0;
  const push = (text: string) => {
    if (!text) return;
    const fmt = { bold: bold > 0, italic: italic > 0 };
    const last = runs[runs.length - 1];
    if (last && last.bold === fmt.bold && last.italic === fmt.italic) last.text += text;
    else runs.push({ text, ...fmt });
  };
  tokens.forEach((t, i) => {
    if (t.kind === 'text') return push(t.text);
    if (t.pair === -1) return push(t.ch.repeat(t.len));
    const delta = t.pair > i ? 1 : -1;
    if (t.len !== 1) bold += delta;
    if (t.len !== 2) italic += delta;
  });
  return runs;
}

function escapeMarkers(text: string): string {
  return text.replace(/[\\*_`]/g, (c) => `\\${c}`);
}

export function serializeRich(runs: RichRun[]): string {
  const merged: RichRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.bold === r.bold && last.italic === r.italic) last.text += r.text;
    else merged.push({ ...r });
  }
  return merged
    .map((r) => {
      const marker = r.bold && r.italic ? '***' : r.bold ? '**' : r.italic ? '*' : '';
      if (!marker) return escapeMarkers(r.text);
      // Markers must hug the text: whitespace at the edges of a
      // formatted run goes outside it, line by line.
      return r.text
        .split('\n')
        .map((line) => {
          const m = /^(\s*)(.*?)(\s*)$/.exec(line)!;
          return m[2] ? `${m[1]}${marker}${escapeMarkers(m[2])}${marker}${m[3]}` : line;
        })
        .join('\n');
    })
    .join('');
}

export function hasFormatting(runs: RichRun[]): boolean {
  return runs.some((r) => r.text.trim() !== '' && (r.bold || r.italic));
}

export function richToPlain(runs: RichRun[]): string {
  return runs.map((r) => r.text).join('');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function runsToHtml(runs: RichRun[]): string {
  return runs
    .map((r) => {
      let html = escapeHtml(r.text).replace(/\n/g, '<br>');
      if (r.italic) html = `<i>${html}</i>`;
      if (r.bold) html = `<b>${html}</b>`;
      return html;
    })
    .join('');
}

const BLOCK = /^(DIV|P|LI)$/;

// Read the editable field back. contenteditable produces <b>/<strong>,
// <i>/<em>, inline font-weight / font-style spans, <br> and <div> lines.
export function htmlToRuns(root: Node): RichRun[] {
  const runs: RichRun[] = [];
  const push = (text: string, bold: boolean, italic: boolean) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.italic === italic) last.text += text;
    else runs.push({ text, bold, italic });
  };
  const endsWithBreak = () => {
    const last = runs[runs.length - 1];
    return !last || last.text.endsWith('\n');
  };
  const walk = (node: Node, bold: boolean, italic: boolean) => {
    if (node.nodeType === 3) {
      push((node.textContent ?? '').replace(/ /g, ' '), bold, italic);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === 'BR') {
      push('\n', bold, italic);
      return;
    }
    const weight = el.style?.fontWeight;
    const b = bold || tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600;
    const i = italic || tag === 'I' || tag === 'EM' || el.style?.fontStyle === 'italic';
    // A block starts on a new line (contenteditable's Enter makes divs).
    if (BLOCK.test(tag) && !endsWithBreak()) push('\n', false, false);
    el.childNodes.forEach((c) => walk(c, b, i));
  };
  root.childNodes.forEach((c) => walk(c, false, false));
  // A trailing line break is contenteditable bookkeeping, not content.
  const last = runs[runs.length - 1];
  if (last) {
    last.text = last.text.replace(/\n+$/, '');
    if (!last.text) runs.pop();
  }
  return runs;
}
