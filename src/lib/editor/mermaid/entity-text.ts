// Shared plumbing for the class / ER parsers (class-parser.ts,
// er-parser.ts), which port mermaid 11.14's own jison lexers.
//
// Before mermaid's lexer sees a diagram it runs a few text passes over
// it (mermaid/src/preprocess.ts, Diagram.fromText):
//   - YAML frontmatter, `%%{init}%%` directives and whole-line `%%`
//     comments are removed
//   - `<tag a="x">` has its attribute quotes swapped to `'`
//   - entity codes `#59;` / `#quot;` become private placeholders
//     (ﬂ°°59¶ß / ﬂ°quot¶ß) that are turned back into `&#59;` / `&quot;`
//     in the final SVG — so they survive every lexer rule untouched and
//     display as the character they encode
//   - on a line holding `style…:…#…;` the last `;` is dropped
// prepareSource replays those passes and keeps, for every character
// the lexer will see, the offset of the source character it came from,
// so token spans point back into the ORIGINAL text.
import { findPreamble, type DiagramPreamble } from './source-text';

export interface PreparedSource {
  // The source with lines joined by '\n' (CRLF normalised) — what all
  // spans index into, and what edits are applied to.
  text: string;
  // What mermaid's lexer sees: same line structure, transformed.
  lexText: string;
  // lexText[i] came from text[origin[i]]; origin[lexText.length] is the
  // end of the text.
  origin: number[];
  preamble: DiagramPreamble;
  // Offset in `lexText` where the diagram header starts (mermaid trims
  // everything before it).
  lexStart: number;
  // Start offset (in `text`) of every line.
  lineStarts: number[];
}

// `%%` comment lines mermaid deletes before lexing (cleanupComments
// needs at least one character after `%%`, and leaves `%%{` alone —
// those are directives, removed separately).
function isRemovedComment(line: string): boolean {
  return /^\s*%%(?!\{)[^\n]+$/.test(line);
}

const PLACEHOLDER_NUM = 'ﬂ\xB0\xB0';
const PLACEHOLDER_NAMED = 'ﬂ\xB0';
const PLACEHOLDER_END = '\xB6\xDF';

export function prepareSource(lines: string[]): PreparedSource {
  const preamble = findPreamble(lines);
  const text = lines.join('\n');
  const lineStarts: number[] = [];
  let off = 0;
  for (const l of lines) {
    lineStarts.push(off);
    off += l.length + 1;
  }
  let lexText = '';
  const origin: number[] = [];
  let inDirective = false;
  let lexStart = -1;
  lines.forEach((line, ln) => {
    const base = lineStarts[ln];
    let keep = ln >= preamble.headerLine && preamble.headerLine >= 0;
    if (keep) {
      const t = line.trim();
      if (inDirective) {
        keep = false;
        if (t.includes('}%%')) inDirective = false;
      } else if (t.startsWith('%%{')) {
        keep = false;
        if (!t.includes('}%%')) inDirective = true;
      } else if (isRemovedComment(line)) {
        keep = false;
      }
    }
    if (keep) {
      if (lexStart < 0) lexStart = lexText.length + (line.length - line.trimStart().length);
      const { out, map } = transformLine(line);
      lexText += out;
      for (const m of map) origin.push(base + m);
    }
    if (ln < lines.length - 1) {
      lexText += '\n';
      origin.push(base + line.length);
    }
  });
  origin.push(text.length);
  return { text, lexText, origin, preamble, lexStart: lexStart < 0 ? lexText.length : lexStart, lineStarts };
}

// One line through cleanupText's tag-quote swap and encodeEntities;
// map[i] = column of the source character output[i] came from.
function transformLine(line: string): { out: string; map: number[] } {
  // <tag a="x"> → <tag a='x'> (length-preserving).
  let s = line.replace(/<(\w+)([^>]*)>/g, (_m, tag: string, attrs: string) => `<${tag}${attrs.replace(/="([^"]*)"/g, "='$1'")}>`);
  let cols = Array.from({ length: s.length }, (_, i) => i);
  // style…:…#…; / classDef…:…#…; lose their last `;`.
  for (const re of [/style.*:\S*#.*;/g, /classDef.*:\S*#.*;/g]) {
    let m: RegExpExecArray | null;
    const drop = new Set<number>();
    re.lastIndex = 0;
    while ((m = re.exec(s))) drop.add(m.index + m[0].length - 1);
    if (drop.size) {
      cols = cols.filter((_, i) => !drop.has(i));
      s = [...s].filter((_, i) => !drop.has(i)).join('');
    }
  }
  // Entity codes → placeholders.
  let out = '';
  const map: number[] = [];
  const re = /#\w+;/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    for (let i = last; i < m.index; i++) {
      out += s[i];
      map.push(cols[i]);
    }
    const inner = m[0].slice(1, -1);
    const head = /^\+?\d+$/.test(inner) ? PLACEHOLDER_NUM : PLACEHOLDER_NAMED;
    const hashCol = cols[m.index];
    const semiCol = cols[m.index + m[0].length - 1];
    for (const ch of head) {
      out += ch;
      map.push(hashCol);
    }
    for (let k = 0; k < inner.length; k++) {
      out += inner[k];
      map.push(cols[m.index + 1 + k]);
    }
    for (const ch of PLACEHOLDER_END) {
      out += ch;
      map.push(semiCol);
    }
    last = m.index + m[0].length;
  }
  for (let i = last; i < s.length; i++) {
    out += s[i];
    map.push(cols[i]);
  }
  return { out, map };
}

