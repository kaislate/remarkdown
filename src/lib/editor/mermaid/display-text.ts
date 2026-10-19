// Text as mermaid displays it, and user text written so mermaid
// displays exactly that — shared by the pie / gantt / timeline engines.
//
// Reading: mermaid's render() turns every `#name;` / `#123;` entity code
// in the source into an HTML entity in the svg, so `#59;` shows as `;`.
// The svg's <text> then collapses runs of whitespace and drops leading /
// trailing whitespace. A model field therefore holds the decoded,
// collapsed text — what the reader sees.
//
// Writing: each diagram type gives a few characters syntactic meaning
// (a `:` ends a gantt task name, a `#` starts a timeline comment, `%%`
// ends a pie title …). The engines write those as entity codes, which
// mermaid decodes back for display, so nothing a user types can change
// the diagram's structure. `&`, `<` and `>` are always written as codes
// too: titles go through mermaid's HTML sanitizer, which would turn a
// raw `&` into a visible "&amp;".
import { decodeMermaidEntities } from '../mermaid-parser';

// Whitespace an svg <text> collapses. Not \s: a no-break space stays.
const COLLAPSIBLE = /[ \t\n\r\f]+/g;

// What the reader sees of `text` once mermaid has drawn it.
export function collapseSpace(text: string): string {
  return text.replace(COLLAPSIBLE, ' ').trim();
}

// mermaid replaces every `#name;` code with a placeholder BEFORE its
// lexer runs, so a `#` or `:` inside a code is never syntax. Parsers
// look for syntax in the masked line (codes blanked out, same length)
// and slice text from the real one.
export function maskEntities(line: string): string {
  return line.replace(/#\w+;/g, (m) => 'x'.repeat(m.length));
}

// Raw source text → displayed text.
export function displayText(raw: string): string {
  return collapseSpace(decodeMermaidEntities(raw));
}

// What a user's typed text will display as: the same whitespace
// normalisation mermaid's svg applies (popovers can show this back).
export function normalizeUserText(text: string): string {
  return collapseSpace(text);
}

const NAMED: Record<string, string> = { '&': '#amp;', '<': '#lt;', '>': '#gt;' };

export function entityFor(c: string): string {
  return NAMED[c] ?? `#${c.codePointAt(0)};`;
}

// Characters every engine encodes, whatever the field: `#` (an unencoded
// `#name;` would be read as an entity) and the three markup characters.
export const ALWAYS_ENCODED = '#&<>';

// `text` normalised, with every character in `chars` written as an
// entity code. `chars` is a plain list of characters ('#&<>:%').
export function encodeChars(text: string, chars: string): string {
  const encode = (set: string) => {
    let out = '';
    for (const c of normalizeUserText(text)) out += set.includes(c) ? entityFor(c) : c;
    return out;
  };
  const out = encode(chars);
  // Before parsing, mermaid strips the last `;` from anything that looks
  // like `style …:…#…;` (a css colour), which would break the entity
  // code after the colon. Without a raw `:` the pattern can't match.
  return /(?:style|classDef).*:\S*#/.test(out) ? encode(chars + ':') : out;
}

// Fields mermaid draws line by line (timeline boxes, gantt section
// titles) split their text at `<br>`. Such a field's model text holds
// a '\n' per break, each line displayed as usual.
export function displayLines(raw: string, br: RegExp): string {
  return raw.split(br).map(displayText).join('\n');
}

export function normalizeUserLines(text: string): string {
  return text.split(/\r\n|\r|\n/).map(collapseSpace).join('\n');
}

// encodeChars line by line, joined with `<br>`.
export function encodeLines(text: string, chars: string): string {
  return text.split(/\r\n|\r|\n/).map((l) => encodeChars(l, chars)).join('<br>');
}

// A field that must not be empty (mermaid would read the next token
// as its text): written as an encoded space, which displays as nothing.
export const EMPTY_TEXT = '#32;';

// Encode the first character of `text` (already encoded otherwise) —
// for text whose start a lexer would read as a keyword.
export function encodeFirstChar(text: string): string {
  if (!text || text.startsWith('#')) return text;
  const first = String.fromCodePoint(text.codePointAt(0)!);
  return entityFor(first) + text.slice(first.length);
}
