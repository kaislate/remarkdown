// Subset parser for mermaid sequenceDiagram. Supports the syntax the
// editor's visual UI can fully round-trip; anything else returns
// `{ ok: false, reason }` and the NodeView falls back to render-only.
//
// Supported:
//   - `sequenceDiagram` directive
//   - `participant ID` and `participant ID as Display`
//   - 4 message styles: A->B, A->>B, A-->B, A-->>B (all with optional ": text")
//   - Notes: `Note left of X: text`, `Note right of X: text`,
//     `Note over X: text`, `Note over X,Y: text`
//   - Implicit participants (auto-create on first reference in a message)
//   - Blank lines and `%%` comments
//
// Not supported (parser bails to ok:false):
//   - Control blocks (loop, alt/else, opt, par/and, critical, break, rect, box)
//   - actor (stick-figure variant)
//   - activate / deactivate / autonumber
//   - Activation suffixes (A->>+B, A->>-B)
//   - Other arrow variants (-x, --x, -), --))
//   - link/links/properties/details participant decorators
//
// Text (message / note text, participant display) is read the way
// mermaid shows it: an unencoded `#` starts a comment, and entity codes
// (`#59;`, `#quot;`, …) are decoded. The serializer writes user text
// with `;` / `#` encoded (encodeSequenceText), so whatever a user types
// reads back unchanged.
//
// parseSequenceSource also returns a source map — which line each
// statement sits on and where its parts are — for the source-preserving
// visual edits in mermaid-sequence-edit.ts.
import {
  emptySequenceGraph,
  type SequenceGraph,
  type MessageStyle,
  type NotePosition,
} from './mermaid-sequence-graph';
import { decodeMermaidEntities, type Span } from './mermaid-parser';

type ParseResult =
  | { ok: true; graph: SequenceGraph }
  | { ok: false; reason: string };

export type MessageSource = {
  kind: 'message';
  line: number;
  arrow: Span;
  // Column just past the `to` id (where ": text" starts or would go).
  toEnd: number;
  // Span of the text after the colon (trailing spaces excluded); null
  // when the message has no ": text" part.
  text: Span | null;
};

export type NoteSource = {
  kind: 'note';
  line: number;
  // `left of A` / `over A,B` — the position keyword through the ids.
  head: Span;
  text: Span;
};

export interface ParticipantDecl {
  line: number;
  // Column just past the id (where " as Display" starts or would go).
  idEnd: number;
  // Column just past the display text (before any `# comment`); equals
  // idEnd when there's no display.
  tailEnd: number;
  hasDisplay: boolean;
}

export interface SequenceSourceMap {
  lines: string[];
  eol: string;
  directiveLine: number;
  // Every statement line (declarations and events), in order.
  statementLines: number[];
  declarations: Map<string, ParticipantDecl[]>;
  // Line where each participant is first mentioned (declaration or event).
  firstMention: Map<string, number>;
  // events[i] of the graph ↔ where it sits in the source.
  events: Array<MessageSource | NoteSource>;
}

export type SequenceSourceParseResult =
  | { ok: true; graph: SequenceGraph; map: SequenceSourceMap }
  | { ok: false; reason: string };

const ID_RE_SRC = '[A-Za-z][A-Za-z0-9_]*';

// Try styles in priority order so longer prefixes win. `-->>` must beat
// `-->`, `->>` must beat `->`.
const MESSAGE_STYLES: Array<{ delim: string; style: MessageStyle }> = [
  { delim: '-->>', style: 'reply' },
  { delim: '-->',  style: 'dotted' },
  { delim: '->>',  style: 'arrow' },
  { delim: '->',   style: 'solid' },
];

// Groups: 1 indent, 2 from, 3 ws, 4 arrow, 5 ws, 6 to, 7 ws, 8 ": …" part,
// 9 ws after colon, 10 text.
const MESSAGE_RE = new RegExp(
  `^(\\s*)(${ID_RE_SRC})(\\s*)(-->>|-->|->>|->)(\\s*)(${ID_RE_SRC})(\\s*)(:(\\s*)(.*))?$`,
);

// Groups: 1 lead-in ("  Note "), 2 position, 3 ws, 4 ids, 5 colon part, 6 text.
const NOTE_RE = new RegExp(
  `^(\\s*Note\\s+)(left of|right of|over)(\\s+)(${ID_RE_SRC}(?:\\s*,\\s*${ID_RE_SRC})?)(\\s*:\\s*)(.*)$`,
  'i',
);