// Entity codes → mermaid's placeholders (encodeEntities), for running
// mermaid's own string handling on source text.
export function encodePlaceholders(text: string): string {
  return text.replace(/#\w+;/g, (s) => {
    const inner = s.slice(1, -1);
    return (/^\+?\d+$/.test(inner) ? PLACEHOLDER_NUM : PLACEHOLDER_NAMED) + inner + PLACEHOLDER_END;
  });
}

// Placeholders back to entity codes.
export function decodePlaceholders(text: string): string {
  return text.replace(/ﬂ\xB0\xB0(\+?\d+)\xB6\xDF/g, (_m, n: string) => `#${n.replace('+', '')};`)
    .replace(/ﬂ\xB0(\w+)\xB6\xDF/g, (_m, n: string) => `#${n};`);
}

// ── Writing user text ───────────────────────────────────────────────

// Entity code for one character, the way mermaid decodes it back.
export function entity(ch: string): string {
  const named: Record<string, string> = { '"': 'quot', '&': 'amp', '<': 'lt', '>': 'gt' };
  return named[ch] ? `#${named[ch]};` : `#${ch.codePointAt(0)};`;
}

// A user's text flattened to one line and trimmed — mermaid trims
// every label, and no statement survives a raw newline.
export function flatten(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ').trim();
}

// Characters encoded in every piece of user text:
//   # ;      entity syntax / a class LABEL ends at `;`
//   : %      `:` ends a class LABEL (and with `style…` triggers
//            mermaid's entity pre-pass); `%%` starts a comment
//   " \      quotes end strings; `\` is a markdown escape
//   & < >    HTML in labels
//   * ~      markdown emphasis / generics
// plus `_` where it could start or end markdown emphasis (not inside
// a word: `user_id` stays as is).
const ALWAYS = /[#;:%"\\&<>*~]/;

// Encode, in one pass, the ALWAYS characters, `extra` ones, and `_`
// at a word boundary.
export function encodeChars(s: string, extra?: RegExp): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const boundaryUnderscore = c === '_' && !(/[A-Za-z0-9]/.test(s[i - 1] ?? '') && /[A-Za-z0-9]/.test(s[i + 1] ?? ''));
    out += ALWAYS.test(c) || extra?.test(c) || boundaryUnderscore ? entity(c) : c;
  }
  return out;
}

// Label text (class / note / relation labels, cardinalities, ER aliases
// and relationship labels): one line, trimmed, encoded. `flags` 'i' for
// diagrams whose `direction` rule is case-insensitive (ER).
export function encodeText(text: string, flags = ''): string {
  return breakDirection(encodeChars(flatten(text)), flags);
}

// Break mermaid's line-swallowing `direction XX` lexer rule (it fires
// anywhere on a line, also inside labels) by encoding the `d`.
export function breakDirection(encoded: string, flags = ''): string {
  return encoded.replace(new RegExp('d(?=irection\\s+(TB|BT|RL|LR))', 'g' + flags), (c) => entity(c));
}