// Groups: 1 lead-in ("  participant "), 2 id, 3 display (after `as`).
const PARTICIPANT_RE = new RegExp(
  `^(\\s*participant\\s+)(${ID_RE_SRC})(?:\\s+as\\s+(.+?))?\\s*$`,
);

// Things we explicitly reject by leading keyword.
const REJECTED_KEYWORDS = new Set([
  'loop', 'end', 'alt', 'else', 'opt', 'par', 'and',
  'critical', 'option', 'break',
  'rect', 'box', 'actor',
  'activate', 'deactivate',
  'autonumber',
  'link', 'links', 'properties', 'details',
]);

// Activation suffixes and unsupported arrow variants. Checked against a
// message's statement head only (before the ':'), never its text — text
// is free-form and may well contain "->-" or "-)".
const REJECTED_PATTERNS: RegExp[] = [
  // Activation suffix: `->>+B`, `->>-B`, etc.
  /-+>+\s*[+\-]\s*[A-Za-z]/,
  // Unsupported arrows: -x, --x, -), --)
  /-+x\s*[A-Za-z]/i,
  /-+\)\s*[A-Za-z]/,
];

// Text as mermaid displays it: cut at an unencoded `#` (mermaid's
// sequence lexer treats it as a comment), trim, decode entity codes.
export function decodeSequenceText(raw: string): string {
  const hash = raw.search(/#(?!\w+;)/);
  const visible = hash === -1 ? raw : raw.slice(0, hash);
  return decodeMermaidEntities(visible.trim());
}

// Text a user typed, made safe for a single-line sequence statement:
//   - newlines become spaces (mermaid ends a statement at each newline)
//   - `;` (statement separator) and `#` (comment start) become entity
//     codes, which mermaid decodes back for display — so the diagram
//     shows exactly what was typed. `&` and `<` too — the two
//     characters that can start an entity or markup — so such text
//     never reaches mermaid's HTML handling as markup (same rule as
//     flowchart labels). `>` alone can't, and stays raw so arrows in
//     text ("x -> y") stay readable in the file.
// Nothing is truncated: arrow-shaped text ("a->b", even a glued
// '"x"B->>A') renders fine in mermaid 11 and is kept verbatim.
const SEQUENCE_ENTITY: Record<string, string> = {
  '#': '#35;',
  ';': '#59;',
  '&': '#amp;',
  '<': '#lt;',
};

export function encodeSequenceText(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[#;&<]/g, (c) => SEQUENCE_ENTITY[c]);
}

function unencodedSemicolon(line: string): boolean {
  const hash = line.search(/#(?!\w+;)/);
  const code = hash === -1 ? line : line.slice(0, hash);
  return code.replace(/#\w+;/g, '').includes(';');
}

// The visible text from `start`: up to an unencoded `#` (a comment to
// mermaid, kept out of the span so edits leave it in place), trailing
// spaces excluded.
function trimmedSpan(lineText: string, start: number): Span {
  const rest = lineText.slice(start);
  const hash = rest.search(/#(?!\w+;)/);
  const visible = hash === -1 ? rest : rest.slice(0, hash);
  return { start, end: start + visible.trimEnd().length };
}

export function parseSequenceSource(source: string): SequenceSourceParseResult {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);

  // 1. Find the directive — first non-blank, non-comment line.
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.length === 0 || t.startsWith('%%')) { i++; continue; }
    break;
  }
  if (i >= lines.length) {
    return { ok: false, reason: 'empty source' };
  }
  if (!/^sequenceDiagram\b/.test(lines[i].trim())) {
    return { ok: false, reason: `not a sequenceDiagram: ${lines[i].trim()}` };
  }
  const directiveLine = i;
  i++;

  // 2. Walk the body.
  const graph: SequenceGraph = emptySequenceGraph();
  const statementLines: number[] = [];
  const declarations = new Map<string, ParticipantDecl[]>();
  const firstMention = new Map<string, number>();
  const events: Array<MessageSource | NoteSource> = [];

  const mention = (id: string, line: number) => {
    if (!graph.participants.has(id)) graph.participants.set(id, { id, display: '' });
    if (!firstMention.has(id)) firstMention.set(id, line);
  };

  for (; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.length === 0 || t.startsWith('%%')) continue;

    // mermaid lexes an unencoded `;` as a line break, so a line holding
    // one is several statements to mermaid. Reading it as one would
    // misalign our event indexes with mermaid's i<N> ids (a click would
    // edit the wrong message). Leave such diagrams render-only.
    // Entity codes (`#59;`) and `#` comments may contain `;` freely.
    if (unencodedSemicolon(t)) {
      return { ok: false, reason: `statement separator in: ${t}` };
    }

    // Reject explicitly-known unsupported keywords first.
    const firstWord = t.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (REJECTED_KEYWORDS.has(firstWord)) {
      return { ok: false, reason: `unsupported directive: ${t}` };
    }

    // Participant declaration. mermaid: a declaration with an alias
    // overwrites the display; a bare re-declaration keeps it.
    const pMatch = PARTICIPANT_RE.exec(raw);
    if (pMatch) {
      const id = pMatch[2];
      const display = pMatch[3] !== undefined ? decodeSequenceText(pMatch[3]) : '';
      mention(id, i);
      if (pMatch[3] !== undefined) graph.participants.set(id, { id, display });
      const decls = declarations.get(id) ?? [];
      const idEnd = pMatch[1].length + id.length;
      decls.push({
        line: i,
        idEnd,
        tailEnd: pMatch[3] !== undefined ? trimmedSpan(raw, idEnd).end : idEnd,
        hasDisplay: pMatch[3] !== undefined,
      });
      declarations.set(id, decls);
      statementLines.push(i);
      continue;
    }

    // Note.
    const nMatch = NOTE_RE.exec(raw);
    if (nMatch) {
      const pos = nMatch[2].toLowerCase();
      const position: NotePosition =
        pos === 'left of' ? 'leftOf'
        : pos === 'right of' ? 'rightOf'
        : 'over';
      const ids = nMatch[4].split(',').map((s) => s.trim()).filter(Boolean);
      for (const id of ids) mention(id, i);
      const headStart = nMatch[1].length;
      const headEnd = headStart + nMatch[2].length + nMatch[3].length + nMatch[4].length;
      const textStart = headEnd + nMatch[5].length;
      graph.events.push({ kind: 'note', participants: ids, position, text: decodeSequenceText(nMatch[6]) });
      events.push({
        kind: 'note',
        line: i,
        head: { start: headStart, end: headEnd },
        text: trimmedSpan(raw, textStart),
      });
      statementLines.push(i);
      continue;
    }

    // Message. Unsupported arrow variants / activation suffixes are
    // looked for in the statement head only.
    const head = t.split(':')[0];
    for (const re of REJECTED_PATTERNS) {
      if (re.test(head)) {
        return { ok: false, reason: `unsupported syntax: ${t}` };
      }
    }
    const mMatch = MESSAGE_RE.exec(raw);
    if (mMatch) {
      const [, indent, from, ws1, delim, ws2, to, ws3, colonPart, ws4] = mMatch;
      const styleEntry = MESSAGE_STYLES.find((s) => s.delim === delim);
      if (!styleEntry) {
        return { ok: false, reason: `unrecognized arrow: ${delim}` };
      }
      mention(from, i);
      mention(to, i);
      const arrowStart = indent.length + from.length + ws1.length;
      const toEnd = arrowStart + delim.length + ws2.length + to.length;
      const textStart = toEnd + ws3.length + 1 + (ws4?.length ?? 0);
      graph.events.push({
        kind: 'message',
        from,
        to,
        text: colonPart !== undefined ? decodeSequenceText(mMatch[10] ?? '') : '',
        style: styleEntry.style,
      });
      events.push({
        kind: 'message',
        line: i,
        arrow: { start: arrowStart, end: arrowStart + delim.length },
        toEnd,
        text: colonPart !== undefined ? trimmedSpan(raw, textStart) : null,
      });
      statementLines.push(i);
      continue;
    }

    // Anything else is unparseable.
    return { ok: false, reason: `unparseable line: ${t}` };
  }

  return {
    ok: true,
    graph,
    map: { lines, eol, directiveLine, statementLines, declarations, firstMention, events },
  };
}

export function parseSequence(source: string): ParseResult {
  const r = parseSequenceSource(source);
  return r.ok ? { ok: true, graph: r.graph } : r;
}
